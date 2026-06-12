/**
 * 接続中デバイスの常時購読。
 *
 * SDファースト運用（firmware 2.5.0+ で microSD が刺さっている場合）では、
 * メディアは接続の有無に関わらずデバイスの SD に貯まり、転送は同期プロトコル
 * （deviceSync / useDeviceSync）がユーザー操作で行う。このフックの仕事は
 * バッテリー購読だけになる。
 *
 * SYNC_STATUS が読めない（旧ファームウェア）か SD が無い場合は、従来どおり
 * BLE ライブストリーミングで写真と音声を受信するフォールバック経路を張る。
 * 保存パイプラインは同期側と共通の mediaIngest にある。
 */
import { useEffect } from 'react';
import { getPairedDevice, savePairedDevice } from '../data';
import type { BleDevice } from './ble';
import { parseSyncStatus, SYNC_STATUS_UUID } from './deviceSync';
import {
  AudioSessionIngestor,
  FRAMES_PER_SEGMENT,
  persistPhoto,
  rotationFromOrientation,
} from './mediaIngest';

const ENVSENSE_SERVICE_UUID = 'ea800000-9c72-497f-81f9-752ffe11f565';
const PHOTO_DATA_UUID = 'ea800005-9c72-497f-81f9-752ffe11f565';
const PHOTO_CONTROL_UUID = 'ea800006-9c72-497f-81f9-752ffe11f565';
const AUDIO_DATA_UUID = 'ea800001-9c72-497f-81f9-752ffe11f565';
const AUDIO_CODEC_UUID = 'ea800002-9c72-497f-81f9-752ffe11f565';
const BATTERY_SERVICE_UUID = '0000180f-0000-1000-8000-00805f9b34fb';
const BATTERY_LEVEL_UUID = '00002a19-0000-1000-8000-00805f9b34fb';

// 撮影間隔はファームウェア側で固定（firmware/src/config.h の PHOTO_CAPTURE_INTERVAL_MS）。
// photo-control へ書く 5〜300 の値は「ライブ送信開始」のトリガーとしてだけ使われ、
// 値そのものは無視される。UI の表示もこの定数に合わせる。
export const CAPTURE_INTERVAL_SEC = 30;

const AUDIO_CODEC_ID_OPUS = 21;
const AUDIO_PACKET_HEADER_SIZE = 3;

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

/** SDファースト運用かどうか。読めない＝旧ファームは false（ライブ経路へ）。 */
async function isSdFirstDevice(device: BleDevice): Promise<boolean> {
  try {
    const service = await device.getService(ENVSENSE_SERVICE_UUID);
    const char = await service.getCharacteristic(SYNC_STATUS_UUID);
    const status = parseSyncStatus(await char.read());
    return status?.sdOk ?? false;
  } catch {
    return false;
  }
}

export function useDeviceCapture(device: BleDevice | null): void {
  useEffect(() => {
    if (device == null) return;
    let cancelled = false;
    let unsubPhoto: (() => void) | null = null;
    let unsubAudio: (() => void) | null = null;
    let unsubBattery: (() => void) | null = null;
    let ingestor: AudioSessionIngestor | null = null;

    const firmwareVersion = getPairedDevice()?.firmwareVersion ?? '0.0.0';
    const newRotationLogic = compareVersions(firmwareVersion, NEW_ROTATION_FIRMWARE) >= 0;

    (async () => {
      const service = await device.getService(ENVSENSE_SERVICE_UUID);

      // --- Battery ----------------------------------------------------------
      // 標準 Battery Service を read + subscribe し、PairedDevice に残量を保存する。
      // ヘッダーのステータスチップとデバイス画面がここから読む。失敗しても
      // ほかの経路は止めない。
      try {
        const batteryService = await device.getService(BATTERY_SERVICE_UUID);
        const batteryChar = await batteryService.getCharacteristic(BATTERY_LEVEL_UUID);
        const saveBattery = (data: Uint8Array) => {
          const percent = data[0];
          if (percent == null || percent > 100) return;
          const existing = getPairedDevice();
          if (existing == null) return;
          savePairedDevice({ ...existing, lastBatteryPercent: percent });
        };
        saveBattery(await batteryChar.read());
        unsubBattery = await batteryChar.subscribe((data) => {
          if (cancelled) return;
          saveBattery(data);
        });
      } catch (err) {
        console.warn('Could not read battery characteristic', err);
      }

      // --- SD ファースト判定 --------------------------------------------------
      if (await isSdFirstDevice(device)) {
        // メディアはデバイスの SD に貯まる。転送は useDeviceSync の同期操作で
        // 行うので、ここではライブストリーミングを張らない（張らないことが
        // ファームウェア側の送信抑制も兼ねる: 音声は購読が、写真は
        // PHOTO_CONTROL への書き込みがトリガー）。
        return;
      }

      // --- 以降は SD 無し / 旧ファームのライブストリーミングフォールバック ----

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
          const rotation = newRotationLogic ? rotationFromOrientation(orientation) : 180;
          persistPhoto(photoBuffer, rotation, Date.now());
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
      await photoControl.write(new Uint8Array([CAPTURE_INTERVAL_SEC]));

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
      ingestor = new AudioSessionIngestor();
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
            ingestor?.ingest(frames, startedAt);
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
      unsubBattery?.();
      ingestor?.flush().catch(() => undefined);
    };
  }, [device]);
}
