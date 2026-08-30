import { describe, it, expect } from 'vitest';
import { runHealthCheck } from '../src/health-check.js';

describe('Scripts Sanity Check', () => {
  it('should run health check successfully', async () => {
    const report = await runHealthCheck();
    expect(report.status).toBe('healthy');
    expect(report.circuitBreaker).toBe('CLOSED');
  });
});
