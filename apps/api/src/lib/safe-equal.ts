/**
 * Constant-time secret comparison (QA·F).
 *
 * A plain `===`/`!==` on a secret short-circuits on the first differing byte, so
 * response time leaks how much of a guessed key is correct. Hashing both sides to
 * a fixed 32-byte digest before `crypto.timingSafeEqual` gives a constant-time
 * compare that also sidesteps the length-mismatch throw (and avoids leaking the
 * secret's length). Missing/empty inputs never match.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

export function safeEqual(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  const digestA = createHash('sha256').update(a).digest();
  const digestB = createHash('sha256').update(b).digest();
  return timingSafeEqual(digestA, digestB);
}
