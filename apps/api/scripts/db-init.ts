import 'dotenv/config';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import {
  applyMigration,
  bootstrapIfNeeded,
  ensureTrackingTable,
  listMigrationFiles,
} from './db-migrations';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is required. Set it in apps/api/.env before running the database bootstrap.',
  );
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..', '..', '..');
const migrationDir = join(repoRoot, 'db', 'migrations');

function describeTarget(url: string) {
  const parsed = new URL(url);
  return `${parsed.hostname}${parsed.pathname}`;
}

async function main() {
  const pool = new Pool({
    connectionString: databaseUrl,
    allowExitOnIdle: true,
    max: 5,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });

  try {
    console.log(`Connecting to ${describeTarget(databaseUrl)}`);
    await pool.query('SELECT 1');

    await ensureTrackingTable(pool);

    const migrationFiles = await listMigrationFiles(migrationDir);
    await bootstrapIfNeeded(pool, migrationFiles);

    let applied = 0;
    let skipped = 0;
    for (const filePath of migrationFiles) {
      const wasApplied = await applyMigration(pool, filePath);
      if (wasApplied) applied++;
      else skipped++;
    }

    console.log(`Bootstrap complete: ${applied} applied, ${skipped} skipped.`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('Database bootstrap failed.');
  console.error(error);
  process.exitCode = 1;
});
