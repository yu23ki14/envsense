import { TimelineEvent } from '../schemas';
import { StorageKeys } from '../storage/keys';
import { deleteKey, getJSON, setJSON } from '../storage/mmkv';
import { listTimelineIdsForDay, registerTimelineEvent, unregisterTimelineEvent } from './dayIndex';

export function getTimelineEvent(id: string): TimelineEvent | null {
  return getJSON(StorageKeys.timeline(id), TimelineEvent);
}

export function saveTimelineEvent(event: TimelineEvent): void {
  const existing = getTimelineEvent(event.id);
  setJSON(StorageKeys.timeline(event.id), TimelineEvent, event);
  if (existing == null) {
    registerTimelineEvent(event.id, event.bucketAt);
  }
}

export function deleteTimelineEvent(id: string): void {
  const event = getTimelineEvent(id);
  if (event == null) return;
  deleteKey(StorageKeys.timeline(id));
  unregisterTimelineEvent(id, event.bucketAt);
}

/**
 * 削除された写真への参照を、その日のすべてのタイムラインイベントの photoIds から外す。
 * イベント自体（タイトル・本文・音声参照）は残す。
 */
export function removePhotoFromTimelineEvents(date: string, photoId: string): void {
  for (const id of listTimelineIdsForDay(date)) {
    const event = getTimelineEvent(id);
    if (event == null || !event.photoIds.includes(photoId)) continue;
    saveTimelineEvent({ ...event, photoIds: event.photoIds.filter((p) => p !== photoId) });
  }
}

export function getTimelineEventsByIds(ids: readonly string[]): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const id of ids) {
    const event = getTimelineEvent(id);
    if (event != null) out.push(event);
  }
  return out;
}
