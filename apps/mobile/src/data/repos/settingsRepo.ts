import { DEFAULT_SETTINGS, Settings } from '../schemas';
import { StorageKeys } from '../storage/keys';
import { getJSON, setJSON } from '../storage/mmkv';

export function getSettings(): Settings {
  return getJSON(StorageKeys.settings, Settings) ?? DEFAULT_SETTINGS;
}

export function saveSettings(settings: Settings): void {
  setJSON(StorageKeys.settings, Settings, settings);
}

export function updateSettings(patch: (current: Settings) => Settings): Settings {
  const next = patch(getSettings());
  saveSettings(next);
  return next;
}
