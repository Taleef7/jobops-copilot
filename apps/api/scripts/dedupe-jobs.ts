/**
 * One-off cleanup of the duplicate jobs discovery inserted before #346.
 *
 *   npm run dedupe-jobs --workspace @jobops/api                           # dry run, every user
 *   npm run dedupe-jobs --workspace @jobops/api -- --user <id>            # dry run, one user
 *   npm run dedupe-jobs --workspace @jobops/api -- --user <id> --apply    # clean that user
 *
 * Needs DATABASE_URL. Not a migration: it runs by hand, after a dry run.
 */
import 'dotenv/config';
import { dedupeJobs } from '../src/lib/job-dedupe';
import { getPool } from '../src/lib/postgres';

if (!process.env.DATABASE_URL?.trim()) {
  throw new Error('DATABASE_URL is required.');
}

dedupeJobs(process.argv.slice(2))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => getPool()?.end());
