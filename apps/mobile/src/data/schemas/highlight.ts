import { z } from 'zod';
import { Id, ModelRef, Tag, TimestampMs } from './common';

export const Highlight = z.object({
  id: Id,
  createdAt: TimestampMs,
  sourceAt: TimestampMs,
  quote: z.string().min(1),
  tags: z.array(Tag),
  sourceAudioChunkIds: z.array(Id),
  generatedBy: ModelRef,
});
export type Highlight = z.infer<typeof Highlight>;
