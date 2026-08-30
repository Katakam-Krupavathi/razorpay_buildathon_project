import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/index.js';

describe('Server Health and Root Endpoints', () => {
  it('GET / should return service info and status', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.service).toBe('Autonomous Revenue Recovery Control Plane');
    expect(body.status).toBe('operational');
  });

  it('GET /health should return valid ControlPlaneHealth schema', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.status).toBe('healthy');
    expect(body.circuitBreaker).toBe('CLOSED');
    expect(body.version).toBe('0.1.0');
  });

  it('GET /api/health should respond with status 200', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.database).toBe('connected');
    expect(body.redis).toBe('connected');
  });
});
