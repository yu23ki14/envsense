import { DaySummary } from '../schemas';
import { StorageKeys } from '../storage/keys';
import { deleteKey, getJSON, setJSON } from '../storage/mmkv';

export function getDaySummary(date: string): DaySummary | null {
  return getJSON(StorageKeys.daySummary(date), DaySummary);
}

export function saveDaySummary(summary: DaySummary): void {
  setJSON(StorageKeys.daySummary(summary.date), DaySummary, summary);
}

export function deleteDaySummary(date: string): void {
  deleteKey(StorageKeys.daySummary(date));
}

/**
 * AI 日記が材料にした写真の 1 枚が削除されたとき、その参照を photoIds から外す。
 * sourcePhotoCount はあえて据え置く: 現在の Day の写真枚数より大きいままになるので、
 * DaySummarySection の「古くなりました（要再生成）」表示が出て手動で作り直せる。
 */
export function removePhotoFromDaySummary(date: string, photoId: string): void {
  const summary = getDaySummary(date);
  if (summary == null || !summary.photoIds.includes(photoId)) return;
  saveDaySummary({ ...summary, photoIds: summary.photoIds.filter((id) => id !== photoId) });
}
