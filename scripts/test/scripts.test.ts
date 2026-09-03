import { describe, it, expect } from 'vitest';
import { newDb, DataType } from 'pg-mem';
import pg from 'pg';
import { EventStore } from '@recovery/server';
import { runHealthCheck } from '../src/health-check.js';
import { seedSyntheticEvents } from '../src/seed-events.js';

describe('Scripts Sanity and Synthetic Seeding Test', () => {
  it('should run health check successfully', async () => {
    const report = await runHealthCheck();
    expect(report.status).toBe('healthy');
    expect(report.circuitBreaker).toBe('CLOSED');
  });

  it('should seed 25 synthetic events and verify chain integrity', async () => {
    const db = newDb();
    db.public.registerFunction({
      name: 'now',
      returns: DataType.timestamp,
      implementation: () => new Date().toISOString(),
    });

    db.public.none(`
      CREATE TYPE instrument_rail AS ENUM ('card', 'upi_autopay', 'enach');
      CREATE TYPE mandate_status AS ENUM ('active', 'paused', 'revoked', 'expired');
      CREATE TYPE subscription_status AS ENUM ('created', 'authenticated', 'activated', 'active', 'pending', 'halted', 'paused', 'resumed', 'completed', 'cancelled', 'expired');
      CREATE TYPE event_actor AS ENUM ('razorpay_webhook', 'health_scorer', 'recovery_planner', 'policy_engine', 'circuit_breaker', 'verification_gateway', 'execution_engine', 'human');

      CREATE TABLE events (
        event_id VARCHAR(255) PRIMARY KEY,
        sequence_number BIGSERIAL UNIQUE NOT NULL,
        prev_hash VARCHAR(64) NOT NULL,
        hash VARCHAR(64) NOT NULL,
        subscription_id VARCHAR(255) NULL,
        instrument_id VARCHAR(255) NULL,
        event_type VARCHAR(100) NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}',
        actor event_actor NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        razorpay_event_id VARCHAR(255) NULL
      );
    `);

    const adapter = db.adapters.createPg();
    const pool = new adapter.Pool() as unknown as pg.Pool;

    const eventStore = new EventStore(pool);
    const result = await seedSyntheticEvents({
      eventCount: 25,
      eventStore,
    });

    expect(result.valid).toBe(true);
    expect(result.verifiedCount).toBe(25);
    expect(result.errors).toHaveLength(0);
    expect(result.tipSequenceNumber).toBe(25);

    await pool.end();
  });
});
