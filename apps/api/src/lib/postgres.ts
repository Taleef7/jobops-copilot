import { Pool } from 'pg';

let pool: Pool | null = null;

export function hasPostgresConnection() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getPool() {
  if (!hasPostgresConnection()) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      allowExitOnIdle: true,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    // Register the error listener once, on creation — not on every getPool() call,
    // which would leak a listener (and closure) per query and warn past 10.
    pool.on('error', (error: Error) => {
      console.error('Unexpected Postgres pool error:', error);
    });
  }

  return pool;
}

export async function closePool() {
  if (!pool) {
    return;
  }

  const activePool = pool;
  pool = null;
  await activePool.end();
}

export async function pingDatabase(): Promise<boolean> {
  const activePool = getPool();
  if (!activePool) {
    return false;
  }

  try {
    await activePool.query('SELECT 1');
    return true;
  } catch (error) {
    console.error('Database readiness ping failed:', error);
    return false;
  }
}
