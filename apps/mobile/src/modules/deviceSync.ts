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
// 0x04 (旧 WINDOW_END) は予約。窓化では wcount をチャンクに載せるため使わない。
const SYNC_PKT_ERROR = 0x7f;

const SYNC_FLAG_SD_OK = 0x01;
const SYNC_FLAG_CLOCK_VALID = 0x02;
const SYNC_FLAG_PURGING = 0x04;
const SYNC_MANIFEST_ENTRY_BYTES = 18;

const FILE_TYPE_AUDIO = 0;
const FILE_TYPE_PHOTO = 1;

// GET_FILE を送ってから次のパケット（チャンク or FILE_END）がこれだけ来なければ失敗とみなして
// 再要求する。窓内では 1 パケットごとにこのタイマを張り直す。この無音窓は firmware の
// SYNC_ACTIVE_IDLE_MS(=6000, config.h) より必ず短く保つこと。逆転すると、応答待ちの間にファームが
// 「同期終了」と誤判定して capture（PDMマイク + 定期撮影）を再開し、カメラ起動中に BLE が切れる
// （issue #74）。1 窓の往復は通常 1 秒未満なので 3 秒で十分。
const PACKET_TIMEOUT_MS = 3000;
// マニフェスト取得専用のタイムアウト。デバイスは要求を受けると SD 全件をスキャンしてから最初の
// パケットを返すため、ファイル数が多い／FAT ディレクトリが肥大していると無音区間が数秒に及ぶ。
// firmware はスキャン中 STORAGE_MANIFEST_PROGRESS_FILES 件ごとに 0 件パケットで keep-alive を送る
// （その都度このタイマを張り直す）ので、keep-alive 間隔（通常 1 秒未満）より十分長く、かつ
// keep-alive が数回連続ドロップしても耐える余裕を持たせる。
const MANIFEST_PACKET_TIMEOUT_MS = 10000;
// 1 ファイルの転送で「1 窓で 1 バイトでも進めばリセット」する無進捗カウントの上限。これを超えたら
// そのファイルはスキップ（次回の同期で再挑戦）。全取りこぼし or タイムアウトが連続した回数。
const MAX_WINDOW_STALLS = 5;
// 1 回の GET_FILE でまとめて要求するチャンク数（窓サイズ）。1 = 旧 stop-and-wait。firmware の
// SYNC_WINDOW_CHUNKS_MAX 以下であること。逆順送信のおかげで最悪でも 1 窓 1 チャンクは前進するので
// W=1 より遅くなることはなく、ドロップが少ないリンクほど最大 W 倍速くなる。実機計測しながら上げる。
const SYNC_WINDOW_CHUNKS = 2;
// 同期開始時、ABORT 後に BLE パイプラインの残骸チャンクが流れ切るのを待つ窓。
const DRAIN_MS = 250;
// これより古いタイムスタンプは「時計未設定のまま記録された」ファイル
// （firmware の CLOCK_VALID_MIN_EPOCH_MS と同じ 2021-01-01）。
const CLOCK_VALID_MIN_EPOCH_MS = 1609459200000;

export type DeviceSyncStatus = {
  audioFiles: number;
  photoFiles: number;
  totalBytes: number;
  sdOk: boolean;
  clockValid: boolean;
  /** 削除（PURGE）進行中。完了するとファームがこれを false で notify してくる。 */
  purging: boolean;
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

/**
 * 確定済み CRC32（prev、空のとき 0）に bytes を継ぎ足した確定 CRC32 を返す。
 * stop-and-wait では 1 チャンクごとにこれで逐次更新し、毎リクエストで全バッファを
 * 再計算する O(n^2) を避ける（prev を ^0xffffffff で「未確定状態」に戻して継続）。
 */
function crc32Append(prev: number, bytes: Uint8Array): number {
  let crc = (prev ^ 0xffffffff) >>> 0;
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
    purging: (flags & SYNC_FLAG_PURGING) !== 0,
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

export type DeleteProgress = { total: number; done: number };

// 通知取りこぼし対策の read 間隔。完了判定自体は時間ではなく SYNC_FLAG_PURGING で行うが、
// notify が落ちても進まなくならないよう、定期的に read して同じ判定を回す安全網。
const DELETE_POLL_FALLBACK_MS = 2000;
// 念のための壁時計上限（通知も read も完了を返さない異常時のみ作用）。
const DELETE_MAX_MS = 10 * 60 * 1000;

/**
 * デバイス上の未同期ファイルを転送せずに全消去する（SYNC_CMD_PURGE）。
 *
 * 完了はファーム側の通知で判定する：PURGE 中は SYNC_STATUS が `purging=true` で残件数を
 * 定期 notify し、削除し切ると `purging=false` を最終 notify する。ここでは subscribe して
 * 進捗を `onProgress` に流し、`purging` が true→false に落ちたら（=ファームが完了を宣言）
 * 解決する。通知が落ちても止まらないよう、定期 read を安全網にする。
 */
export async function deleteAllDeviceFiles(
  device: BleDevice,
  onProgress?: (progress: DeleteProgress) => void,
): Promise<void> {
  const service = await device.getService(ENVSENSE_SERVICE_UUID);
  const control = await service.getCharacteristic(SYNC_CONTROL_UUID);
  const statusChar = await service.getCharacteristic(SYNC_STATUS_UUID);

  const initialStatus = parseSyncStatus(await statusChar.read());
  // 観測した最大件数を進捗の分母にする（開始時 read が一過性に失敗/過少でも、
  // 削除中の満件数で分母が確定するので、進捗バーが 0 のまま固まらない）。
  let initial = initialStatus != null ? initialStatus.audioFiles + initialStatus.photoFiles : 0;
  console.log(`[deleteAll] initial read total=${initial}, writing PURGE`);
  onProgress?.({ total: initial, done: 0 });

  // PURGE は購読の成否に依存させず、直接送る。完了/進捗は notify と fallback read の
  // 両方で拾う（notify が来なくても read で進捗・完了を検出できる）。
  await control.write(controlPacket(SYNC_CMD_PURGE));
  console.log('[deleteAll] PURGE written');

  await new Promise<void>((resolve) => {
    let unsubscribe: (() => void) | null = null;
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;
    let maxTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    let sawPurging = false; // purging=true を一度でも観測したか（開始前の定期通知での誤判定防止）

    const cleanup = () => {
      if (fallbackTimer != null) clearInterval(fallbackTimer);
      if (maxTimer != null) clearTimeout(maxTimer);
      unsubscribe?.();
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const apply = (status: DeviceSyncStatus | null, src: string) => {
      if (status == null || settled) return;
      const total = status.audioFiles + status.photoFiles;
      if (total > initial) initial = total; // 分母は観測最大に追従
      console.log(
        `[deleteAll] ${src}: total=${total} purging=${status.purging} initial=${initial}`,
      );
      onProgress?.({ total: initial, done: Math.max(0, initial - total) });
      if (status.purging) {
        sawPurging = true;
        return;
      }
      // purging=false。開始 notify を取りこぼしていても、件数が初期値より減っていれば
      // 削除は走った証跡なので完了とみなす（録音中の 1 件残り＝下げ止まりも含む）。
      if (total === 0 || sawPurging || total < initial) {
        console.log(`[deleteAll] FINISH via ${src} (total=${total})`);
        finish();
      }
    };

    statusChar
      .subscribe((data) => apply(parseSyncStatus(data), 'notify'))
      .then((unsub) => {
        if (settled) unsub();
        else unsubscribe = unsub;
      })
      .catch((err) => console.warn('[deleteAll] subscribe failed (read fallback continues)', err));

    fallbackTimer = setInterval(() => {
      statusChar
        .read()
        .then((data) => apply(parseSyncStatus(data), 'read'))
        .catch(() => {}); // 一過性の read 失敗は無視（次の通知/read で回復）
    }, DELETE_POLL_FALLBACK_MS);

    maxTimer = setTimeout(finish, DELETE_MAX_MS);
  });
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
 * （[cmd][u32 id][u32 offset][u32 crcSeed][u8 gen]、firmware/src/config.h 参照）。
 * crcSeed は手元にある先頭 offset バイトの CRC32。esp_rom_crc32_le は LFSR の
 * 合成則を満たすので、デバイスが続きを積み上げても FILE_END のCRCはファイル全体と一致する。
 * gen はこのリクエストの世代番号。デバイスは各 CHUNK/FILE_END にそのまま乗せ返すので、
 * 直前の GET_FILE が BLE パイプラインに残した取りこぼしチャンク（接続スコープの同じ id を
 * 持つ）を gen 不一致で確実に捨てられる。
 * window はこの 1 リクエストで送ってほしいチャンク数（窓サイズ）。デバイスは offset, offset+payload,
 * … を seq 0..window-1 で、front が最後に届くよう逆順送信する。
 */
function getFilePacket(
  fileId: number,
  offset: number,
  crcSeed: number,
  gen: number,
  window: number,
): Uint8Array {
  const packet = new Uint8Array(15);
  packet[0] = SYNC_CMD_GET_FILE;
  const dv = new DataView(packet.buffer);
  dv.setUint32(1, fileId, true);
  dv.setUint32(5, offset >>> 0, true);
  dv.setUint32(9, crcSeed >>> 0, true);
  packet[13] = gen & 0xff;
  packet[14] = window & 0xff;
  return packet;
}

// GET_FILE ごとに 1..255 を巡回して払い出す世代番号（0 は使わない: gen 非対応の旧ファーム
// や残骸は gen=0 を返すので、常に不一致＝stale 扱いになる）。同期をまたいで単調に進めるので、
// 連続するリクエストの世代は必ず異なる。
let nextSyncGen = 1;
function allocSyncGen(): number {
  const gen = nextSyncGen;
  nextSyncGen = (nextSyncGen % 255) + 1;
  return gen;
}

/**
 * 再接続をまたいで再開するための部分転送バッファ。キーは (type, epochMs, size)
 * — firmware のファイル ID は接続スコープで再接続のたびに変わるが、この 3 つは
 * 同じファイルなら接続をまたいで安定する。プロセス内メモリのみ保持するので、
 * アプリ強制終了時は失われ次回 0 から取り直す（安全側）。
 */
// crc は buffer[0:offset] の確定 CRC32（次の GET_FILE の crcSeed に使い、毎回の全再計算を避ける）。
type PartialTransfer = { buffer: Uint8Array; offset: number; crc: number };
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
    private log: (message: string) => void = () => {},
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
        this.log(`manifest FAILED: ${message} (received ${entries.length} entries so far)`);
        reject(new Error(message));
      };
      const arm = () => {
        if (timer != null) clearTimeout(timer);
        timer = setTimeout(() => fail('Manifest transfer timed out'), MANIFEST_PACKET_TIMEOUT_MS);
      };
      this.handler = (packet) => {
        const type = packet[0];
        if (type === SYNC_PKT_MANIFEST) {
          arm(); // 0 件の keep-alive パケットでもここに来てタイマを張り直す
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
          const declared = packet.length >= 3 ? view(packet).getUint16(1, true) : entries.length;
          this.log(
            `manifest done: ${entries.length} entries received (device declared ${declared})`,
          );
          resolve(entries);
        }
      };
      arm();
      this.log('-> MANIFEST');
      this.control.write(controlPacket(SYNC_CMD_MANIFEST)).catch((err) => fail(String(err)));
    });
  }

  /**
   * 1 ウィンドウ分（最大 SYNC_WINDOW_CHUNKS チャンク）を受信する。GET_FILE(offset, window=W) を
   * 1 回だけ応答なし書き込みで送り、デバイスは offset, offset+payload, … を seq 0..W-1 で、front
   * （seq 0）が最後に電波に乗るよう逆順送信して停止する。各チャンクは wcount（窓内チャンク数）を
   * 載せるので、全部揃ったらタイムアウトを待たずに確定できる。
   *
   * BLE 通知は連続 push すると送受信スタック両方で最後の 1 個以外が落ちることがある（issue #74）。
   * 逆順送信のおかげで、最悪 front だけが届いても partial.offset は 1 チャンク前進するので、旧
   * stop-and-wait（W=1）より遅くなることはない。受信したチャンクは seq でまとめ、先頭から連続する
   * 分だけ実バイト長で partial.buffer に積む。欠落で途切れた seq 以降は捨て、次の窓で partial.offset
   * から再要求して回収する。
   *
   * 戻り値:
   *  - { done: true }  全体完了（サイズ一致 + CRC 検証 OK）。
   *  - { done: false } まだ続く（窓を引き切った／欠落で未完の FILE_END／タイムアウト）。呼び出し側が再要求する。
   * CRC 不一致のときだけ partial.offset を 0 に戻し（reject）、頭から取り直させる。
   */
  fetchWindow(
    entry: ManifestEntry,
    partial: PartialTransfer,
    onChunk: (bytes: number) => void,
  ): Promise<{ done: boolean }> {
    return new Promise<{ done: boolean }>((resolve, reject) => {
      const buffer = partial.buffer;
      const gen = allocSyncGen();
      // seq -> payload。逆順・取りこぼしを許容するため一旦ためてから先頭から連結する。
      const received = new Map<number, Uint8Array>();
      let wcount = Number.POSITIVE_INFINITY; // 最初のチャンクで確定
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const arm = () => {
        if (timer != null) clearTimeout(timer);
        timer = setTimeout(() => finish(null), PACKET_TIMEOUT_MS);
      };
      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        if (timer != null) clearTimeout(timer);
        this.handler = null;
        this.log(
          `file ${entry.id} window FAILED: ${message} (have ${partial.offset}/${entry.size})`,
        );
        reject(new Error(message));
      };
      // 窓の確定: 先頭 seq から連続する分だけ実バイト長で積み、結果を返す。fileEndCrc が
      // 渡されたら EOF 確認込みで判定する（タイムアウト時は null）。
      const finish = (fileEndCrc: number | null) => {
        if (settled) return;
        settled = true;
        if (timer != null) clearTimeout(timer);
        this.handler = null;
        for (let seq = 0; received.has(seq); seq++) {
          const payload = received.get(seq) as Uint8Array;
          if (partial.offset + payload.length > buffer.length) {
            // settled は立てたが reject 経路へ。fail() は settled で弾かれるので直接 reject。
            this.log(`file ${entry.id} overflow at seq ${seq}`);
            reject(new Error(`File ${entry.id} overflow at seq ${seq}`));
            return;
          }
          buffer.set(payload, partial.offset);
          partial.offset += payload.length;
          partial.crc = crc32Append(partial.crc, payload);
          onChunk(payload.length);
        }
        if (fileEndCrc != null) {
          if (partial.offset !== entry.size) {
            // 取りこぼしで未完。reject せず再要求させる（partial.offset から続行）。
            this.log(
              `file ${entry.id} FILE_END incomplete ${partial.offset}/${entry.size} -> re-pull`,
            );
            resolve({ done: false });
          } else if (partial.crc !== fileEndCrc) {
            partial.offset = 0; // 壊れているので部分を捨て、頭から取り直す
            partial.crc = 0;
            this.log(`file ${entry.id} CRC mismatch (${entry.size} bytes)`);
            reject(new Error(`File ${entry.id} failed CRC check`));
          } else {
            this.log(`file ${entry.id} OK (${entry.size} bytes)`);
            resolve({ done: true });
          }
          return;
        }
        resolve({ done: false }); // 窓を引き切った（まだ続く）／タイムアウト
      };
      this.handler = (packet) => {
        const type = packet[0];
        if (type !== SYNC_PKT_CHUNK && type !== SYNC_PKT_FILE_END && type !== SYNC_PKT_ERROR) {
          return;
        }
        const v = view(packet);
        const id = v.getUint32(1, true);
        if (id !== entry.id) return; // 別ファイル宛の残骸は無視
        if (type === SYNC_PKT_ERROR) {
          partial.offset = 0; // デバイスが offset を拒否（ファイルが変わった等）→ 頭から
          fail(`Device reported file ${entry.id} unavailable`);
          return;
        }
        if (type === SYNC_PKT_CHUNK) {
          if (v.getUint8(7) !== gen) return; // 前回 GET_FILE の残骸チャンク
          const seq = v.getUint16(5, true);
          wcount = v.getUint8(8);
          // slice（copy）で保持する: 窓内の後続パケットを待つ間バッファを跨いで参照するため。
          received.set(seq, packet.slice(9));
          arm(); // パケットごとにタイムアウトを張り直す
          if (received.size >= wcount) finish(null); // 窓が揃った → 即確定
          return;
        }
        // SYNC_PKT_FILE_END（EOF。チャンクは無く、最後の確認だけ）
        if (v.getUint8(9) !== gen) return; // 残骸 FILE_END は無視
        finish(v.getUint32(5, true));
      };
      arm();
      // 続き（または再要求）は手元のバイトの確定 CRC32 をそのままシードに使う。応答なし書き込みで
      // 往復コストを削り、取りこぼしは上のタイムアウト→再要求で自己修復する。
      this.control
        .writeWithoutResponse(
          getFilePacket(entry.id, partial.offset, partial.crc, gen, SYNC_WINDOW_CHUNKS),
        )
        .catch((err) => fail(String(err)));
    });
  }

  /**
   * 同期開始時の地ならし。前回の同期が中途で終わっていると、その転送のチャンクが
   * BLE パイプライン（デバイスの TX キュー〜電波上〜OS の RX キュー）にまだ残っていて、
   * 新しい GET_FILE の応答に先んじて届く。ABORT でデバイス側の転送を止め、ハンドラを
   * 外したまま少し待って残骸を素通し（drain）させてから次フェーズに入る。gen 判定の
   * 二重の保険であり、ABORT の制御書き込みはファーム側の「同期中」判定もリフレッシュする。
   */
  async reset(): Promise<void> {
    this.handler = null;
    await this.abort().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, DRAIN_MS));
    this.handler = null;
  }

  ack(fileId: number): Promise<void> {
    this.log(`-> ACK id=${fileId}`);
    return this.control.write(controlPacket(SYNC_CMD_ACK_FILE, fileId));
  }

  abort(): Promise<void> {
    this.log('-> ABORT');
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
  // 経過時間つきのトレースロガー。ファーム側の `[<millis>] sync:` ログと突き合わせて
  // 転送の進行・停止箇所を追える（ファイル単位の粒度。チャンク単位のログは出さない）。
  const t0 = Date.now();
  const log = (message: string) => console.log(`[sync +${Date.now() - t0}ms] ${message}`);

  log('start');
  const service = await device.getService(ENVSENSE_SERVICE_UUID);
  const control = await service.getCharacteristic(SYNC_CONTROL_UUID);
  const data = await service.getCharacteristic(SYNC_DATA_UUID);
  const channel = new SyncChannel(control, data, log);
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
    // 前回の同期が残したチャンクを捨ててから始める（gen 判定の保険＋ファーム側の停止）。
    await channel.reset();
    const manifest = await channel.requestManifest();
    // 音声のセッション分割が時系列前提なので、全体を撮影/録音時刻順に処理する。
    manifest.sort((a, b) => a.epochMs - b.epochMs);
    progress.phase = 'transfer';
    progress.totalFiles = manifest.length;
    progress.totalBytes = manifest.reduce((sum, e) => sum + e.size, 0);
    report();
    const audioCount = manifest.filter((e) => e.type === FILE_TYPE_AUDIO).length;
    log(
      `transfer phase: ${manifest.length} files (${audioCount} audio / ${
        manifest.length - audioCount
      } photo), ${progress.totalBytes} bytes total`,
    );

    const ingestor = new AudioSessionIngestor();
    let synced = 0;
    let skipped = 0;
    let syncedBytes = 0;

    let fileIndex = 0;
    for (const entry of manifest) {
      fileIndex += 1;
      // 前回の接続で途中まで受け取っていれば、その続きから再開する。
      const key = partialKey(entry);
      let partial = partialTransfers.get(key);
      if (partial == null || partial.buffer.length !== entry.size) {
        partial = { buffer: new Uint8Array(entry.size), offset: 0, crc: 0 };
      }
      log(
        `file ${fileIndex}/${manifest.length} id=${entry.id} type=${entry.type} size=${
          entry.size
        }${partial.offset > 0 ? ` (resume from ${partial.offset})` : ''}`,
      );
      let bytes: Uint8Array | null = null;
      const chunkBase = progress.doneBytes;
      // 再開分は受信済みとして進捗に反映（onChunk は今回の新規分だけ加算する）。
      progress.doneBytes = chunkBase + partial.offset;
      report();
      // ウィンドウ・プル：完了するまで窓を引き続ける。1 窓で 1 バイトも進まないことが
      // 連続したら（全取りこぼし / タイムアウト）諦めてスキップし、次回の同期で再挑戦する。
      let stalls = 0;
      while (bytes == null && stalls <= MAX_WINDOW_STALLS) {
        const before = partial.offset;
        try {
          const r = await channel.fetchWindow(entry, partial, (n) => {
            progress.doneBytes += n;
            report();
          });
          if (r.done) bytes = partial.buffer;
          else if (partial.offset > before)
            stalls = 0; // 進捗あり → 連続無進捗カウントをリセット
          else stalls += 1; // この窓で 1 バイトも進まなかった
        } catch (err) {
          console.warn(`Sync: file ${entry.id} window failed`, err);
          stalls += 1;
        }
      }
      if (bytes == null) {
        log(`file ${entry.id} SKIPPED (stalled at offset=${partial.offset}/${entry.size})`);
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

      // 空ファイル（撮影/録音の失敗で残ったゴミ）は永続化できない。デバイスから消すため
      // ACK して飛ばす（残すと毎回の同期で再取得し続けてしまう）。
      if (entry.size === 0) {
        log(`file ${entry.id} empty (0 bytes) -> ACK & skip`);
        await channel.ack(entry.id).catch(() => undefined);
        skipped += 1;
        progress.doneFiles += 1;
        report();
        continue;
      }

      // デバイスの時計が一度も合わないまま録られたファイルの保険。firmware が
      // 接続時の TIME_SYNC で補正するため通常は通らない。
      const capturedAt = entry.epochMs >= CLOCK_VALID_MIN_EPOCH_MS ? entry.epochMs : Date.now();
      try {
        if (entry.type === FILE_TYPE_AUDIO) {
          ingestor.ingest(parseOppFrames(bytes), capturedAt);
        } else if (entry.type === FILE_TYPE_PHOTO) {
          persistPhoto(bytes, rotationFromOrientation(entry.orientation), capturedAt);
        }
      } catch (err) {
        // 壊れた画像/音声などで永続化に失敗しても、1 ファイルで同期全体を止めない。
        // ACK せずデバイスに残し（誤削除を避ける）、次のファイルへ進む。
        console.warn(`Sync: file ${entry.id} persist failed, skipping (kept on device)`, err);
        skipped += 1;
        progress.doneFiles += 1;
        report();
        continue;
      }

      await channel.ack(entry.id);
      synced += 1;
      syncedBytes += entry.size;
      progress.doneFiles += 1;
      report();
    }

    progress.phase = 'finishing';
    report();
    log(`transfer done: ${synced} synced, ${skipped} skipped; flushing audio ingestor…`);
    await ingestor.flush();
    log(`finished: ${synced} files (${skipped} skipped), ${syncedBytes} bytes`);
    return { files: synced, skipped, bytes: syncedBytes };
  } catch (err) {
    log(`aborted with error: ${err instanceof Error ? err.message : String(err)}`);
    await channel.abort().catch(() => undefined);
    throw err;
  } finally {
    channel.close();
  }
}

export { ENVSENSE_SERVICE_UUID, SYNC_STATUS_UUID };
