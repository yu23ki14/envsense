import { PairedDevice } from '../schemas';
import { StorageKeys } from '../storage/keys';
import { deleteKey, getJSON, setJSON } from '../storage/mmkv';

export function getPairedDevice(): PairedDevice | null {
  return getJSON(StorageKeys.pairedDevice, PairedDevice);
}

export function savePairedDevice(device: PairedDevice): void {
  setJSON(StorageKeys.pairedDevice, PairedDevice, device);
}

export function clearPairedDevice(): void {
  deleteKey(StorageKeys.pairedDevice);
}
