/**
 * 文字起こし待ち（PendingTranscription）の実行と再開。
 *
 * ingest（mediaIngest）はセグメントごとに pending レコード + 単体 Ogg を永続化
 * してから transcribePending() をキューに積む。成功（無音含む）でレコードと
 * ファイルが消えるので、アプリ kill・API 失敗・オフラインで中断した分だけが
 * 残る。残った分は resumePendingTranscriptions()（起動時の自動実行と
 * TranscriptScreen の再開ボタン）が時刻順に再実行する。
 */
import { useSyncExternalStore } from 'react';
import type { PendingTranscription } from '../data';
import {
  deleteFile,
  fileExists,
  listPendingTranscriptions,
  removePendingTranscription,
  saveAudioChunk,
} from '../data';
import { beginBackgroundWork } from './backgroundWork';
import { transcribe } from './llm';

/** ライブの ingest キューと再開処理が同じレコードを二重実行しないための排他。 */
const inFlight = new Set<string>();

/**
 * 1 件を文字起こしして AudioChunk 化する。発話があればチャンクを保存し、
 * 無音なら何も保存せず、いずれも pending レコードとファイルを片付ける。
 * 失敗時はそのまま残す（次の再開で再挑戦する）。
 */
export async function transcribePending(pending: PendingTranscription): Promise<void> {
  if (inFlight.has(pending.id)) return;
  inFlight.add(pending.id);
  try {
    const { text, model } = await transcribe(pending.filePath);
    if (text.length > 0) {
      saveAudioChunk({
        id: pending.id,
        sessionId: pending.sessionId,
        startedAt: pending.startedAt,
        endedAt: pending.endedAt,
        transcript: { text, model },
        transcribedAt: Date.now(),
      });
    }
    removePendingTranscription(pending.id);
    deleteFile(pending.filePath);
  } catch (err) {
    console.warn(`Transcription failed for ${pending.id} (kept for resume)`, err);
  } finally {
    inFlight.delete(pending.id);
  }
}

let resuming = false;
const resumeListeners = new Set<() => void>();

function emitResume(): void {
  for (const listener of resumeListeners) listener();
}

function subscribeResume(listener: () => void): () => void {
  resumeListeners.add(listener);
  return () => resumeListeners.delete(listener);
}

function isResuming(): boolean {
  return resuming;
}

/** 再開処理が走っている間 true（TranscriptScreen のボタン表示用）。 */
export function useTranscriptionResumeRunning(): boolean {
  return useSyncExternalStore(subscribeResume, isResuming, isResuming);
}

/**
 * 残っている文字起こし待ちを時刻順に再実行する。多重起動は無視。
 * 1 件の失敗で止めず次へ進む（残った分は次回の再開対象のまま）。
 */
export async function resumePendingTranscriptions(): Promise<void> {
  if (resuming) return;
  resuming = true;
  emitResume();
  const endWork = beginBackgroundWork();
  try {
    const pendings = [...listPendingTranscriptions()].sort((a, b) => a.startedAt - b.startedAt);
    for (const pending of pendings) {
      if (inFlight.has(pending.id)) continue;
      if (!fileExists(pending.filePath)) {
        // 音声ファイルだけ消えている（再現不能）レコードは諦めて片付ける。
        removePendingTranscription(pending.id);
        continue;
      }
      await transcribePending(pending);
    }
  } finally {
    endWork();
    resuming = false;
    emitResume();
  }
}
