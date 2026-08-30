import dotenv from 'dotenv';
import { resetDatabase, closePool } from '@recovery/server';

dotenv.config();

async function main() {
  console.log('[CLI] Resetting database and applying all migrations...');
  try {
    await resetDatabase();
    console.log('[CLI] Database reset and migrations successfully completed.');
  } catch (error) {
    console.error('[CLI] Database reset failed:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  main();
}
