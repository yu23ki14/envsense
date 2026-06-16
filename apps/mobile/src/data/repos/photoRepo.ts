import { dateKey } from '../ids';
import { Photo } from '../schemas';
import { deleteFile } from '../storage/files';
import { StorageKeys } from '../storage/keys';
import { deleteKey, getJSON, setJSON } from '../storage/mmkv';
import { registerPhoto, unregisterPhoto } from './dayIndex';
import { removePhotoFromDaySummary } from './daySummaryRepo';
import { removePhotoFromTimelineEvents } from './timelineEventRepo';

export function getPhoto(id: string): Photo | null {
  return getJSON(StorageKeys.photo(id), Photo);
}

export function savePhoto(photo: Photo): void {
  const existing = getPhoto(photo.id);
  setJSON(StorageKeys.photo(photo.id), Photo, photo);
  if (existing == null) {
    registerPhoto(photo.id, photo.capturedAt);
  }
}

/**
 * 写真を 1 枚削除する。JPEG・MMKV レコード・日インデックスに加えて、その写真への
 * AI 推論データの参照も掃除する: 写真自身の説明文（description/descriptionAt/
 * descriptionModel）はレコード削除で一緒に消え、DaySummary / TimelineEvent が
 * 持つ photoIds 参照も外す（紐づく AI 生成物にダングリング参照を残さない）。
 */
export function deletePhoto(id: string): void {
  const photo = getPhoto(id);
  if (photo == null) return;
  deleteFile(photo.filePath);
  deleteKey(StorageKeys.photo(id));
  unregisterPhoto(id, photo.capturedAt);
  const date = dateKey(photo.capturedAt);
  removePhotoFromDaySummary(date, id);
  removePhotoFromTimelineEvents(date, id);
}

export function getPhotosByIds(ids: readonly string[]): Photo[] {
  const out: Photo[] = [];
  for (const id of ids) {
    const photo = getPhoto(id);
    if (photo != null) out.push(photo);
  }
  return out;
}
