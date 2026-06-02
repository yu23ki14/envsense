import { z } from 'zod';
import { Id, ModelRef, TimestampMs } from './common';

export const Transcript = z.object({
  text: z.string(),
  language: z.string().optional(),
  model: ModelRef,
});
export type Transcript = z.infer<typeof Transcript>;

export const AudioChunk = z.object({
  id: Id,
  startedAt: TimestampMs,
  endedAt: TimestampMs,
  filePath: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  transcript: Transcript.nullable(),
  transcribedAt: TimestampMs.nullable(),
});
export type AudioChunk = z.infer<typeof AudioChunk>;
