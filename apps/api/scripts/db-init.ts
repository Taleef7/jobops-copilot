import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required. Set it in apps/api/.env before running the database bootstrap.');
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..', '..', '..');
const migrationDir = join(repoRoot, 'db', 'migrations');

function describeTarget(url: string) {
  const parsed = new URL(url);
  return `${parsed.hostname}${parsed.pathname}`;
}

async function runSql(pool: Pool, label: string, filePath: string) {
  const sql = await readFile(filePath, 'utf8');
  const client = await pool.connect();

  try {
    console.log(`Running ${label} from ${filePath}`);
    await client.query(sql);
    console.log(`Finished ${label}`);
  } finally {
    client.release();
  }
}

async function listMigrationFiles() {
  const entries = await readdir(migrationDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => join(migrationDir, entry.name))
    .sort((left, right) => left.localeCompare(right));
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
    await pool.query('select 1');
    for (const migrationPath of await listMigrationFiles()) {
      await runSql(pool, `schema migration ${migrationPath.split('\\').pop() ?? migrationPath}`, migrationPath);
    }
    // No global seed: sample data is loaded per-account via POST /api/demo/seed.
    console.log('Azure PostgreSQL bootstrap completed successfully.');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('Database bootstrap failed.');
  console.error(error);
  process.exitCode = 1;
});
