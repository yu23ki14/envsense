import { AudioSession } from '../schemas';
import { deleteFile } from '../storage/files';
import { StorageKeys } from '../storage/keys';
import { deleteKey, getJSON, setJSON } from '../storage/mmkv';
import { registerAudioSession, unregisterAudioSession } from './dayIndex';

export function getAudioSession(id: string): AudioSession | null {
  return getJSON(StorageKeys.audioSession(id), AudioSession);
}

export function saveAudioSession(session: AudioSession): void {
  const existing = getAudioSession(session.id);
  setJSON(StorageKeys.audioSession(session.id), AudioSession, session);
  if (existing == null) {
    registerAudioSession(session.id, session.startedAt);
  }
}

export function deleteAudioSession(id: string): void {
  const session = getAudioSession(id);
  if (session == null) return;
  deleteFile(session.filePath);
  deleteKey(StorageKeys.audioSession(id));
  unregisterAudioSession(id, session.startedAt);
}

export function getAudioSessionsByIds(ids: readonly string[]): AudioSession[] {
  const out: AudioSession[] = [];
  for (const id of ids) {
    const session = getAudioSession(id);
    if (session != null) out.push(session);
  }
  return out;
}
