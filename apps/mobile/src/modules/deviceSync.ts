/**
 * microSD 同期プロトコルのクライアント。
 *
 * デバイスは未接続中も写真と VAD 抽出済み音声を microSD に貯めており、接続中に
 * ここからまとめて吸い上げる: マニフェスト取得 → ファイル毎に
 * 要求 → チャンク受信 → CRC32 検証 → 保存（写真 / 音声セッション + 文字起こし）
 * → ACK（デバイス側で削除）。UUID・パケットレイアウトは firmware/src/config.h
 * の Sync protocol コメントが正で、全整数はリトルエンディアン。
 */
import type { BleCharacteristic, BleDevice } from './ble';
import { AudioSessionIngestor, persistPhoto, rotationFromOrientation } from './mediaIngest';

const ENVSENSE_SERVICE_UUID = 'ea800000-9c72-497f-81f9-752ffe11f565';
const SYNC_STATUS_UUID = 'ea800008-9c72-497f-81f9-752ffe11f565';
const SYNC_CONTROL_UUID = 'ea800009-9c72-497f-81f9-752ffe11f565';
const SYNC_DATA_UUID = 'ea80000a-9c72-497f-81f9-752ffe11f565';
const TIME_SYNC_UUID = 'ea80000b-9c72-497f-81f9-752ffe11f565';

const SYNC_CMD_MANIFEST = 0x01;
const SYNC_CMD_GET_FILE = 0x02;
const SYNC_CMD_ACK_FILE = 0x03;
const SYNC_CMD_ABORT = 0x04;
const SYNC_CMD_PURGE = 0x05;

const SYNC_PKT_MANIFEST_END = 0x00;
const SYNC_PKT_MANIFEST = 0x01;
const SYNC_PKT_CHUNK = 0x02;
const SYNC_PKT_FILE_END = 0x03;
const SYNC_PKT_ERROR = 0x7f;

const SYNC_FLAG_SD_OK = 0x01;
const SYNC_FLAG_CLOCK_VALID = 0x02;
const SYNC_MANIFEST_ENTRY_BYTES = 18;

const FILE_TYPE_AUDIO = 0;
const FILE_TYPE_PHOTO = 1;

// パケット間がこれだけ空いたら転送失敗とみなす（接続劣化・ファーム停止）。
const PACKET_TIMEOUT_MS = 10000;
const FILE_RETRY_COUNT = 2;
// これより古いタイムスタンプは「時計未設定のまま記録された」ファイル
// （firmware の CLOCK_VALID_MIN_EPOCH_MS と同じ 2021-01-01）。
const CLOCK_VALID_MIN_EPOCH_MS = 1609459200000;

export type DeviceSyncStatus = {
  audioFiles: number;
  photoFiles: number;
  totalBytes: number;
  sdOk: boolean;
  clockValid: boolean;
};

export type SyncProgress = {
  phase: 'manifest' | 'transfer' | 'finishing';
  totalFiles: number;
  doneFiles: number;
  totalBytes: number;
  doneBytes: number;
};

type ManifestEntry = {
  id: number;
  type: number;
  size: number;
  epochMs: number;
  orientation: number;
};

// --- CRC-32 (IEEE 802.3, zlib 互換 — Ogg の CRC とは別物) -------------------
const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (CRC32_TABLE[(crc ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function view(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function readUint64(v: DataView, offset: number): number {
  // epoch ms は 2^53 に遠く及ばないので number で安全に表せる。
  return v.getUint32(offset, true) + v.getUint32(offset + 4, true) * 0x100000000;
}

export function parseSyncStatus(data: Uint8Array): DeviceSyncStatus | null {
  if (data.length < 9) return null;
  const v = view(data);
  const flags = v.getUint8(8);
  return {
    audioFiles: v.getUint16(0, true),
    photoFiles: v.getUint16(2, true),
    totalBytes: v.getUint32(4, true),
    sdOk: (flags & SYNC_FLAG_SD_OK) !== 0,
    clockValid: (flags & SYNC_FLAG_CLOCK_VALID) !== 0,
  };
}

/** 接続のたびに現在時刻をデバイスへ書き込む（ファイルのタイムスタンプの基準）。 */
export async function writeTimeSync(device: BleDevice): Promise<void> {
  const service = await device.getService(ENVSENSE_SERVICE_UUID);
  const char = await service.getCharacteristic(TIME_SYNC_UUID);
  const payload = new Uint8Array(8);
  let epoch = Date.now();
  for (let i = 0; i < 8; i++) {
    payload[i] = epoch % 256;
    epoch = Math.floor(epoch / 256);
  }
  await char.write(payload);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type DeleteProgress = { total: number; done: number };

/**
 * デバイス上の未同期ファイルを転送せずに全消去する（SYNC_CMD_PURGE）。ファーム側は
 * 1 ループにつき一定数ずつ増分削除し、SYNC_STATUS の件数が減っていく。ここでは開始時の
 * 件数を分母に、減った分を進捗として報告しながら 0（または録音中の発話で下げ止まり）まで
 * ポーリングする。
 */
export async function deleteAllDeviceFiles(
  device: BleDevice,
  onProgress?: (progress: DeleteProgress) => void,
): Promise<void> {
  const service = await device.getService(ENVSENSE_SERVICE_UUID);
  const control = await service.getCharacteristic(SYNC_CONTROL_UUID);
  const statusChar = await service.getCharacteristic(SYNC_STATUS_UUID);

  const readTotal = async (): Promise<number> => {
    const status = parseSyncStatus(await statusChar.read());
    return status != null ? status.audioFiles + status.photoFiles : -1;
  };

  const initial = Math.max(0, await readTotal());
  onProgress?.({ total: initial, done: 0 });
  await control.write(controlPacket(SYNC_CMD_PURGE));

  let previous = -1;
  let stable = 0;
  // 増分削除の進捗をポーリングする。0 で完了、下げ止まり（消せない発話ファイルが残る）が
  // 3 回続いたら完了、いずれも来なければ十分長い壁時計上限で打ち切る。
  for (let i = 0; i < 600; i++) {
    await sleep(300);
    const total = await readTotal();
    if (total < 0) continue; // 一過性の読み取り失敗
    onProgress?.({ total: initial, done: Math.max(0, initial - total) });
    if (total === 0) return;
    if (total === previous) {
      if (++stable >= 3) return; // 下げ止まり（例: 録音中の発話が 1 件残る）
    } else {
      stable = 0;
      previous = total;
    }
  }
}

function controlPacket(cmd: number, fileId?: number): Uint8Array {
  if (fileId == null) return new Uint8Array([cmd]);
  const packet = new Uint8Array(5);
  packet[0] = cmd;
  new DataView(packet.buffer).setUint32(1, fileId, true);
  return packet;
}

/**
 * GET_FILE。offset/crcSeed を載せると、デバイスはその位置から続きを送る
 * （[cmd][u32 id][u32 offset][u32 crcSeed]、firmware/src/config.h 参照）。
 * crcSeed は手元にある先頭 offset バイトの CRC32。esp_rom_crc32_le は LFSR の
 * 合成則を満たすので、デバイスが続きを積み上げても FILE_END のCRCはファイル全体と一致する。
 */
function getFilePacket(fileId: number, offset: number, crcSeed: number): Uint8Array {
  const packet = new Uint8Array(13);
  packet[0] = SYNC_CMD_GET_FILE;
  const dv = new DataView(packet.buffer);
  dv.setUint32(1, fileId, true);
  dv.setUint32(5, offset >>> 0, true);
  dv.setUint32(9, crcSeed >>> 0, true);
  return packet;
}

/**
 * 再接続をまたいで再開するための部分転送バッファ。キーは (type, epochMs, size)
 * — firmware のファイル ID は接続スコープで再接続のたびに変わるが、この 3 つは
 * 同じファイルなら接続をまたいで安定する。プロセス内メモリのみ保持するので、
 * アプリ強制終了時は失われ次回 0 から取り直す（安全側）。
 */
type PartialTransfer = { buffer: Uint8Array; offset: number };
const partialTransfers = new Map<string, PartialTransfer>();
const partialKey = (e: ManifestEntry) => `${e.type}:${e.epochMs}:${e.size}`;

/**
 * SYNC_DATA の購読は 1 本だけ張り、フェーズごとにハンドラを差し替える。
 * 各フェーズはパケット間タイムアウトつきの Promise として実装する。
 */
class SyncChannel {
  private handler: ((data: Uint8Array) => void) | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private control: BleCharacteristic,
    private data: BleCharacteristic,
  ) {}

  async open(): Promise<void> {
    this.unsubscribe = await this.data.subscribe((packet) => this.handler?.(packet));
  }

  close(): void {
    this.handler = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** マニフェスト全件を受信する。 */
  requestManifest(): Promise<ManifestEntry[]> {
    return new Promise<ManifestEntry[]>((resolve, reject) => {
      const entries: ManifestEntry[] = [];
      let timer: ReturnType<typeof setTimeout> | null = null;
      const fail = (message: string) => {
        if (timer != null) clearTimeout(timer);
        this.handler = null;
        reject(new Error(message));
      };
      const arm = () => {
        if (timer != null) clearTimeout(timer);
        timer = setTimeout(() => fail('Manifest transfer timed out'), PACKET_TIMEOUT_MS);
      };
      this.handler = (packet) => {
        const type = packet[0];
        if (type === SYNC_PKT_MANIFEST) {
          arm();
          const count = packet[1] ?? 0;
          const v = view(packet);
          for (let i = 0; i < count; i++) {
            const p = 2 + i * SYNC_MANIFEST_ENTRY_BYTES;
            if (p + SYNC_MANIFEST_ENTRY_BYTES > packet.length) break;
            entries.push({
              id: v.getUint32(p, true),
              type: v.getUint8(p + 4),
              size: v.getUint32(p + 5, true),
              epochMs: readUint64(v, p + 9),
              orientation: v.getUint8(p + 17),
            });
          }
        } else if (type === SYNC_PKT_MANIFEST_END) {
          if (timer != null) clearTimeout(timer);
          this.handler = null;
          resolve(entries);
        }
      };
      arm();
      this.control.write(controlPacket(SYNC_CMD_MANIFEST)).catch((err) => fail(String(err)));
    });
  }

  /**
   * 1 ファイルを受信し、CRC32 とサイズを検証して返す。partial.offset > 0 なら
   * その続きから受信を再開する（再接続後の途中再開）。受信したバイトは partial に
   * 書き戻すので、失敗して reject しても呼び出し側が次回の再開に使える。CRC/サイズ
   * 検証に失敗した場合だけは partial.offset を 0 に戻し、次回 0 から取り直させる。
   */
  fetchFile(
    entry: ManifestEntry,
    partial: PartialTransfer,
    onChunk: (bytes: number) => void,
  ): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      const buffer = partial.buffer;
      let expectedSeq = 0;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const fail = (message: string) => {
        if (timer != null) clearTimeout(timer);
        this.handler = null;
        reject(new Error(message));
      };
      const arm = () => {
        if (timer != null) clearTimeout(timer);
        timer = setTimeout(() => fail(`File ${entry.id} transfer timed out`), PACKET_TIMEOUT_MS);
      };
      this.handler = (packet) => {
        const type = packet[0];
        if (type !== SYNC_PKT_CHUNK && type !== SYNC_PKT_FILE_END && type !== SYNC_PKT_ERROR) {
          return;
        }
        const v = view(packet);
        const id = v.getUint32(1, true);
        if (id !== entry.id) return; // 直前のファイルの残骸は無視する
        if (type === SYNC_PKT_ERROR) {
          // デバイスが offset を拒否した（ファイルが変わった等）。手元の部分は破棄する。
          partial.offset = 0;
          fail(`Device reported file ${entry.id} unavailable`);
          return;
        }
        if (type === SYNC_PKT_CHUNK) {
          arm();
          const seq = v.getUint16(5, true);
          const payload = packet.subarray(7);
          // 通知は接続内で順序保証されるので、欠落 = 取りこぼし確定。seq は GET_FILE
          // ごとに 0 始まりで、payload は partial.offset の続きに積む。
          if (seq !== expectedSeq || partial.offset + payload.length > buffer.length) {
            fail(`File ${entry.id} chunk sequence broken at ${seq}`);
            return;
          }
          buffer.set(payload, partial.offset);
          partial.offset += payload.length;
          expectedSeq += 1;
          onChunk(payload.length);
          return;
        }
        // SYNC_PKT_FILE_END
        if (timer != null) clearTimeout(timer);
        this.handler = null;
        const expectedCrc = v.getUint32(5, true);
        if (partial.offset !== entry.size) {
          reject(new Error(`File ${entry.id} incomplete: ${partial.offset}/${entry.size} bytes`));
        } else if (crc32(buffer) !== expectedCrc) {
          partial.offset = 0; // 壊れているので部分を捨て、次回 0 から取り直す
          reject(new Error(`File ${entry.id} failed CRC check`));
        } else {
          resolve(buffer);
        }
      };
      arm();
      // 続きから要求する場合は手元のバイトの CRC32 をシードとして渡す。
      const crcSeed = partial.offset > 0 ? crc32(buffer.subarray(0, partial.offset)) : 0;
      this.control
        .write(getFilePacket(entry.id, partial.offset, crcSeed))
        .catch((err) => fail(String(err)));
    });
  }

  ack(fileId: number): Promise<void> {
    return this.control.write(controlPacket(SYNC_CMD_ACK_FILE, fileId));
  }

  abort(): Promise<void> {
    return this.control.write(controlPacket(SYNC_CMD_ABORT));
  }
}

/** .opp（長さプレフィクスつき Opus フレーム列）をフレーム配列へ展開する。 */
function parseOppFrames(bytes: Uint8Array): Uint8Array[] {
  if (
    bytes.length < 16 ||
    bytes[0] !== 0x4f || // 'O'
    bytes[1] !== 0x50 || // 'P'
    bytes[2] !== 0x50 || // 'P'
    bytes[3] !== 0x31 // '1'
  ) {
    console.warn('Skipping audio file with unknown header');
    return [];
  }
  const frames: Uint8Array[] = [];
  let offset = 16;
  while (offset + 2 <= bytes.length) {
    const len = (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
    offset += 2;
    if (len === 0 || offset + len > bytes.length) break;
    frames.push(bytes.subarray(offset, offset + len));
    offset += len;
  }
  return frames;
}

/**
 * 未同期ファイルを全件吸い上げる。ファイル単位で再試行し、失敗したファイルは
 * ACK せずスキップする（デバイスに残り、次回の同期で再挑戦する）。
 */
export async function runDeviceSync(
  device: BleDevice,
  onProgress?: (progress: SyncProgress) => void,
): Promise<{ files: number; skipped: number; bytes: number }> {
  const service = await device.getService(ENVSENSE_SERVICE_UUID);
  const control = await service.getCharacteristic(SYNC_CONTROL_UUID);
  const data = await service.getCharacteristic(SYNC_DATA_UUID);
  const channel = new SyncChannel(control, data);
  await channel.open();

  const progress: SyncProgress = {
    phase: 'manifest',
    totalFiles: 0,
    doneFiles: 0,
    totalBytes: 0,
    doneBytes: 0,
  };
  const report = () => onProgress?.({ ...progress });
  report();

  try {
    const manifest = await channel.requestManifest();
    // 音声のセッション分割が時系列前提なので、全体を撮影/録音時刻順に処理する。
    manifest.sort((a, b) => a.epochMs - b.epochMs);
    progress.phase = 'transfer';
    progress.totalFiles = manifest.length;
    progress.totalBytes = manifest.reduce((sum, e) => sum + e.size, 0);
    report();

    const ingestor = new AudioSessionIngestor();
    let synced = 0;
    let skipped = 0;
    let syncedBytes = 0;

    for (const entry of manifest) {
      // 前回の接続で途中まで受け取っていれば、その続きから再開する。
      const key = partialKey(entry);
      let partial = partialTransfers.get(key);
      if (partial == null || partial.buffer.length !== entry.size) {
        partial = { buffer: new Uint8Array(entry.size), offset: 0 };
      }
      let bytes: Uint8Array | null = null;
      const chunkBase = progress.doneBytes;
      // 再開分は受信済みとして進捗に反映（onChunk は今回の新規分だけ加算する）。
      progress.doneBytes = chunkBase + partial.offset;
      report();
      for (let attempt = 0; attempt < FILE_RETRY_COUNT && bytes == null; attempt++) {
        try {
          bytes = await channel.fetchFile(entry, partial, (n) => {
            progress.doneBytes += n;
            report();
          });
        } catch (err) {
          console.warn(`Sync: file ${entry.id} attempt ${attempt + 1} failed`, err);
        }
      }
      if (bytes == null) {
        // 途中まで受信できていれば次回の再接続で続きから再開できるよう保持する。
        // 何も受信していない／CRC失敗で破棄された(offset=0)場合はキャッシュを残さない。
        if (partial.offset > 0 && partial.offset < entry.size) {
          partialTransfers.set(key, partial);
        } else {
          partialTransfers.delete(key);
        }
        skipped += 1;
        progress.doneBytes = chunkBase + entry.size;
        progress.doneFiles += 1;
        report();
        continue;
      }
      partialTransfers.delete(key);

      // デバイスの時計が一度も合わないまま録られたファイルの保険。firmware が
      // 接続時の TIME_SYNC で補正するため通常は通らない。
      const capturedAt = entry.epochMs >= CLOCK_VALID_MIN_EPOCH_MS ? entry.epochMs : Date.now();
      if (entry.type === FILE_TYPE_AUDIO) {
        ingestor.ingest(parseOppFrames(bytes), capturedAt);
      } else if (entry.type === FILE_TYPE_PHOTO) {
        persistPhoto(bytes, rotationFromOrientation(entry.orientation), capturedAt);
      }

      await channel.ack(entry.id);
      synced += 1;
      syncedBytes += entry.size;
      progress.doneFiles += 1;
      report();
    }

    progress.phase = 'finishing';
    report();
    await ingestor.flush();
    return { files: synced, skipped, bytes: syncedBytes };
  } catch (err) {
    await channel.abort().catch(() => undefined);
    throw err;
  } finally {
    channel.close();
  }
}

export { ENVSENSE_SERVICE_UUID, SYNC_STATUS_UUID };
