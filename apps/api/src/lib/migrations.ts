import { existsSync, readdirSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { Pool, PoolClient } from 'pg';

export async function listMigrationFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.sql'))
    .map((e) => join(dir, e.name))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Locate `db/migrations` by walking up from `startDir`, so the same code works
 * from the repo (`apps/api/src/lib` -> `<repo>/db/migrations`) and from the
 * deploy package (`.deploy/dist/lib` -> `.deploy/db/migrations`), which has a
 * different depth. A candidate only counts if it actually holds .sql files —
 * an empty directory of the right name must not shadow the real one.
 */
export function findMigrationDir(startDir: string): string | null {
  let dir = startDir;

  for (let hop = 0; hop < 8; hop += 1) {
    const candidate = join(dir, 'db', 'migrations');
    if (
      existsSync(candidate) &&
      readdirSync(candidate, { withFileTypes: true }).some(
        (e) => e.isFile() && e.name.endsWith('.sql'),
      )
    ) {
      return candidate;
    }

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

export async function ensureTrackingTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text        PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

/**
 * If schema_migrations is empty AND the DB looks fully initialised, pre-seed
 * migration filenames up to and including the sentinel so the first tracked
 * run skips them rather than re-running against live data. Migrations after
 * the sentinel are left un-seeded so applyMigration handles them — they are
 * idempotent (IF EXISTS / IF NOT EXISTS) and safe to re-run.
 *
 * Two sentinel tables span the known migration history: `jobs` (001) and
 * `agent_outputs` (008, the last table-creating migration). If only `jobs`
 * exists, a prior run failed partway — we skip pre-seeding entirely so
 * pending migrations can be applied. Pre-seeding is bounded to files whose
 * basename is ≤ BOOTSTRAP_SENTINEL_FILE so that later idempotent migrations
 * (e.g. 009_drop_display_name.sql) are never permanently marked as applied
 * without actually running.
 */

// The filename of the last migration whose effects are verified by the
// sentinel table check. Only files up to and including this name are
// pre-seeded; everything after runs through applyMigration normally.
const BOOTSTRAP_SENTINEL_FILE = '008_agent_outputs.sql';

export async function bootstrapIfNeeded(pool: Pool, migrationFiles: string[]): Promise<void> {
  const { rows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM schema_migrations');
  if (Number(rows[0]?.n ?? 0) > 0) return;

  const { rows: tableRows } = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name IN ('jobs', 'agent_outputs')`,
  );
  const existing = new Set(tableRows.map((r) => r.table_name));

  if (!existing.has('jobs')) return; // fresh DB — let migrations run normally

  if (!existing.has('agent_outputs')) {
    // jobs exists but a later sentinel is absent — partial migration state.
    // Do not pre-seed; let applyMigration run and skip/apply as appropriate.
    console.warn(
      'Existing DB detected but agent_outputs table is absent — ' +
        'skipping bootstrap pre-seed so pending migrations can be applied.',
    );
    return;
  }

  const toSeed = migrationFiles.filter((f) => basename(f) <= BOOTSTRAP_SENTINEL_FILE);
  console.log(
    `Existing DB detected — pre-seeding ${toSeed.length} verified migration(s) up to ${BOOTSTRAP_SENTINEL_FILE}.`,
  );
  for (const filePath of toSeed) {
    await pool.query(
      'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
      [basename(filePath)],
    );
  }
}

/**
 * Apply a single SQL file if it has not already been recorded.
 * The SQL and the tracking INSERT share one transaction: a crash between them
 * is impossible. Returns true if the migration was applied, false if skipped.
 */
export async function applyMigration(pool: Pool, filePath: string): Promise<boolean> {
  const filename = basename(filePath);

  const { rows } = await pool.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [
    filename,
  ]);
  if (rows.length > 0) {
    console.log(`Skipping already-applied migration ${filename}`);
    return false;
  }

  const sql = await readFile(filePath, 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    const insertResult = await client.query(
      'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
      [filename],
    );
    if ((insertResult.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      console.log(`Skipping already-applied migration ${filename} (concurrent run detected)`);
      return false;
    }
    await client.query('COMMIT');
    console.log(`Applied migration ${filename}`);
    return true;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('ROLLBACK failed (connection may be broken):', rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Migration filenames that exist on disk but are absent from schema_migrations.
 *
 * This is the drift signal. Production sat nine migrations behind for weeks
 * because nothing compared these two sets — `fetchAgentOutputs` just returned
 * `[]` against a table that did not exist. Surfaced on /health/ready so the
 * gap fails a probe instead of hiding behind an empty result.
 */
export async function pendingMigrations(pool: Pool, migrationFiles: string[]): Promise<string[]> {
  const { rows } = await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.filename));
  return migrationFiles.map((f) => basename(f)).filter((name) => !applied.has(name));
}

/**
 * Advisory-lock key serialising migration runs across instances. Arbitrary but
 * fixed: any two runners must pick the same number to exclude each other.
 */
const MIGRATION_LOCK_KEY = 4159821;

/** How long a runner waits for another instance's migration before giving up. */
const LOCK_TIMEOUT = '60s';

/**
 * Hold the migration advisory lock for the duration of `run`.
 *
 * The lock is session-scoped, so it needs its own client — `applyMigration`
 * checks out separate clients for the migrations themselves. `lock_timeout`
 * bounds the wait: a wedged peer surfaces as a boot failure rather than an
 * App Service that hangs forever with no listener.
 */
async function withMigrationLock<T>(pool: Pool, run: () => Promise<T>): Promise<T> {
  const client: PoolClient = await pool.connect();
  let locked = false;
  try {
    await client.query(`SET lock_timeout = '${LOCK_TIMEOUT}'`);
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    locked = true;
    return await run();
  } finally {
    if (locked) {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
      } catch (error) {
        // Releasing the client drops the session and the lock with it, so a
        // failed unlock is not a leak — just note it and move on.
        console.error('Failed to release the migration advisory lock:', error);
      }
    }
    client.release();
  }
}

export type MigrationRunResult = { applied: number; skipped: number };

/**
 * Bring the database up to the migrations shipped alongside this build.
 * Serialised across instances by an advisory lock; safe to call concurrently.
 */
export async function runMigrations(pool: Pool, migrationDir: string): Promise<MigrationRunResult> {
  const migrationFiles = await listMigrationFiles(migrationDir);

  return withMigrationLock(pool, async () => {
    await ensureTrackingTable(pool);
    await bootstrapIfNeeded(pool, migrationFiles);

    let applied = 0;
    let skipped = 0;
    for (const filePath of migrationFiles) {
      if (await applyMigration(pool, filePath)) applied += 1;
      else skipped += 1;
    }

    return { applied, skipped };
  });
}
