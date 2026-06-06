/**
 * Subscribe to a connected BleDevice and persist photos and audio. Photos go to
 * the photo repo; audio is appended to a per-session concatenated Ogg/Opus file
 * (see {@link AudioSession}) and each ~10 s segment is transcribed via Groq,
 * with the text stored on its {@link AudioChunk}.
 */
import { useEffect } from 'react';
import type { AudioSession, Photo, PhotoRotation } from '../data';
import {
  appendBytes,
  audioSessionPath,
  dateKey,
  deleteFile,
  getPairedDevice,
  getSettings,
  newId,
  photoPath,
  saveAudioChunk,
  saveAudioSession,
  savePhoto,
  tempAudioPath,
  writeBytes,
} from '../data';
import { oggOpusAudioPages, oggOpusHeaderBytes, opusFramesToOgg, randomOggSerial } from './audio';
import type { BleDevice } from './ble';
import { transcribeAudioFile } from './whisper';

// Groq Whisper model used by transcribeAudioFile; recorded on each AudioChunk.
const TRANSCRIPTION_MODEL = 'whisper-large-v3-turbo';

const ENVSENSE_SERVICE_UUID = 'ea800000-9c72-497f-81f9-752ffe11f565';
const PHOTO_DATA_UUID = 'ea800005-9c72-497f-81f9-752ffe11f565';
const PHOTO_CONTROL_UUID = 'ea800006-9c72-497f-81f9-752ffe11f565';
const AUDIO_DATA_UUID = 'ea800001-9c72-497f-81f9-752ffe11f565';
const AUDIO_CODEC_UUID = 'ea800002-9c72-497f-81f9-752ffe11f565';

const AUDIO_CODEC_ID_OPUS = 21;
const AUDIO_PACKET_HEADER_SIZE = 3;
const FRAMES_PER_SEGMENT = 500; // ~10s at 20ms per Opus frame.
const SEGMENT_DURATION_MS = FRAMES_PER_SEGMENT * 20;
// A gap longer than this (or a date change) starts a new audio session.
const SESSION_GAP_MS = 15 * 60 * 1000;

const NEW_ROTATION_FIRMWARE = '2.1.1';

function compareVersions(v1: string, v2: string): number {
  const a = v1.split('.').map(Number);
  const b = v2.split('.').map(Number);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function rotationFromOrientation(orientation: number): PhotoRotation {
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
 * resolution isn't reported in the BLE stream and isn't controlled by the app
 * settings, so deriving width/height from the actual bytes keeps the stored
 * metadata correct regardless of the firmware's frame size. Returns null if no
 * SOF marker is found.
 */
function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
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

function persistPhoto(buffer: Uint8Array, rotationDeg: PhotoRotation): void {
  const id = newId();
  const capturedAt = Date.now();
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
function isIntactOpusFrame(frame: Uint8Array): boolean {
  return frame.length >= 1 && (frame[0] & 0x03) === 0;
}

// --- Audio session writer ---------------------------------------------------

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

export function useDeviceCapture(device: BleDevice | null): void {
  useEffect(() => {
    if (device == null) return;
    let cancelled = false;
    let unsubPhoto: (() => void) | null = null;
    let unsubAudio: (() => void) | null = null;
    let activeSession: AudioSession | null = null;

    const firmwareVersion = getPairedDevice()?.firmwareVersion ?? '0.0.0';
    const newRotationLogic = compareVersions(firmwareVersion, NEW_ROTATION_FIRMWARE) >= 0;

    // Transcribe one segment via a transient Ogg file (RN can't build a Blob
    // from bytes, so the upload reads back a real file). A chunk is only saved
    // when transcription returns speech — silent/non-speech segments (which
    // Whisper otherwise hallucinates onto) yield an empty string and no chunk.
    const transcribeChunk = async (
      sessionId: string,
      startedAt: number,
      endedAt: number,
      frames: Uint8Array[],
    ) => {
      const id = newId();
      const tempRel = tempAudioPath(id);
      try {
        writeBytes(tempRel, opusFramesToOgg(frames));
        const text = await transcribeAudioFile(tempRel);
        if (cancelled || text.length === 0) return;
        saveAudioChunk({
          id,
          sessionId,
          startedAt,
          endedAt,
          transcript: { text, model: TRANSCRIPTION_MODEL },
          transcribedAt: Date.now(),
        });
      } catch (err) {
        if (!cancelled) console.warn('Transcription failed', err);
      } finally {
        deleteFile(tempRel);
      }
    };

    const onSegment = (rawFrames: Uint8Array[], startedAt: number) => {
      const frames = rawFrames.filter(isIntactOpusFrame);
      const dropped = rawFrames.length - frames.length;
      if (dropped > 0) console.warn(`Dropped ${dropped} corrupt audio frame(s)`);
      if (frames.length === 0) return;
      const endedAt = startedAt + SEGMENT_DURATION_MS;
      const date = dateKey(startedAt);
      const gap =
        activeSession != null ? startedAt - activeSession.endedAt : Number.POSITIVE_INFINITY;
      if (activeSession == null || activeSession.date !== date || gap > SESSION_GAP_MS) {
        if (activeSession != null) finalizeSession(activeSession);
        activeSession = startSession(date, startedAt);
      }
      activeSession = appendSegment(activeSession, frames, startedAt, endedAt);

      // The audio is always recorded into the session; transcribeChunk only
      // persists a chunk if the segment actually contains speech.
      transcribeChunk(activeSession.id, startedAt, endedAt, frames);
    };

    (async () => {
      const service = await device.getService(ENVSENSE_SERVICE_UUID);

      // --- Photo pipeline ---------------------------------------------------
      let previousChunk = -1;
      let photoBuffer: Uint8Array = new Uint8Array(0);
      let orientation = 0;

      const onPhotoChunk = (id: number | null, data: Uint8Array) => {
        if (previousChunk === -1) {
          if (id === 0) {
            previousChunk = 0;
            photoBuffer = new Uint8Array(0);
            if (newRotationLogic && data.length > 0) {
              orientation = data[0] ?? 0;
              photoBuffer = data.slice(1);
            } else {
              photoBuffer = data;
            }
          }
          return;
        }
        if (id === null) {
          const rotation: PhotoRotation = newRotationLogic
            ? rotationFromOrientation(orientation)
            : 180;
          persistPhoto(photoBuffer, rotation);
          previousChunk = -1;
          return;
        }
        if (id !== previousChunk + 1) {
          previousChunk = -1;
          return;
        }
        previousChunk = id;
        const next = new Uint8Array(photoBuffer.length + data.length);
        next.set(photoBuffer, 0);
        next.set(data, photoBuffer.length);
        photoBuffer = next;
      };

      const photoChar = await service.getCharacteristic(PHOTO_DATA_UUID);
      unsubPhoto = await photoChar.subscribe((array) => {
        if (cancelled) return;
        if (array[0] === 0xff && array[1] === 0xff) {
          onPhotoChunk(null, new Uint8Array());
        } else {
          const packetId = (array[0] ?? 0) + ((array[1] ?? 0) << 8);
          onPhotoChunk(packetId, array.slice(2));
        }
      });

      const photoControl = await service.getCharacteristic(PHOTO_CONTROL_UUID);
      const intervalSec = Math.min(255, Math.max(1, getSettings().capture.intervalSec));
      await photoControl.write(new Uint8Array([intervalSec]));

      // --- Audio pipeline ---------------------------------------------------
      try {
        const codecChar = await service.getCharacteristic(AUDIO_CODEC_UUID);
        const codecBytes = await codecChar.read();
        const codecId = codecBytes[0];
        if (codecId !== AUDIO_CODEC_ID_OPUS) {
          console.warn(`Unexpected audio codec id ${codecId}; skipping capture`);
          return;
        }
      } catch (err) {
        console.warn('Could not read audio codec characteristic', err);
        return;
      }

      const audioChar = await service.getCharacteristic(AUDIO_DATA_UUID);
      let pendingFrames: Uint8Array[] = [];
      let segmentStartedAt: number | null = null;

      unsubAudio = await audioChar.subscribe((array) => {
        if (cancelled) return;
        if (array.length <= AUDIO_PACKET_HEADER_SIZE) return;
        // Batched packet: [idx_lo, idx_hi, frameCount] then frameCount times a
        // 1-byte length followed by that many Opus frame bytes. Parsing by
        // length to the end of the buffer also tolerates a wrong count byte.
        let offset = AUDIO_PACKET_HEADER_SIZE;
        while (offset < array.length) {
          const len = array[offset] ?? 0;
          offset += 1;
          if (len === 0 || offset + len > array.length) break;
          if (segmentStartedAt == null) segmentStartedAt = Date.now();
          pendingFrames.push(array.slice(offset, offset + len));
          offset += len;
          if (pendingFrames.length >= FRAMES_PER_SEGMENT) {
            const frames = pendingFrames;
            const startedAt = segmentStartedAt;
            pendingFrames = [];
            segmentStartedAt = null;
            onSegment(frames, startedAt);
          }
        }
      });
    })().catch((err) => {
      if (!cancelled) console.error('Device capture pipeline failed', err);
    });

    return () => {
      cancelled = true;
      unsubPhoto?.();
      unsubAudio?.();
      if (activeSession != null) finalizeSession(activeSession);
    };
  }, [device]);
}
