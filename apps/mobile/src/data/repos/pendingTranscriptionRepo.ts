/**
 * 文字起こし待ちキューの永続化。件数が小さい（中断時の残量だけ）ため、
 * 1 キーに配列で持つ。読み書きは JS シングルスレッド前提の read-modify-write。
 */
import { type PendingTranscription, PendingTranscriptionList } from '../schemas';
import { StorageKeys } from '../storage/keys';
import { getJSON, setJSON } from '../storage/mmkv';

export function listPendingTranscriptions(): PendingTranscription[] {
  return getJSON(StorageKeys.pendingTranscriptions, PendingTranscriptionList) ?? [];
}

export function addPendingTranscription(pending: PendingTranscription): void {
  const list = listPendingTranscriptions().filter((p) => p.id !== pending.id);
  list.push(pending);
  setJSON(StorageKeys.pendingTranscriptions, PendingTranscriptionList, list);
}

export function removePendingTranscription(id: string): void {
  const list = listPendingTranscriptions();
  const filtered = list.filter((p) => p.id !== id);
  if (filtered.length === list.length) return;
  setJSON(StorageKeys.pendingTranscriptions, PendingTranscriptionList, filtered);
}
