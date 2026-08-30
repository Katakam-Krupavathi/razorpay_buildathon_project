import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { getPool } from './connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function getDefaultMigrationsDir(): string {
  // Try locating migrations relative to dist or src
  const candidate1 = path.resolve(__dirname, '../../migrations');
  const candidate2 = path.resolve(__dirname, '../migrations');
  const candidate3 = path.resolve(process.cwd(), 'migrations');
  const candidate4 = path.resolve(process.cwd(), 'server/migrations');

  if (fs.existsSync(candidate1)) return candidate1;
  if (fs.existsSync(candidate2)) return candidate2;
  if (fs.existsSync(candidate4)) return candidate4;
  if (fs.existsSync(candidate3)) return candidate3;

  return candidate1;
}

export async function ensureMigrationsTable(client: pg.PoolClient | pg.Pool): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function getAppliedMigrations(client: pg.PoolClient | pg.Pool): Promise<string[]> {
  await ensureMigrationsTable(client);
  const result = await client.query<{ name: string }>(
    'SELECT name FROM _migrations ORDER BY id ASC;',
  );
  return result.rows.map((row) => row.name);
}

export function getMigrationFiles(migrationsDir: string): string[] {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found at: ${migrationsDir}`);
  }

  return fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

export async function runMigrations(options?: {
  migrationsDir?: string;
  pool?: pg.Pool;
}): Promise<string[]> {
  const pool = options?.pool || getPool();
  const dir = options?.migrationsDir || getDefaultMigrationsDir();
  const files = getMigrationFiles(dir);

  const client = await pool.connect();
  const appliedNow: string[] = [];

  try {
    await client.query('BEGIN');
    await ensureMigrationsTable(client);

    const alreadyApplied = await getAppliedMigrations(client);

    for (const file of files) {
      if (!alreadyApplied.includes(file)) {
        const filePath = path.join(dir, file);
        const sql = fs.readFileSync(filePath, 'utf8');

        console.log(`[Migrator] Applying migration: ${file}`);
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1);', [file]);
        appliedNow.push(file);
      }
    }

    await client.query('COMMIT');
    console.log(`[Migrator] Successfully applied ${appliedNow.length} new migration(s).`);
    return appliedNow;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Migrator] Migration failed, transaction rolled back:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function resetDatabase(options?: {
  migrationsDir?: string;
  pool?: pg.Pool;
}): Promise<void> {
  const pool = options?.pool || getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    console.log('[Migrator] Dropping all tables, functions, and types...');
    await client.query(`
      DROP SCHEMA public CASCADE;
      CREATE SCHEMA public;
      GRANT ALL ON SCHEMA public TO public;
    `);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  // Re-run all migrations from scratch
  await runMigrations(options);
}
