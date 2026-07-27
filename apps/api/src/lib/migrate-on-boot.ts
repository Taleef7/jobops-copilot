/**
 * Apply pending database migrations when the API starts, and expose the
 * result so a readiness probe can report drift.
 *
 * Why boot and not CI: production's migration runner was wedged, so no new
 * migration could reach it at all. `schema_migrations` recorded nothing from
 * 003 onward and every `db:init` died re-attempting 002_weekly_report_storage.
 * It surfaced only because migration 011 would not apply — a schema that is
 * behind is invisible from outside, since reads against what is not there come
 * back empty rather than failing.
 *
 * And nothing ran `db:init` against production because nothing could: a GitHub
 * runner reaches the database only by opening a firewall rule for an ephemeral
 * IP on every deploy and closing it after (one such delete has already been
 * observed to silently no-op, which would leave the database open), and it
 * would need a production DATABASE_URL stored in GitHub Secrets.
 *
 * The App Service is already inside the firewall and already holds the
 * credential, and the migrations ship in the same package as the code that
 * expects them — so applying them here makes schema drift structurally
 * impossible rather than merely monitored.
 *
 * Escape hatch: set the app setting RUN_MIGRATIONS_ON_BOOT=false and restart
 * to bring the API back up without migrating (for example if a bad migration
 * is wedging startup). Readiness then reports the pending migrations instead
 * of pretending the schema is current.
 */
import { findMigrationDir, listMigrationFiles, pendingMigrations, runMigrations } from '@/lib/migrations';
import { getPool, hasPostgresConnection } from '@/lib/postgres';

/**
 * `db/migrations` relative to this module. Resolved by walking up, because the
 * depth differs between the repo (apps/api/src/lib) and the deploy package
 * (.deploy/dist/lib). CommonJS build — `__dirname` is available.
 */
function migrationDir(): string | null {
  return findMigrationDir(__dirname);
}

export function migrationsOnBootEnabled(): boolean {
  return process.env.RUN_MIGRATIONS_ON_BOOT?.trim().toLowerCase() !== 'false';
}

/**
 * Run pending migrations. Throws on failure so the caller can refuse to boot —
 * serving requests against a schema the code does not match is what produced
 * the silent empty results in the first place.
 */
export async function migrateOnBoot(): Promise<void> {
  if (!hasPostgresConnection()) {
    console.log('No DATABASE_URL — skipping migrations (file-backed mode).');
    return;
  }

  if (!migrationsOnBootEnabled()) {
    console.warn(
      'RUN_MIGRATIONS_ON_BOOT=false — starting without applying migrations. ' +
        'Readiness will report any pending migration until this is unset.',
    );
    return;
  }

  const dir = migrationDir();
  if (!dir) {
    throw new Error(
      'Could not locate db/migrations next to the running build. ' +
        'The deploy package must ship db/migrations alongside dist/.',
    );
  }

  const pool = getPool();
  if (!pool) throw new Error('DATABASE_URL is set but no connection pool was created.');

  const { applied, skipped } = await runMigrations(pool, dir);
  console.log(`Migrations up to date: ${applied} applied, ${skipped} already present.`);
}

export type MigrationStatus =
  | { state: 'skipped' }
  | { state: 'ok' }
  | { state: 'pending'; pending: string[] }
  | { state: 'unknown'; reason: string };

/**
 * Compare the migrations shipped in this build against schema_migrations.
 *
 * Cheap enough for a probe: the on-disk list cannot change while the process
 * runs, so it is read once, leaving a single query per call.
 */
let cachedFiles: Promise<string[]> | null = null;

export async function getMigrationStatus(): Promise<MigrationStatus> {
  if (!hasPostgresConnection()) return { state: 'skipped' };

  const dir = migrationDir();
  if (!dir) return { state: 'unknown', reason: 'db/migrations not found next to the build' };

  const pool = getPool();
  if (!pool) return { state: 'unknown', reason: 'no connection pool' };

  try {
    cachedFiles ??= listMigrationFiles(dir);
    const pending = await pendingMigrations(pool, await cachedFiles);
    return pending.length === 0 ? { state: 'ok' } : { state: 'pending', pending };
  } catch (error) {
    cachedFiles = null;
    console.error('Could not read migration state:', error);
    return { state: 'unknown', reason: 'schema_migrations unreadable' };
  }
}

/** Test seam: drop the memoised on-disk migration list. */
export function resetMigrationStatusCache(): void {
  cachedFiles = null;
}
