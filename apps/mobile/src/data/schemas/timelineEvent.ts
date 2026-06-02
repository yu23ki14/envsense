import { z } from 'zod';
import { Id, ModelRef, TimestampMs } from './common';

export const TimelineEvent = z.object({
  id: Id,
  createdAt: TimestampMs,
  bucketAt: TimestampMs,
  title: z.string().min(1),
  snippet: z.string(),
  photoIds: z.array(Id),
  audioChunkIds: z.array(Id),
  generatedBy: ModelRef,
});
export type TimelineEvent = z.infer<typeof TimelineEvent>;
