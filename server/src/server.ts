import dotenv from 'dotenv';
import { buildApp } from './index.js';
import { closePool } from './db/connection.js';

dotenv.config();

const port = Number(process.env.PORT) || 4000;
const host = process.env.HOST || '0.0.0.0';

async function startServer() {
  try {
    const app = await buildApp();
    await app.listen({ port, host });
    app.log.info(`Control Plane Server running on http://${host}:${port}`);

    const shutdown = async (signal: string) => {
      app.log.info(`Received ${signal}. Shutting down gracefully...`);
      try {
        await app.close();
        await closePool();
        process.exit(0);
      } catch (err) {
        console.error('Error during shutdown:', err);
        process.exit(1);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
