import { z } from 'zod';
import { TimestampMs } from './common';

export const PairedDevice = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  firmwareVersion: z.string().min(1),
  pairedAt: TimestampMs,
  lastConnectedAt: TimestampMs.nullable(),
  lastBatteryPercent: z.number().int().min(0).max(100).nullable(),
  lastRssi: z.number().int().nullable(),
});
export type PairedDevice = z.infer<typeof PairedDevice>;
