import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventStore } from '../src/event-store/event-store.js';
import { HealthService } from '../src/risk/health-service.js';
import { BatchRiskRunner } from '../src/risk/batch-runner.js';
import { createTestDatabase, type TestPool } from './test-db.js';

describe('HealthService & BatchRiskRunner Integration Tests', () => {
  let pool: TestPool;
  let cleanup: () => Promise<void>;
  let eventStore: EventStore;
  let service: HealthService;
  let batchRunner: BatchRiskRunner;

  beforeEach(async () => {
    const testDb = await createTestDatabase();
    pool = testDb.pool;
    cleanup = testDb.cleanup;
    eventStore = new EventStore(pool);
    service = new HealthService(eventStore, pool);
    batchRunner = new BatchRiskRunner(eventStore, pool);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('17. should evaluate instrument, write immutable health_snapshot, and append health_recomputed event to EventStore', async () => {
    // 1. Seed instrument and subscription
    await pool.query(
      `INSERT INTO subscriptions (subscription_id, customer_id, plan_id, status, current_instrument_id)
       VALUES ('sub_test_1', 'cust_1', 'plan_pro', 'active', 'inst_test_1');`,
    );

    await pool.query(
      `INSERT INTO instruments (
         instrument_id, subscription_id, rail, mandate_status, ltv_tier, annualized_value
       ) VALUES (
         'inst_test_1', 'sub_test_1', 'upi_autopay', 'active', 'high', 12000000
       );`,
    );

    // 2. Append charge event
    await eventStore.appendEvent({
      subscriptionId: 'sub_test_1',
      instrumentId: 'inst_test_1',
      eventType: 'subscription.charged',
      actor: 'razorpay_webhook',
      payload: { amount: 1000000 },
    });

    // 3. Evaluate and persist
    const result = await service.evaluateAndPersist('inst_test_1');

    expect(result.snapshotId).toMatch(/^snap_/);
    expect(result.health.healthScore).toBe(1.0);
    expect(result.health.trajectory).toBe('HEALTHY');
    expect(result.erv.expectedRecoveryValueRupees).toBeGreaterThan(0);

    // 4. Verify health_snapshots table in DB
    const snapRows = await pool.query(
      'SELECT * FROM health_snapshots WHERE snapshot_id = $1;',
      [result.snapshotId],
    );
    expect(snapRows.rows).toHaveLength(1);
    expect(Number(snapRows.rows[0].health_score)).toBe(1.0);
    expect(snapRows.rows[0].trajectory).toBe('HEALTHY');

    // 5. Verify health_recomputed event in EventStore
    const events = await eventStore.getEventsForInstrument('inst_test_1');
    const healthEvent = events.find((e) => e.eventType === 'health_recomputed');
    expect(healthEvent).toBeDefined();
    expect(healthEvent?.actor).toBe('health_scorer');

    // 6. Verify ledger chain integrity
    const integrity = await eventStore.verifyChainIntegrity();
    expect(integrity.valid).toBe(true);
    expect(integrity.verifiedCount).toBe(2);
  });

  it('18. should run batch analysis and produce ranked Opportunity Queue', async () => {
    // Seed 3 instruments with different values
    await pool.query(
      `INSERT INTO subscriptions (subscription_id, customer_id, plan_id, status)
       VALUES
         ('sub_low', 'cust_1', 'plan_low', 'active'),
         ('sub_med', 'cust_2', 'plan_med', 'pending'),
         ('sub_high', 'cust_3', 'plan_high', 'active');`,
    );

    await pool.query(
      `INSERT INTO instruments (instrument_id, subscription_id, rail, mandate_status, ltv_tier, annualized_value)
       VALUES
         ('inst_low', 'sub_low', 'card', 'active', 'low', 1200000),      -- ₹1,000/mo
         ('inst_med', 'sub_med', 'upi_autopay', 'active', 'medium', 6000000), -- ₹5,000/mo
         ('inst_high', 'sub_high', 'card', 'active', 'critical', 60000000);  -- ₹50,000/mo`,
    );

    // Run batch analysis
    const batchResult = await batchRunner.runBatchAnalysis();

    expect(batchResult.totalInstrumentsEvaluated).toBe(3);
    expect(batchResult.opportunityQueue).toHaveLength(3);

    // Rank 1 should be the highest ERV (inst_high)
    expect(batchResult.opportunityQueue[0].instrumentId).toBe('inst_high');
    expect(batchResult.opportunityQueue[0].rank).toBe(1);
    expect(batchResult.opportunityQueue[0].expectedRecoveryValueRupees).toBeGreaterThan(
      batchResult.opportunityQueue[1].expectedRecoveryValueRupees,
    );

    // Verify chain integrity
    const integrity = await eventStore.verifyChainIntegrity();
    expect(integrity.valid).toBe(true);
  });
});
