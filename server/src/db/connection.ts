import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

let globalPool: pg.Pool | null = null;

export function getDatabaseUrl(): string {
  return (
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5432/recovery_control_plane?schema=public'
  );
}

export function createPool(connectionString?: string): pg.Pool {
  const connStr = connectionString || getDatabaseUrl();
  return new Pool({
    connectionString: connStr,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
}

export function getPool(): pg.Pool {
  if (!globalPool) {
    globalPool = createPool();
  }
  return globalPool;
}

export async function closePool(pool?: pg.Pool): Promise<void> {
  const targetPool = pool || globalPool;
  if (targetPool) {
    await targetPool.end();
    if (targetPool === globalPool) {
      globalPool = null;
    }
  }
}

export async function query<R extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
  pool?: pg.Pool,
): Promise<pg.QueryResult<R>> {
  const p = pool || getPool();
  return p.query<R>(text, params);
}

export async function withTransaction<T>(
  callback: (client: pg.PoolClient) => Promise<T>,
  pool?: pg.Pool,
): Promise<T> {
  const p = pool || getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
