import { useMemo } from 'react';
import { useMMKVString } from 'react-native-mmkv';
import type { z } from 'zod';
import {
  getAudioChunk,
  getAudioSession,
  getDay,
  getHighlight,
  getPhoto,
  getTimelineEvent,
} from './repos';
import { DateKeyList, IdList } from './repos/internal';
import {
  type AudioChunk,
  type AudioSession,
  Day,
  DEFAULT_SETTINGS,
  type Highlight,
  PairedDevice,
  type Photo,
  Settings,
  type TimelineEvent,
} from './schemas';
import { StorageKeys } from './storage/keys';
import { mmkv } from './storage/mmkv';

function parseRaw<T>(raw: string | undefined, schema: z.ZodType<T>): T | null {
  if (raw == null) return null;
  try {
    const result = schema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function useSettings(): Settings {
  const [raw] = useMMKVString(StorageKeys.settings, mmkv);
  return useMemo(() => parseRaw(raw, Settings) ?? DEFAULT_SETTINGS, [raw]);
}

export function usePairedDevice(): PairedDevice | null {
  const [raw] = useMMKVString(StorageKeys.pairedDevice, mmkv);
  return useMemo(() => parseRaw(raw, PairedDevice), [raw]);
}

export function useDates(): string[] {
  const [raw] = useMMKVString(StorageKeys.dateIndex, mmkv);
  return useMemo(() => parseRaw(raw, DateKeyList) ?? [], [raw]);
}

export function useDaysList(): Day[] {
  const dates = useDates();
  return useMemo(() => {
    const out: Day[] = [];
    for (const date of dates) {
      const day = getDay(date);
      if (day != null) out.push(day);
    }
    return out;
  }, [dates]);
}

export function useDay(date: string | null): Day | null {
  const [raw] = useMMKVString(date != null ? StorageKeys.day(date) : '__noop__', mmkv);
  return useMemo(() => (date == null ? null : parseRaw(raw, Day)), [date, raw]);
}

function useIds(key: string): string[] {
  const [raw] = useMMKVString(key, mmkv);
  return useMemo(() => parseRaw(raw, IdList) ?? [], [raw]);
}

export function usePhotosForDay(date: string | null): Photo[] {
  const ids = useIds(date != null ? StorageKeys.photosByDay(date) : '__noop__');
  return useMemo(() => {
    if (date == null) return [];
    const out: Photo[] = [];
    for (const id of ids) {
      const p = getPhoto(id);
      if (p != null) out.push(p);
    }
    return out.sort((a, b) => a.capturedAt - b.capturedAt);
  }, [date, ids]);
}

export function useHighlightsForDay(date: string | null): Highlight[] {
  const ids = useIds(date != null ? StorageKeys.highlightsByDay(date) : '__noop__');
  return useMemo(() => {
    if (date == null) return [];
    const out: Highlight[] = [];
    for (const id of ids) {
      const h = getHighlight(id);
      if (h != null) out.push(h);
    }
    return out.sort((a, b) => a.sourceAt - b.sourceAt);
  }, [date, ids]);
}

export function useTimelineForDay(date: string | null): TimelineEvent[] {
  const ids = useIds(date != null ? StorageKeys.timelineByDay(date) : '__noop__');
  return useMemo(() => {
    if (date == null) return [];
    const out: TimelineEvent[] = [];
    for (const id of ids) {
      const e = getTimelineEvent(id);
      if (e != null) out.push(e);
    }
    return out.sort((a, b) => a.bucketAt - b.bucketAt);
  }, [date, ids]);
}

export function useAudioSessionsForDay(date: string | null): AudioSession[] {
  const ids = useIds(date != null ? StorageKeys.audioSessionsByDay(date) : '__noop__');
  return useMemo(() => {
    if (date == null) return [];
    const out: AudioSession[] = [];
    for (const id of ids) {
      const s = getAudioSession(id);
      if (s != null) out.push(s);
    }
    return out.sort((a, b) => a.startedAt - b.startedAt);
  }, [date, ids]);
}

export function useAudioChunksForDay(date: string | null): AudioChunk[] {
  const ids = useIds(date != null ? StorageKeys.audiosByDay(date) : '__noop__');
  return useMemo(() => {
    if (date == null) return [];
    const out: AudioChunk[] = [];
    for (const id of ids) {
      const c = getAudioChunk(id);
      if (c != null) out.push(c);
    }
    return out.sort((a, b) => a.startedAt - b.startedAt);
  }, [date, ids]);
}

export function useAudioTotalMsForDay(date: string | null): number {
  const sessions = useAudioSessionsForDay(date);
  return useMemo(() => {
    let total = 0;
    for (const s of sessions) {
      if (s.durationMs > 0) total += s.durationMs;
    }
    return total;
  }, [sessions]);
}
