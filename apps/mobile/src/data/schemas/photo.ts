import { z } from 'zod';
import { Id, ModelRef, TimestampMs } from './common';

export const PhotoRotation = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
export type PhotoRotation = z.infer<typeof PhotoRotation>;

export const Photo = z.object({
  id: Id,
  capturedAt: TimestampMs,
  filePath: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().nonnegative(),
  rotationDeg: PhotoRotation,
  isBlurry: z.boolean().nullable(),
  description: z.string().nullable(),
  descriptionAt: TimestampMs.nullable(),
  descriptionModel: ModelRef.nullable(),
});
export type Photo = z.infer<typeof Photo>;
