import { Photo } from '../schemas';
import { deleteFile } from '../storage/files';
import { StorageKeys } from '../storage/keys';
import { deleteKey, getJSON, setJSON } from '../storage/mmkv';
import { registerPhoto, unregisterPhoto } from './dayIndex';

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

export function deletePhoto(id: string): void {
  const photo = getPhoto(id);
  if (photo == null) return;
  deleteFile(photo.filePath);
  deleteKey(StorageKeys.photo(id));
  unregisterPhoto(id, photo.capturedAt);
}

export function getPhotosByIds(ids: readonly string[]): Photo[] {
  const out: Photo[] = [];
  for (const id of ids) {
    const photo = getPhoto(id);
    if (photo != null) out.push(photo);
  }
  return out;
}
