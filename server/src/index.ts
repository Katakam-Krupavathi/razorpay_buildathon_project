import Fastify, { FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import dotenv from 'dotenv';
import type { ControlPlaneHealth } from '@recovery/shared';
import { webhookRoutes, WebhookRouteOptions } from './routes/webhook.js';

export * from './db/connection.js';
export * from './db/migrator.js';
export * from './event-store/hasher.js';
export * from './event-store/event-store.js';
export * from './razorpay/client.js';
export * from './razorpay/webhook-verifier.js';
export * from './razorpay/webhook-processor.js';
export * from './routes/webhook.js';
export * from './risk/scorer.js';
export * from './risk/erv-config.js';
export * from './risk/erv-engine.js';
export * from './risk/health-service.js';
export * from './risk/batch-runner.js';

dotenv.config();

const port = Number(process.env.PORT) || 4000;
const host = process.env.HOST || '0.0.0.0';

export interface AppOptions extends FastifyServerOptions {
  webhookOptions?: WebhookRouteOptions;
}

export async function buildApp(opts?: AppOptions) {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
    },
    ...opts,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: true });

  // Register Webhook Ingestion Routes
  await app.register(webhookRoutes, opts?.webhookOptions || {});

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
