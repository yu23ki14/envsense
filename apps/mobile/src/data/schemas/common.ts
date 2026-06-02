import { z } from 'zod';

export const Id = z.string().min(1);
export type Id = z.infer<typeof Id>;

export const TimestampMs = z.number().int().nonnegative();
export type TimestampMs = z.infer<typeof TimestampMs>;

export const DateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export type DateKey = z.infer<typeof DateKey>;

export const Tag = z.string().min(1).max(32);
export type Tag = z.infer<typeof Tag>;

export const ModelRef = z.string().min(1);
export type ModelRef = z.infer<typeof ModelRef>;
