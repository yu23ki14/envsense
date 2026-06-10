import { z } from 'zod';
import { DateKey, Id, ModelRef, TimestampMs } from './common';

/** 1 つの録音セッション（AudioSession）の AI 要約。 */
export const SessionSummary = z.object({
  sessionId: Id,
  startedAt: TimestampMs,
  endedAt: TimestampMs,
  /** 1 行のタイトル（例: 「朝のミーティング」）。 */
  title: z.string(),
  /** 2〜3 文の要約本文。 */
  text: z.string(),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

/**
 * 一日の AI サマリ。日付キーで 1 レコード（`summary:{date}`）。再生成で上書きされる
 * 派生データなので Day ロールアップからは参照せず、date で直接引く。
 */
export const DaySummary = z.object({
  date: DateKey,
  /** 一日のタイトル（日記の見出し）。 */
  title: z.string(),
  /** 1 人称の日記本文（300〜800 字目安）。 */
  body: z.string(),
  /** セッションごとの要約（時系列順）。 */
  sessions: z.array(SessionSummary),
  /** 日記の材料にした代表写真（説明文生成済みのもの）。 */
  photoIds: z.array(Id),
  generatedAt: TimestampMs,
  /** 日記本文の生成に実際に使ったモデル ref。 */
  generatedBy: ModelRef,
  /** 生成時点の入力規模。現在の Day と比べて「古くなった」表示に使う。 */
  sourceChunkCount: z.number().int().nonnegative(),
  sourcePhotoCount: z.number().int().nonnegative(),
});
export type DaySummary = z.infer<typeof DaySummary>;
