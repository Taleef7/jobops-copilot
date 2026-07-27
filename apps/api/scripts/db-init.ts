import 'dotenv/config';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { runMigrations } from '../src/lib/migrations';

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

    // Same runner the API uses at boot (src/lib/migrations), so a manual
    // bootstrap and a deploy can never disagree about what "applied" means.
    const { applied, skipped } = await runMigrations(pool, migrationDir);

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
