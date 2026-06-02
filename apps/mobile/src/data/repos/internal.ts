import { z } from 'zod';
import { Id } from '../schemas';

export const IdList = z.array(Id);
export type IdList = z.infer<typeof IdList>;

export const DateKeyList = z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));
export type DateKeyList = z.infer<typeof DateKeyList>;
