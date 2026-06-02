import * as SecureStore from 'expo-secure-store';

export const SECRET_KEYS = ['groqApiKey', 'openaiApiKey'] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

export async function getSecret(key: SecretKey): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}

export async function setSecret(key: SecretKey, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value);
}

export async function deleteSecret(key: SecretKey): Promise<void> {
  await SecureStore.deleteItemAsync(key);
}
