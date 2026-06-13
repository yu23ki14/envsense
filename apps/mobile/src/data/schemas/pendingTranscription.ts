import { z } from 'zod';
import { Id, TimestampMs } from './common';

/**
 * 文字起こし待ちのセグメント。ingest 時にセグメント単体の Ogg ファイルと一緒に
 * 永続化され、文字起こしが成功（または無音判定）した時点で両方削除される。
 * アプリ kill や API 失敗で中断した分はここに残り、再開（手動 / 起動時）で
 * 再実行される。`id` は成功時にそのまま AudioChunk の id になるので、
 * 「チャンク保存後・レコード削除前」に落ちても再実行は上書きで冪等。
 */
export const PendingTranscription = z.object({
  id: Id,
  /** 音声本体が追記されている {@link AudioSession} の id。 */
  sessionId: Id,
  startedAt: TimestampMs,
  endedAt: TimestampMs,
  /** このセグメント単体の Ogg ファイル（成功まで保持される）。 */
  filePath: z.string().min(1),
});
export type PendingTranscription = z.infer<typeof PendingTranscription>;

export const PendingTranscriptionList = z.array(PendingTranscription);
export type PendingTranscriptionList = z.infer<typeof PendingTranscriptionList>;
