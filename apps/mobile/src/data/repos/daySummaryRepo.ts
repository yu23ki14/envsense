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
