import { rebuildDay } from '../repos/dayBuilder';
import { listDates } from '../repos/dayIndex';
import { StoragePrefixes } from '../storage/keys';
import { deleteKey, keysWithPrefix } from '../storage/mmkv';

export const VERSION = 2;

/**
 * The audio model changed: per-chunk Ogg files were replaced by
 * session-concatenated audio, and AudioChunk gained a `sessionId`. Old chunks
 * can't be migrated to the new shape, so drop the (dev-only) audio data and its
 * day index, then rebuild every Day rollup so it carries the new
 * `audioSessionIds` field and a corrected `audioTotalMs`. Photos, highlights,
 * and the date index are left intact.
 */
export function up(): void {
  for (const key of keysWithPrefix(StoragePrefixes.audio)) deleteKey(key);
  for (const key of keysWithPrefix('index:audios-by-day:')) deleteKey(key);
  for (const date of listDates()) rebuildDay(date);
}
