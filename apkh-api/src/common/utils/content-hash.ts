import { createHash } from 'crypto';

/** Hex sha256 of a string — identity of chunk texts and indexing inputs. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
