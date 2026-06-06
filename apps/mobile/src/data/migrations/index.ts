import { StorageKeys } from '../storage/keys';
import { mmkv } from '../storage/mmkv';
import * as m001 from './001-initial';
import * as m002 from './002-audio-sessions';

type Migration = { version: number; up: () => void };

const MIGRATIONS: Migration[] = [
  { version: m001.VERSION, up: m001.up },
  { version: m002.VERSION, up: m002.up },
].sort((a, b) => a.version - b.version);

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

function readCurrentVersion(): number {
  return mmkv.getNumber(StorageKeys.schemaVersion) ?? 0;
}

function writeCurrentVersion(version: number): void {
  mmkv.set(StorageKeys.schemaVersion, version);
}

export function runMigrations(): void {
  const current = readCurrentVersion();
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    migration.up();
    writeCurrentVersion(migration.version);
  }
}
