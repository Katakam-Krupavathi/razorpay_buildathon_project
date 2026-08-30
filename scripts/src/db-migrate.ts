import dotenv from 'dotenv';
import { runMigrations, closePool } from '@recovery/server';

dotenv.config();

async function main() {
  console.log('[CLI] Starting database migration runner...');
  try {
    const applied = await runMigrations();
    console.log(`[CLI] Migration process complete. Applied: ${applied.length} file(s).`);
  } catch (error) {
    console.error('[CLI] Migration failed:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  main();
}
