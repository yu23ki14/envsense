import { format } from 'date-fns';
import { type Directory, File, Paths } from 'expo-file-system';

function root(): Directory {
  return Paths.document;
}

export function photoPath(capturedAtMs: number, id: string): string {
  const sub = format(capturedAtMs, 'yyyy/MM/dd');
  return `photos/${sub}/${id}.jpg`;
}

export function audioPath(startedAtMs: number, id: string): string {
  const sub = format(startedAtMs, 'yyyy/MM/dd');
  return `audio/${sub}/${id}.ogg`;
}

function fileFor(relative: string): File {
  return new File(root(), relative);
}

export function absoluteUri(relative: string): string {
  return fileFor(relative).uri;
}

export function writeBytes(relative: string, bytes: Uint8Array): void {
  const file = fileFor(relative);
  const dir = file.parentDirectory;
  if (!dir.exists) dir.create({ intermediates: true });
  if (!file.exists) file.create({ overwrite: true });
  file.write(bytes);
}

export async function readBytes(relative: string): Promise<Uint8Array | null> {
  const file = fileFor(relative);
  if (!file.exists) return null;
  return file.bytes();
}

export function deleteFile(relative: string): void {
  const file = fileFor(relative);
  if (file.exists) file.delete();
}

export function fileSize(relative: string): number {
  const file = fileFor(relative);
  return file.exists ? file.size : 0;
}
