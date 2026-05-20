import AsyncStorage from '@react-native-async-storage/async-storage';

// AsyncStorage automatically falls back to localStorage on web, so we can
// use the same module across platforms.
export async function storageGet(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function storageSet(key: string, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    /* best-effort */
  }
}

export async function storageRemove(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    /* best-effort */
  }
}
