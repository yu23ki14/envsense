/**
 * キャプチャモード（ローカル保存 / ストリーミング）の BLE 操作。
 *
 * MODE_CONTROL キャラクタリスティック（1 バイト, read/write/notify）を介して
 * デバイスの動作モードを読み書きする。デバイスは書き込みのたびに「実効モード」を
 * notify で返す（SD 無しで 'local' を要求すると 'streaming' のまま動く等、要求と
 * 実効が食い違うことがある）ので、UI はこの通知値を正とする。UUID と値は
 * firmware/src/config.h の CAPTURE_MODE_* と一致させる。
 */
import type { BleDevice } from './ble';

const ENVSENSE_SERVICE_UUID = 'ea800000-9c72-497f-81f9-752ffe11f565';
const MODE_CONTROL_UUID = 'ea80000c-9c72-497f-81f9-752ffe11f565';

const CAPTURE_MODE_LOCAL = 0x01;
const CAPTURE_MODE_STREAMING = 0x02;

export type CaptureMode = 'local' | 'streaming';

function fromByte(value: number | undefined): CaptureMode | null {
  if (value === CAPTURE_MODE_LOCAL) return 'local';
  if (value === CAPTURE_MODE_STREAMING) return 'streaming';
  return null;
}

function toByte(mode: CaptureMode): number {
  return mode === 'local' ? CAPTURE_MODE_LOCAL : CAPTURE_MODE_STREAMING;
}

/** 現在の実効モードを読む。旧ファームウェア（キャラクタリスティック無し）は throw。 */
export async function readCaptureMode(device: BleDevice): Promise<CaptureMode | null> {
  const service = await device.getService(ENVSENSE_SERVICE_UUID);
  const char = await service.getCharacteristic(MODE_CONTROL_UUID);
  const data = await char.read();
  return fromByte(data[0]);
}

/** モードを書き込む。実効モードはデバイスからの notify で返ってくる。 */
export async function writeCaptureMode(device: BleDevice, mode: CaptureMode): Promise<void> {
  const service = await device.getService(ENVSENSE_SERVICE_UUID);
  const char = await service.getCharacteristic(MODE_CONTROL_UUID);
  await char.write(new Uint8Array([toByte(mode)]));
}

/** 実効モードの変更通知を購読する。戻り値は購読解除関数。 */
export async function subscribeCaptureMode(
  device: BleDevice,
  callback: (mode: CaptureMode) => void,
): Promise<() => void> {
  const service = await device.getService(ENVSENSE_SERVICE_UUID);
  const char = await service.getCharacteristic(MODE_CONTROL_UUID);
  return char.subscribe((data) => {
    const mode = fromByte(data[0]);
    if (mode != null) callback(mode);
  });
}
