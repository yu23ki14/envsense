import { format } from 'date-fns';
import { customAlphabet } from 'nanoid/non-secure';

const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const generate = customAlphabet(alphabet, 12);

export function newId(): string {
  return generate();
}

export function dateKey(ms: number): string {
  return format(ms, 'yyyy-MM-dd');
}
