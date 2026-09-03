import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/index.js';
import type pg from 'pg';
import type { Redis } from 'ioredis';

describe('System Health Checks & Security Guards (FIX 1, FIX 6, FIX 10)', () => {
  it('1. should return 200 and connected status when DB and Redis are reachable', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('healthy');
    expect(body.database).toBe('connected');
    expect(body.redis).toBe('connected');
    expect(body.circuitBreaker).toBeDefined();
    await app.close();
  });

  it('2. should return 503 and report unhealthy when DB query fails', async () => {
    // Create a mock pool that rejects queries
    const mockFailingPool = {
      query: async () => {
        throw new Error('Connection terminated unexpectedly');
      },
    } as unknown as pg.Pool;

    const app = await buildApp({ pool: mockFailingPool });
    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.status).toBe('unhealthy');
    expect(body.database).toBe('disconnected');
    await app.close();
  });

  it('3. should return 503 and report degraded when Redis ping fails', async () => {
    // Create a mock redis that fails ping
    const mockFailingRedis = {
      ping: async () => {
        throw new Error('Redis connection refused');
      },
      status: 'ready',
    } as unknown as Redis;

    const app = await buildApp({ redis: mockFailingRedis });
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.status).toBe('degraded');
    expect(body.redis).toBe('disconnected');
    await app.close();
  });

  it('4. should return 404 for dev hooks when NODE_ENV is production (FIX 6)', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      const app = await buildApp();
      const response = await app.inject({
        method: 'POST',
        url: '/api/dev/simulate-mandate-revocation',
        payload: { instrumentId: 'inst_card_001' },
      });

      expect(response.statusCode).toBe(404);
      await app.close();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('5. should allow dev hooks when NODE_ENV is development or test', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    try {
      const app = await buildApp();
      const response = await app.inject({
        method: 'POST',
        url: '/api/dev/simulate-mandate-revocation',
        payload: { instrumentId: 'inst_card_001' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      await app.close();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });
});
