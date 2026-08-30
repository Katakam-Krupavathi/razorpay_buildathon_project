import { describe, it, expect } from 'vitest';
import type { RazorpayMandate, RecoveryEvent, ControlPlaneHealth } from '../src/index.js';

describe('Shared Domain Types & Models', () => {
  it('should construct valid domain models conforming to recovery control plane schemas', () => {
    const mandate: RazorpayMandate = {
      id: 'man_test_123',
      customerId: 'cust_456',
      authType: 'upi_autopay',
      status: 'active',
      maxAmount: 150000,
      currency: 'INR',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(mandate.id).toBe('man_test_123');
    expect(mandate.authType).toBe('upi_autopay');
    expect(mandate.status).toBe('active');
  });

  it('should type-check recovery event structures', () => {
    const event: RecoveryEvent<{ invoiceAmount: number }> = {
      id: 'evt_001',
      eventType: 'invoice.payment_failed',
      aggregateId: 'inv_999',
      aggregateType: 'invoice',
      version: 1,
      payload: { invoiceAmount: 499900 },
      metadata: {
        correlationId: 'corr_123',
        timestamp: new Date().toISOString(),
        actor: 'webhook',
      },
    };

    expect(event.eventType).toBe('invoice.payment_failed');
    expect(event.aggregateType).toBe('invoice');
  });

  it('should validate health check model interface', () => {
    const health: ControlPlaneHealth = {
      status: 'healthy',
      uptimeSeconds: 120,
      database: 'connected',
      redis: 'connected',
      circuitBreaker: 'CLOSED',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    };

    expect(health.status).toBe('healthy');
    expect(health.circuitBreaker).toBe('CLOSED');
  });
});
