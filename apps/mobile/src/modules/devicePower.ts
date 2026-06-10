/**
 * BLE 経由のデバイス電源操作（スリープ / 再起動）。
 *
 * コマンドを書き込むとファームウェア側は即ディープスリープ / 再起動して
 * BLE が切断されるため、書き込み成功直後の切断はエラーではなく成功として
 * 扱うこと。スリープからの復帰は本体の銅箔タッチかボタンのみ（BLE では
 * 起こせない）。UUID とコマンド値は firmware/src/config.h と一致させる。
 */
import type { BleDevice } from './ble';

const ENVSENSE_SERVICE_UUID = 'ea800000-9c72-497f-81f9-752ffe11f565';
const POWER_CONTROL_UUID = 'ea800007-9c72-497f-81f9-752ffe11f565';

const POWER_CMD_SLEEP = 0x01;
const POWER_CMD_REBOOT = 0x02;

async function writePowerCommand(device: BleDevice, command: number): Promise<void> {
  const service = await device.getService(ENVSENSE_SERVICE_UUID);
  const characteristic = await service.getCharacteristic(POWER_CONTROL_UUID);
  await characteristic.write(new Uint8Array([command]));
}

/** デバイスをディープスリープさせる。直後に BLE は切断される。 */
export function sleepDevice(device: BleDevice): Promise<void> {
  return writePowerCommand(device, POWER_CMD_SLEEP);
}

/** デバイスを再起動する。一時的に BLE は切断される。 */
export function rebootDevice(device: BleDevice): Promise<void> {
  return writePowerCommand(device, POWER_CMD_REBOOT);
}
