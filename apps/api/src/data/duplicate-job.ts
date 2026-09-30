import type { TrackedJobRef } from '@/types';

/**
 * The user already has this posting, under this or another of its URLs (#346).
 *
 * Carries Postgres' unique-violation code, so discovery counts it as a skip the same way
 * it counts a raced insert on the `(user_id, job_url)` index.
 */
export class DuplicateJobError extends Error {
  readonly code = '23505';

  constructor(readonly existingJob: TrackedJobRef) {
    super('You already added this job.');
    this.name = 'DuplicateJobError';
  }
}
