/**
 * Subscribe to a connected BleDevice and persist photos / audio chunks to
 * the local repositories. The transcription pipeline lives separately and
 * fills in AudioChunk.transcript later.
 */
import { useEffect } from 'react';
import type { CaptureSettings, Photo, PhotoRotation } from '../data';
import {
  audioPath,
  getPairedDevice,
  getSettings,
  newId,
  photoPath,
  saveAudioChunk,
  savePhoto,
  writeBytes,
} from '../data';
import { opusFramesToOgg } from './audio';
import type { BleDevice } from './ble';

const ENVSENSE_SERVICE_UUID = 'ea800000-9c72-497f-81f9-752ffe11f565';
const PHOTO_DATA_UUID = 'ea800005-9c72-497f-81f9-752ffe11f565';
const PHOTO_CONTROL_UUID = 'ea800006-9c72-497f-81f9-752ffe11f565';
const AUDIO_DATA_UUID = 'ea800001-9c72-497f-81f9-752ffe11f565';
const AUDIO_CODEC_UUID = 'ea800002-9c72-497f-81f9-752ffe11f565';

const AUDIO_CODEC_ID_OPUS = 21;
const AUDIO_PACKET_HEADER_SIZE = 3;
const FRAMES_PER_SEGMENT = 500; // ~10s at 20ms per Opus frame.
const SEGMENT_DURATION_MS = FRAMES_PER_SEGMENT * 20;

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

function dimensionsFor(capture: CaptureSettings): { width: number; height: number } {
  switch (capture.resolution) {
    case 'SVGA':
      return { width: 800, height: 600 };
    case 'VGA':
    default:
      return { width: 640, height: 480 };
  }
}

function persistPhoto(buffer: Uint8Array, rotationDeg: PhotoRotation): void {
  const id = newId();
  const capturedAt = Date.now();
  const relative = photoPath(capturedAt, id);
  writeBytes(relative, buffer);
  const { width, height } = dimensionsFor(getSettings().capture);
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

function persistAudioChunk(frames: Uint8Array[], startedAt: number, endedAt: number): void {
  if (frames.length === 0) return;
  const id = newId();
  const relative = audioPath(startedAt, id);
  const ogg = opusFramesToOgg(frames);
  writeBytes(relative, ogg);
  saveAudioChunk({
    id,
    startedAt,
    endedAt,
    filePath: relative,
    bytes: ogg.length,
    transcript: null,
    transcribedAt: null,
  });
}

export function useDeviceCapture(device: BleDevice | null): void {
  useEffect(() => {
    if (device == null) return;
    let cancelled = false;
    let unsubPhoto: (() => void) | null = null;
    let unsubAudio: (() => void) | null = null;

    const firmwareVersion = getPairedDevice()?.firmwareVersion ?? '0.0.0';
    const newRotationLogic = compareVersions(firmwareVersion, NEW_ROTATION_FIRMWARE) >= 0;

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
        if (segmentStartedAt == null) segmentStartedAt = Date.now();
        pendingFrames.push(array.slice(AUDIO_PACKET_HEADER_SIZE));
        if (pendingFrames.length >= FRAMES_PER_SEGMENT) {
          const frames = pendingFrames;
          const startedAt = segmentStartedAt;
          pendingFrames = [];
          segmentStartedAt = null;
          persistAudioChunk(frames, startedAt, startedAt + SEGMENT_DURATION_MS);
        }
      });
    })().catch((err) => {
      if (!cancelled) console.error('Device capture pipeline failed', err);
    });

    return () => {
      cancelled = true;
      unsubPhoto?.();
      unsubAudio?.();
    };
  }, [device]);
}
