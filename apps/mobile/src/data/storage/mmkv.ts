import { createMMKV } from 'react-native-mmkv';
import type { z } from 'zod';

export const mmkv = createMMKV({ id: 'envsense' });

export function getJSON<T>(key: string, schema: z.ZodType<T>): T | null {
  const raw = mmkv.getString(key);
  if (raw == null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = schema.safeParse(parsed);
  return result.success ? result.data : null;
}

export function setJSON<T>(key: string, schema: z.ZodType<T>, value: T): void {
  const validated = schema.parse(value);
  mmkv.set(key, JSON.stringify(validated));
}

export function deleteKey(key: string): void {
  mmkv.remove(key);
}

export function hasKey(key: string): boolean {
  return mmkv.contains(key);
}

export function keysWithPrefix(prefix: string): string[] {
  return mmkv.getAllKeys().filter((k: string) => k.startsWith(prefix));
}
