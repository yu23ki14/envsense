import type { AudioChunk, Day, Highlight, Photo } from '../schemas';
import { Day as DaySchema } from '../schemas';
import { StorageKeys } from '../storage/keys';
import { getJSON, setJSON } from '../storage/mmkv';
import { getAudioChunksByIds } from './audioChunkRepo';
import {
  listAudioIdsForDay,
  listHighlightIdsForDay,
  listPhotoIdsForDay,
  listTimelineIdsForDay,
} from './dayIndex';
import { getHighlightsByIds } from './highlightRepo';
import { getPhotosByIds } from './photoRepo';
import { getTimelineEventsByIds } from './timelineEventRepo';

const SESSION_GAP_MS = 15 * 60 * 1000;
const COVER_MAX = 8;
const DEBOUNCE_MS = 500;

const dirtyDates = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function markDayDirty(date: string): void {
  dirtyDates.add(date);
  scheduleFlush();
}

function scheduleFlush(): void {
  if (flushTimer != null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const dates = Array.from(dirtyDates);
    dirtyDates.clear();
    for (const date of dates) {
      try {
        rebuildDay(date);
      } catch {
        // Surface via logging once we add it; do not crash the writer.
      }
    }
  }, DEBOUNCE_MS);
}

export function getDay(date: string): Day | null {
  return getJSON(StorageKeys.day(date), DaySchema);
}

export function rebuildDay(date: string): Day {
  const photoIds = listPhotoIdsForDay(date);
  const audioChunkIds = listAudioIdsForDay(date);
  const highlightIds = listHighlightIdsForDay(date);
  const timelineEventIds = listTimelineIdsForDay(date);

  const photos = getPhotosByIds(photoIds).sort((a, b) => a.capturedAt - b.capturedAt);
  const audios = getAudioChunksByIds(audioChunkIds).sort((a, b) => a.startedAt - b.startedAt);
  const highlights = getHighlightsByIds(highlightIds).sort((a, b) => a.sourceAt - b.sourceAt);
  const timeline = getTimelineEventsByIds(timelineEventIds).sort((a, b) => a.bucketAt - b.bucketAt);

  const day: Day = {
    date,
    photoIds: photos.map((p) => p.id),
    audioChunkIds: audios.map((a) => a.id),
    highlightIds: highlights.map((h) => h.id),
    timelineEventIds: timeline.map((t) => t.id),
    audioTotalMs: sumAudioDuration(audios),
    tagFrequencies: aggregateTags(highlights),
    coverPhotoIds: pickCoverPhotos(photos),
    sessionCount: countSessions(photos, audios),
    lastBuiltAt: Date.now(),
  };

  setJSON(StorageKeys.day(date), DaySchema, day);
  return day;
}

function sumAudioDuration(audios: AudioChunk[]): number {
  let total = 0;
  for (const a of audios) {
    const span = a.endedAt - a.startedAt;
    if (span > 0) total += span;
  }
  return total;
}

function aggregateTags(highlights: Highlight[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const h of highlights) {
    for (const tag of h.tags) {
      out[tag] = (out[tag] ?? 0) + 1;
    }
  }
  return out;
}

function pickCoverPhotos(photos: Photo[]): string[] {
  const eligible = photos.filter((p) => p.isBlurry !== true);
  const source = eligible.length > 0 ? eligible : photos;
  if (source.length <= COVER_MAX) return source.map((p) => p.id);
  const step = (source.length - 1) / (COVER_MAX - 1);
  const picks: string[] = [];
  for (let i = 0; i < COVER_MAX; i += 1) {
    const candidate = source[Math.round(i * step)];
    if (candidate != null) picks.push(candidate.id);
  }
  return picks;
}

function countSessions(photos: Photo[], audios: AudioChunk[]): number {
  const times: number[] = [];
  for (const p of photos) times.push(p.capturedAt);
  for (const a of audios) times.push(a.startedAt);
  if (times.length === 0) return 0;
  times.sort((a, b) => a - b);
  let count = 1;
  for (let i = 1; i < times.length; i += 1) {
    const current = times[i];
    const previous = times[i - 1];
    if (current == null || previous == null) continue;
    if (current - previous > SESSION_GAP_MS) count += 1;
  }
  return count;
}
