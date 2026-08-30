import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventStore } from '../src/event-store/event-store.js';
import { RecoveryPipelineOrchestrator } from '../src/pipeline/orchestrator.js';
import { HealthService } from '../src/risk/health-service.js';
import { buildApp } from '../src/index.js';
import { createTestDatabase, type TestPool } from './test-db.js';

describe('Phase 12: Dashboard & Opportunity Queue API Endpoints', () => {
  let pool: TestPool;
  let cleanup: () => Promise<void>;
  let eventStore: EventStore;
  let healthService: HealthService;
  let orchestrator: RecoveryPipelineOrchestrator;

  beforeEach(async () => {
    const testDb = await createTestDatabase();
    pool = testDb.pool;
    cleanup = testDb.cleanup;
    eventStore = new EventStore(pool);
    healthService = new HealthService(eventStore, pool);
    orchestrator = new RecoveryPipelineOrchestrator({ pool, eventStore });
  });

  afterEach(async () => {
    await cleanup();
  });

  async function seedTestInstruments() {
    // 1. Seed Subscriptions
    await pool.query(
      `INSERT INTO subscriptions (subscription_id, customer_id, plan_id, status)
       VALUES 
        ('sub_dash_01', 'cust_01', 'plan_tier_high', 'active'),
        ('sub_dash_02', 'cust_02', 'plan_tier_med', 'active'),
        ('sub_dash_03', 'cust_03', 'plan_tier_low', 'active')
       ON CONFLICT (subscription_id) DO NOTHING;`,
    );

    // 2. Seed Instruments with various rails and values
    await pool.query(
      `INSERT INTO instruments (instrument_id, subscription_id, rail, mandate_status, annualized_value, ltv_tier)
       VALUES 
        ('inst_dash_01', 'sub_dash_01', 'card', 'active', 60000000, 'critical'),
        ('inst_dash_02', 'sub_dash_02', 'upi_autopay', 'active', 24000000, 'high'),
        ('inst_dash_03', 'sub_dash_03', 'enach', 'active', 12000000, 'standard')
       ON CONFLICT (instrument_id) DO NOTHING;`,
    );

    // 3. Add a payment failure to inst_dash_01 to create an opportunity
    await eventStore.appendEvent({
      subscriptionId: 'sub_dash_01',
      instrumentId: 'inst_dash_01',
      eventType: 'invoice.payment_failed',
      actor: 'razorpay_webhook',
      payload: { error_code: 'INSUFFICIENT_FUNDS' },
    });
  }

  it('GET /api/opportunities should return ranked opportunity queue sorted by ERV', async () => {
    await seedTestInstruments();

    const app = await buildApp({
      dashboardOptions: { pool, eventStore, orchestrator, healthService },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/opportunities',
    });

    if (res.statusCode !== 200) {
      console.log('GET /api/opportunities error:', res.body);
    }
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.length).toBe(3);

    // Verify properties
    const first = body.data[0];
    expect(first.instrumentId).toBeDefined();
    expect(first.expectedRecoveryValuePaise).toBeGreaterThanOrEqual(0);
    expect(first.trajectory).toBeDefined();
    expect(first.recommendedAction).toBeDefined();

    // Verify descending sort by ERV
    for (let i = 0; i < body.data.length - 1; i++) {
      expect(body.data[i].expectedRecoveryValuePaise).toBeGreaterThanOrEqual(
        body.data[i + 1].expectedRecoveryValuePaise,
      );
    }

    await app.close();
  });

  it('GET /api/instruments should return instrument directory with health sparklines', async () => {
    await seedTestInstruments();

    const app = await buildApp({
      dashboardOptions: { pool, eventStore, orchestrator, healthService },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/instruments',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.length).toBe(3);

    const inst1 = body.data.find((i: { instrumentId: string }) => i.instrumentId === 'inst_dash_01');
    expect(inst1).toBeDefined();
    expect(inst1.rail).toBe('card');
    expect(inst1.failureCount).toBe(1);
    expect(Array.isArray(inst1.sparkline)).toBe(true);
    expect(inst1.sparkline.length).toBeGreaterThan(0);

    await app.close();
  });

  it('POST /api/pipeline/run should execute batch orchestrator and return summary', async () => {
    await seedTestInstruments();

    const app = await buildApp({
      dashboardOptions: { pool, eventStore, orchestrator, healthService },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/pipeline/run',
    });

    if (res.statusCode !== 200) {
      console.log('POST /api/pipeline/run error:', res.body);
    }
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.summary.totalInstruments).toBe(3);
    expect(body.summary.processedCount).toBe(3);
    expect(body.summary.actionsTaken).toBeDefined();

    await app.close();
  });
});
