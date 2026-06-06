import { z } from 'zod';
import { DateKey, Id, TimestampMs } from './common';

/**
 * A continuous run of captured audio, stored as a single Ogg/Opus file that the
 * capture pipeline appends to incrementally. A new session starts on a >15 min
 * gap or a date change; `ogg` carries the state needed to keep appending valid
 * Ogg pages across BLE reconnects and app restarts.
 */
export const AudioSession = z.object({
  id: Id,
  date: DateKey,
  startedAt: TimestampMs,
  endedAt: TimestampMs,
  /** Relative path of the concatenated Ogg/Opus file. */
  filePath: z.string().min(1),
  durationMs: z.number().int().nonnegative(),
  chunkCount: z.number().int().nonnegative(),
  /** True once the session is closed (no more appends expected). */
  finalized: z.boolean(),
  /** Ogg stream state, advanced on every append. */
  ogg: z.object({
    serial: z.number().int().nonnegative(),
    nextSequence: z.number().int().nonnegative(),
    granuleFrames: z.number().int().nonnegative(),
  }),
});
export type AudioSession = z.infer<typeof AudioSession>;
