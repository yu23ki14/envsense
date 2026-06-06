import { z } from 'zod';
import { Id, ModelRef, TimestampMs } from './common';

export const Transcript = z.object({
  text: z.string(),
  language: z.string().optional(),
  model: ModelRef,
});
export type Transcript = z.infer<typeof Transcript>;

/**
 * A ~10 s transcription segment. The audio bytes live in the parent
 * {@link AudioSession}'s concatenated file (a chunk has no standalone file);
 * a chunk just carries timing and the transcript text.
 */
export const AudioChunk = z.object({
  id: Id,
  /** The {@link AudioSession} this segment's audio was appended to. */
  sessionId: Id,
  startedAt: TimestampMs,
  endedAt: TimestampMs,
  transcript: Transcript.nullable(),
  transcribedAt: TimestampMs.nullable(),
});
export type AudioChunk = z.infer<typeof AudioChunk>;
