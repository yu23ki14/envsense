import { AudioChunk } from '../schemas';
import { deleteFile } from '../storage/files';
import { StorageKeys } from '../storage/keys';
import { deleteKey, getJSON, setJSON } from '../storage/mmkv';
import { registerAudio, unregisterAudio } from './dayIndex';

export function getAudioChunk(id: string): AudioChunk | null {
  return getJSON(StorageKeys.audio(id), AudioChunk);
}

export function saveAudioChunk(chunk: AudioChunk): void {
  const existing = getAudioChunk(chunk.id);
  setJSON(StorageKeys.audio(chunk.id), AudioChunk, chunk);
  if (existing == null) {
    registerAudio(chunk.id, chunk.startedAt);
  }
}

export function deleteAudioChunk(id: string): void {
  const chunk = getAudioChunk(id);
  if (chunk == null) return;
  deleteFile(chunk.filePath);
  deleteKey(StorageKeys.audio(id));
  unregisterAudio(id, chunk.startedAt);
}

export function getAudioChunksByIds(ids: readonly string[]): AudioChunk[] {
  const out: AudioChunk[] = [];
  for (const id of ids) {
    const chunk = getAudioChunk(id);
    if (chunk != null) out.push(chunk);
  }
  return out;
}
