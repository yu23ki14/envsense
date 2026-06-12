/**
 * デバイス由来メディアの保存パイプライン共通部。
 *
 * BLE ライブストリーミング（useDeviceCapture のフォールバック経路）と microSD
 * 同期（deviceSync）の両方がここを通る: 写真は Photo repo へ、音声 Opus フレーム
 * 列はセッション単位の連結 Ogg ファイル（AudioSession）へ追記され、約 10 秒
 * 単位で文字起こしされて AudioChunk になる。
 */
import type { AudioSession, Photo, PhotoRotation } from '../data';
import {
  appendBytes,
  audioSessionPath,
  dateKey,
  deleteFile,
  newId,
  photoPath,
  saveAudioChunk,
  saveAudioSession,
  savePhoto,
  tempAudioPath,
  writeBytes,
} from '../data';
import { oggOpusAudioPages, oggOpusHeaderBytes, opusFramesToOgg, randomOggSerial } from './audio';
import { transcribe } from './llm';

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

export function persistPhoto(
  buffer: Uint8Array,
  rotationDeg: PhotoRotation,
  capturedAt: number,
): void {
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
    isBlurry: null,
    description: null,
    descriptionAt: null,
    descriptionModel: null,
  };
  savePhoto(photo);
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

// Transcribe one segment via a transient Ogg file (RN can't build a Blob from
// bytes, so the upload reads back a real file). A chunk is only saved when
// transcription returns speech — silent/non-speech segments (which Whisper
// otherwise hallucinates onto) yield an empty string and no chunk.
async function transcribeChunk(
  sessionId: string,
  startedAt: number,
  endedAt: number,
  frames: Uint8Array[],
): Promise<void> {
  const id = newId();
  const tempRel = tempAudioPath(id);
  try {
    writeBytes(tempRel, opusFramesToOgg(frames));
    const { text, model } = await transcribe(tempRel);
    if (text.length === 0) return;
    saveAudioChunk({
      id,
      sessionId,
      startedAt,
      endedAt,
      transcript: { text, model },
      transcribedAt: Date.now(),
    });
  } catch (err) {
    console.warn('Transcription failed', err);
  } finally {
    deleteFile(tempRel);
  }
}

/**
 * デバイス時刻つきの Opus フレーム列（≒1 発話 / ライブの 1 セグメント）を
 * セッションへ振り分けて追記し、文字起こしをキューに積む。
 *
 * セッション分割（日付変更 / SESSION_GAP_MS 超の間隔）はライブと同期で同一
 * ロジック。文字起こしは転送と並行しつつ 1 件ずつ直列実行され、`flush()` で
 * 完了を待てる。
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

    const sessionId = this.active.id;
    this.transcriptionQueue = this.transcriptionQueue.then(() =>
      transcribeChunk(sessionId, startedAt, endedAt, frames),
    );
  }

  /** アクティブセッションを閉じ、積まれた文字起こしの完了を待つ。 */
  async flush(): Promise<void> {
    if (this.active != null) {
      finalizeSession(this.active);
      this.active = null;
    }
    await this.transcriptionQueue;
  }
}
