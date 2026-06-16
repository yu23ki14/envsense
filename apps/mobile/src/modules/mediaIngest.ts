/**
 * デバイス由来メディアの保存パイプライン共通部。
 *
 * BLE ライブストリーミング（useDeviceCapture のフォールバック経路）と microSD
 * 同期（deviceSync）の両方がここを通る: 写真は Photo repo へ、音声 Opus フレーム
 * 列はセッション単位の連結 Ogg ファイル（AudioSession）へ追記され、約 10 秒
 * 単位で文字起こしされて AudioChunk になる。
 */
import type { AudioSession, PendingTranscription, Photo, PhotoRotation } from '../data';
import {
  addPendingTranscription,
  appendBytes,
  audioSessionPath,
  dateKey,
  getPhoto,
  listPhotoIdsForDay,
  newId,
  pendingAudioPath,
  photoPath,
  saveAudioSession,
  savePhoto,
  writeBytes,
} from '../data';
import { oggOpusAudioPages, oggOpusHeaderBytes, opusFramesToOgg, randomOggSerial } from './audio';
import { beginBackgroundWork } from './backgroundWork';
import { computeDHash, isDuplicateHash } from './imageHash';
import { transcribePending } from './transcriptionBacklog';

// 取り込み時に重複判定で比較する「直前の写真」枚数。後続写真の取り込み時に対称的に
// 比較されるので、これが実質「前後 N 枚ずつ」の窓になる。
const DEDUP_NEIGHBOR_COUNT = 2;

export const FRAMES_PER_SEGMENT = 500; // ~10s at 20ms per Opus frame.
export const FRAME_DURATION_MS = 20;
export const SEGMENT_DURATION_MS = FRAMES_PER_SEGMENT * FRAME_DURATION_MS;
// A gap longer than this (or a date change) starts a new audio session.
export const SESSION_GAP_MS = 15 * 60 * 1000;

export function rotationFromOrientation(orientation: number): PhotoRotation {
  switch (orientation) {
    case 1:
      return 90;
    case 2:
      return 180;
    case 3:
      return 270;
    default:
      return 0;
  }
}

/**
 * Read a JPEG's pixel dimensions from its Start-Of-Frame marker. The firmware's
 * resolution isn't reported over BLE and isn't controlled by the app settings,
 * so deriving width/height from the actual bytes keeps the stored metadata
 * correct regardless of the firmware's frame size. Returns null if no SOF
 * marker is found.
 */
export function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let i = 2; // skip SOI (0xFFD8)
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1] ?? 0;
    // SOF0..SOF15 carry the frame size, excluding DHT/DAC/DNL (0xC4/0xCC/0xC8).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = ((bytes[i + 5] ?? 0) << 8) | (bytes[i + 6] ?? 0);
      const width = ((bytes[i + 7] ?? 0) << 8) | (bytes[i + 8] ?? 0);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    const segLen = ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0);
    if (segLen < 2) break;
    i += 2 + segLen;
  }
  return null;
}

/**
 * 取り込もうとしている写真が、同じ日の直前 DEDUP_NEIGHBOR_COUNT 枚のいずれかと
 * 「ほぼ同じ画像」か。phash 未保存（旧レコードやデコード失敗）の近傍は比較対象外。
 */
function isDuplicateOfRecentPhotos(phash: string, capturedAt: number): boolean {
  const ids = listPhotoIdsForDay(dateKey(capturedAt));
  const recent = ids.slice(-DEDUP_NEIGHBOR_COUNT);
  for (const id of recent) {
    const neighbor = getPhoto(id);
    if (neighbor?.phash != null && isDuplicateHash(phash, neighbor.phash)) {
      return true;
    }
  }
  return false;
}

/**
 * デバイス由来の 1 枚を保存する。保存前に同じ日の直前 2 枚と知覚ハッシュを比較し、
 * ほぼ同じ画像なら保存せず破棄する（ストリーミングはメモリ上のバッファを捨てるだけ、
 * 同期は呼び出し側で ACK 済み = デバイス SD からは削除される）。
 * 実際に保存したら true、重複として破棄したら false を返す。
 */
export function persistPhoto(
  buffer: Uint8Array,
  rotationDeg: PhotoRotation,
  capturedAt: number,
): boolean {
  // phash が取れない（デコード失敗）場合は重複判定をスキップして通常保存する。
  const phash = computeDHash(buffer);
  if (phash != null && isDuplicateOfRecentPhotos(phash, capturedAt)) {
    return false;
  }

  const id = newId();
  const relative = photoPath(capturedAt, id);
  writeBytes(relative, buffer);
  const { width, height } = jpegDimensions(buffer) ?? { width: 0, height: 0 };
  const photo: Photo = {
    id,
    capturedAt,
    filePath: relative,
    width,
    height,
    bytes: buffer.length,
    rotationDeg,
    phash,
    isBlurry: null,
    description: null,
    descriptionAt: null,
    descriptionModel: null,
  };
  savePhoto(photo);
  return true;
}

/**
 * The device encodes exactly one 20 ms frame per Opus packet, which is always
 * TOC "code 0" (single-frame). A packet with any other code was corrupted in
 * transit (rare BLE glitches). Such a frame makes the whole Ogg/Opus stream
 * undecodable from that point: ffmpeg skips it but ExoPlayer (Android playback)
 * aborts at the first one, so we drop corrupt frames before muxing.
 */
export function isIntactOpusFrame(frame: Uint8Array): boolean {
  return frame.length >= 1 && (frame[0] & 0x03) === 0;
}

/** Open a new session file with its Ogg header pages and persist the record. */
function startSession(date: string, startedAt: number): AudioSession {
  const id = newId();
  const serial = randomOggSerial();
  const filePath = audioSessionPath(startedAt, id);
  writeBytes(filePath, oggOpusHeaderBytes(serial));
  const session: AudioSession = {
    id,
    date,
    startedAt,
    endedAt: startedAt,
    filePath,
    durationMs: 0,
    chunkCount: 0,
    finalized: false,
    ogg: { serial, nextSequence: 2, granuleFrames: 0 },
  };
  saveAudioSession(session);
  return session;
}

/** Append one segment's audio pages to the session file and advance its state. */
function appendSegment(
  session: AudioSession,
  frames: Uint8Array[],
  startedAt: number,
  endedAt: number,
): AudioSession {
  const { bytes, nextSequence, nextGranuleFrames } = oggOpusAudioPages({
    frames,
    serial: session.ogg.serial,
    startSequence: session.ogg.nextSequence,
    startGranuleFrames: session.ogg.granuleFrames,
  });
  appendBytes(session.filePath, bytes);
  const updated: AudioSession = {
    ...session,
    endedAt,
    durationMs: session.durationMs + (endedAt - startedAt),
    chunkCount: session.chunkCount + 1,
    ogg: { serial: session.ogg.serial, nextSequence, granuleFrames: nextGranuleFrames },
  };
  saveAudioSession(updated);
  return updated;
}

function finalizeSession(session: AudioSession): void {
  if (session.finalized) return;
  // We can't flag the file's last page as EOS without rewriting it (we never
  // know a segment is the last one until a later gap/disconnect), so we only
  // mark the record finalized. Players tolerate an Ogg stream with no EOS page.
  saveAudioSession({ ...session, finalized: true });
}

// Stage one segment for transcription as a standalone Ogg file (RN can't build
// a Blob from bytes, so the upload reads back a real file) plus a persisted
// PendingTranscription record. Both are written before transcription starts,
// so segments still waiting in the queue survive an app kill and can be
// resumed (transcriptionBacklog).
function stagePendingTranscription(
  sessionId: string,
  startedAt: number,
  endedAt: number,
  frames: Uint8Array[],
): PendingTranscription {
  const id = newId();
  const pending: PendingTranscription = {
    id,
    sessionId,
    startedAt,
    endedAt,
    filePath: pendingAudioPath(id),
  };
  writeBytes(pending.filePath, opusFramesToOgg(frames));
  addPendingTranscription(pending);
  return pending;
}

/**
 * デバイス時刻つきの Opus フレーム列（≒1 発話 / ライブの 1 セグメント）を
 * セッションへ振り分けて追記し、文字起こしをキューに積む。
 *
 * セッション分割（日付変更 / SESSION_GAP_MS 超の間隔）はライブと同期で同一
 * ロジック。文字起こしは転送と並行しつつ 1 件ずつ直列実行され、`flush()` は
 * その完了を待たずにバックグラウンドへ委ねる（issue #74）。
 */
export class AudioSessionIngestor {
  private active: AudioSession | null = null;
  private transcriptionQueue: Promise<void> = Promise.resolve();

  /** `startedAt` はフレーム列先頭の実時刻（デバイス時計、ミリ秒）。 */
  ingest(rawFrames: Uint8Array[], startedAt: number): void {
    const frames = rawFrames.filter(isIntactOpusFrame);
    const dropped = rawFrames.length - frames.length;
    if (dropped > 0) console.warn(`Dropped ${dropped} corrupt audio frame(s)`);

    // 長い発話は既存のチャンク粒度（約 10 秒）に割って既存パイプラインへ流す。
    for (let offset = 0; offset < frames.length; offset += FRAMES_PER_SEGMENT) {
      const segment = frames.slice(offset, offset + FRAMES_PER_SEGMENT);
      const segmentStart = startedAt + offset * FRAME_DURATION_MS;
      this.ingestSegment(segment, segmentStart);
    }
  }

  private ingestSegment(frames: Uint8Array[], startedAt: number): void {
    if (frames.length === 0) return;
    const endedAt = startedAt + frames.length * FRAME_DURATION_MS;
    const date = dateKey(startedAt);
    const gap = this.active != null ? startedAt - this.active.endedAt : Number.POSITIVE_INFINITY;
    if (this.active == null || this.active.date !== date || gap > SESSION_GAP_MS) {
      if (this.active != null) finalizeSession(this.active);
      this.active = startSession(date, startedAt);
    }
    this.active = appendSegment(this.active, frames, startedAt, endedAt);

    const pending = stagePendingTranscription(this.active.id, startedAt, endedAt, frames);
    // begin/end は「キュー待ち〜完了」を覆う。BLE 切断後もキューが空になるまで
    // keepAlive のフォアグラウンドサービスを維持するため（backgroundWork）。
    const endWork = beginBackgroundWork();
    this.transcriptionQueue = this.transcriptionQueue
      .then(() => transcribePending(pending))
      .finally(endWork);
  }

  /**
   * アクティブセッションを閉じる。積まれた文字起こしキューは **待たない**。
   *
   * 文字起こしは各セグメントが個別に張る beginBackgroundWork（ingestSegment）で
   * バックグラウンド継続し、未処理分は再開バナー / DeviceProvider の起動時
   * 自動再開（resumePendingTranscriptions）に委ねる。同期完了を全件の文字起こし
   * 完了に待たせると、大量バックログや 1 件の通信無応答で同期 UI が固まるため
   * （issue #74）、ここではセッション確定だけを行う。
   */
  async flush(): Promise<void> {
    if (this.active != null) {
      finalizeSession(this.active);
      this.active = null;
    }
  }
}
