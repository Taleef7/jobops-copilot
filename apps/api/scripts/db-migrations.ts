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
 * If schema_migrations is empty AND the jobs table already exists, the DB
 * was initialised before tracking was added. Pre-seed all known migration
 * filenames so the first tracked run skips them rather than re-running against
 * live data.
 */
export async function bootstrapIfNeeded(pool: Pool, migrationFiles: string[]): Promise<void> {
  const { rows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM schema_migrations');
  if (Number(rows[0].n) > 0) return;

  const { rows: jobRows } = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'jobs' LIMIT 1",
  );
  if (jobRows.length === 0) return; // fresh DB — let migrations run normally

  console.log('Existing DB detected — pre-seeding schema_migrations for all current migrations.');
  for (const filePath of migrationFiles) {
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
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
    await client.query('COMMIT');
    console.log(`Applied migration ${filename}`);
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
