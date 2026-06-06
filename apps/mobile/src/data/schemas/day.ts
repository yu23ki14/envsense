import { z } from 'zod';
import { DateKey, Id, Tag, TimestampMs } from './common';

export const Day = z.object({
  date: DateKey,
  photoIds: z.array(Id),
  audioChunkIds: z.array(Id),
  audioSessionIds: z.array(Id),
  highlightIds: z.array(Id),
  timelineEventIds: z.array(Id),
  audioTotalMs: z.number().int().nonnegative(),
  tagFrequencies: z.record(Tag, z.number().int().positive()),
  coverPhotoIds: z.array(Id).max(8),
  sessionCount: z.number().int().nonnegative(),
  lastBuiltAt: TimestampMs,
});
export type Day = z.infer<typeof Day>;
