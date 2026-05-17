import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required. Set it in apps/api/.env before running the database bootstrap.');
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..', '..', '..');
const migrationPath = join(repoRoot, 'db', 'migrations', '001_core_tables.sql');
const seedPath = join(repoRoot, 'db', 'seed', 'sample_jobs.sql');

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
    await runSql(pool, 'schema migration', migrationPath);
    await runSql(pool, 'seed data', seedPath);
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
