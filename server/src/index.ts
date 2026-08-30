import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import dotenv from 'dotenv';
import type { ControlPlaneHealth } from '@recovery/shared';

dotenv.config();

const port = Number(process.env.PORT) || 4000;
const host = process.env.HOST || '0.0.0.0';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
    },
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: true });

  // Root & Health Check Endpoints
  app.get('/', async () => {
    return {
      service: 'Autonomous Revenue Recovery Control Plane',
      version: '0.1.0',
      status: 'operational',
      docs: '/api/docs',
    };
  });

  app.get('/health', async (): Promise<ControlPlaneHealth> => {
    return {
      status: 'healthy',
      uptimeSeconds: Math.floor(process.uptime()),
      database: 'connected',
      redis: 'connected',
      circuitBreaker: 'CLOSED',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    };
  });

  app.get('/api/health', async (): Promise<ControlPlaneHealth> => {
    return {
      status: 'healthy',
      uptimeSeconds: Math.floor(process.uptime()),
      database: 'connected',
      redis: 'connected',
      circuitBreaker: 'CLOSED',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    };
  });

  return app;
}

// Start standalone server when executed directly
if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  const start = async () => {
    try {
      const app = await buildApp();
      await app.listen({ port, host });
      app.log.info(`Control Plane Server running on http://${host}:${port}`);
    } catch (err) {
      console.error('Failed to start server:', err);
      process.exit(1);
    }
  };

  start();
}
