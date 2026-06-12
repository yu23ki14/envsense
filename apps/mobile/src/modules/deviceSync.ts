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

function controlPacket(cmd: number, fileId?: number): Uint8Array {
  if (fileId == null) return new Uint8Array([cmd]);
  const packet = new Uint8Array(5);
  packet[0] = cmd;
  new DataView(packet.buffer).setUint32(1, fileId, true);
  return packet;
}

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

  /** 1 ファイルを受信し、CRC32 とサイズを検証して返す。 */
  fetchFile(entry: ManifestEntry, onChunk: (bytes: number) => void): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      const buffer = new Uint8Array(entry.size);
      let offset = 0;
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
          fail(`Device reported file ${entry.id} unavailable`);
          return;
        }
        if (type === SYNC_PKT_CHUNK) {
          arm();
          const seq = v.getUint16(5, true);
          const payload = packet.subarray(7);
          // 通知は接続内で順序保証されるので、欠落 = 取りこぼし確定。
          if (seq !== expectedSeq || offset + payload.length > buffer.length) {
            fail(`File ${entry.id} chunk sequence broken at ${seq}`);
            return;
          }
          buffer.set(payload, offset);
          offset += payload.length;
          expectedSeq += 1;
          onChunk(payload.length);
          return;
        }
        // SYNC_PKT_FILE_END
        if (timer != null) clearTimeout(timer);
        this.handler = null;
        const expectedCrc = v.getUint32(5, true);
        if (offset !== entry.size) {
          reject(new Error(`File ${entry.id} incomplete: ${offset}/${entry.size} bytes`));
        } else if (crc32(buffer) !== expectedCrc) {
          reject(new Error(`File ${entry.id} failed CRC check`));
        } else {
          resolve(buffer);
        }
      };
      arm();
      this.control
        .write(controlPacket(SYNC_CMD_GET_FILE, entry.id))
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
      let bytes: Uint8Array | null = null;
      const chunkBase = progress.doneBytes;
      for (let attempt = 0; attempt < FILE_RETRY_COUNT && bytes == null; attempt++) {
        progress.doneBytes = chunkBase;
        try {
          bytes = await channel.fetchFile(entry, (n) => {
            progress.doneBytes += n;
            report();
          });
        } catch (err) {
          console.warn(`Sync: file ${entry.id} attempt ${attempt + 1} failed`, err);
        }
      }
      if (bytes == null) {
        skipped += 1;
        progress.doneBytes = chunkBase + entry.size;
        progress.doneFiles += 1;
        report();
        continue;
      }

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
