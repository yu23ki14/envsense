import { dateKey } from '../ids';
import { StorageKeys } from '../storage/keys';
import { getJSON, setJSON } from '../storage/mmkv';
import { markDayDirty } from './dayBuilder';
import { DateKeyList, IdList } from './internal';

function readIds(key: string): string[] {
  return getJSON(key, IdList) ?? [];
}

function writeIds(key: string, ids: string[]): void {
  setJSON(key, IdList, ids);
}

function readDates(): string[] {
  return getJSON(StorageKeys.dateIndex, DateKeyList) ?? [];
}

function writeDates(dates: string[]): void {
  setJSON(StorageKeys.dateIndex, DateKeyList, dates);
}

function ensureDateRegistered(date: string): void {
  const dates = readDates();
  if (dates.includes(date)) return;
  dates.push(date);
  dates.sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
  writeDates(dates);
}

function addId(indexKey: string, id: string): void {
  const ids = readIds(indexKey);
  if (ids.includes(id)) return;
  ids.push(id);
  writeIds(indexKey, ids);
}

function removeId(indexKey: string, id: string): void {
  const ids = readIds(indexKey);
  const next = ids.filter((existing) => existing !== id);
  if (next.length !== ids.length) writeIds(indexKey, next);
}

export function listDates(): string[] {
  return readDates();
}

export function listPhotoIdsForDay(date: string): string[] {
  return readIds(StorageKeys.photosByDay(date));
}

export function listAudioIdsForDay(date: string): string[] {
  return readIds(StorageKeys.audiosByDay(date));
}

export function listHighlightIdsForDay(date: string): string[] {
  return readIds(StorageKeys.highlightsByDay(date));
}

export function listTimelineIdsForDay(date: string): string[] {
  return readIds(StorageKeys.timelineByDay(date));
}

export function registerPhoto(id: string, capturedAtMs: number): void {
  const date = dateKey(capturedAtMs);
  ensureDateRegistered(date);
  addId(StorageKeys.photosByDay(date), id);
  markDayDirty(date);
}

export function unregisterPhoto(id: string, capturedAtMs: number): void {
  const date = dateKey(capturedAtMs);
  removeId(StorageKeys.photosByDay(date), id);
  markDayDirty(date);
}

export function registerAudio(id: string, startedAtMs: number): void {
  const date = dateKey(startedAtMs);
  ensureDateRegistered(date);
  addId(StorageKeys.audiosByDay(date), id);
  markDayDirty(date);
}

export function unregisterAudio(id: string, startedAtMs: number): void {
  const date = dateKey(startedAtMs);
  removeId(StorageKeys.audiosByDay(date), id);
  markDayDirty(date);
}

export function registerHighlight(id: string, sourceAtMs: number): void {
  const date = dateKey(sourceAtMs);
  ensureDateRegistered(date);
  addId(StorageKeys.highlightsByDay(date), id);
  markDayDirty(date);
}

export function unregisterHighlight(id: string, sourceAtMs: number): void {
  const date = dateKey(sourceAtMs);
  removeId(StorageKeys.highlightsByDay(date), id);
  markDayDirty(date);
}

export function registerTimelineEvent(id: string, bucketAtMs: number): void {
  const date = dateKey(bucketAtMs);
  ensureDateRegistered(date);
  addId(StorageKeys.timelineByDay(date), id);
  markDayDirty(date);
}

export function unregisterTimelineEvent(id: string, bucketAtMs: number): void {
  const date = dateKey(bucketAtMs);
  removeId(StorageKeys.timelineByDay(date), id);
  markDayDirty(date);
}
