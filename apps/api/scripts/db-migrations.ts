import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Pool } from 'pg';

export async function listMigrationFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.sql'))
    .map((e) => join(dir, e.name))
    .sort((a, b) => a.localeCompare(b));
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
  if (Number(rows[0].n) > 0) return;

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

  const { rows } = await pool.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [filename]);
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
