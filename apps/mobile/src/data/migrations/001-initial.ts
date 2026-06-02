import { DEFAULT_SETTINGS } from '../schemas';
import { StorageKeys } from '../storage/keys';
import { hasKey, mmkv } from '../storage/mmkv';

export const VERSION = 1;

export function up(): void {
  if (!hasKey(StorageKeys.settings)) {
    mmkv.set(StorageKeys.settings, JSON.stringify(DEFAULT_SETTINGS));
  }
}
