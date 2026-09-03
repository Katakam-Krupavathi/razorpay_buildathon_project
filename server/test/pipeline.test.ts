import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RecoveryPipelineOrchestrator } from '../src/pipeline/orchestrator.js';
import { EventStore } from '../src/event-store/event-store.js';
import { RazorpayClient } from '../src/razorpay/client.js';
import { createTestDatabase, type TestPool } from './test-db.js';

describe('End-to-End Recovery Pipeline Orchestrator Tests', () => {
  let pool: TestPool;
  let cleanup: () => Promise<void>;
  let eventStore: EventStore;
  let orchestrator: RecoveryPipelineOrchestrator;

  beforeEach(async () => {
    const testDb = await createTestDatabase();
    pool = testDb.pool;
    cleanup = testDb.cleanup;
    eventStore = new EventStore(pool);
    orchestrator = new RecoveryPipelineOrchestrator({ pool, eventStore });
    RazorpayClient.clearSimulatedLiveOverrides();
  });

  afterEach(async () => {
    RazorpayClient.clearSimulatedLiveOverrides();
    await cleanup();
  });

  async function seedTestInstrument(data: {
    instrumentId: string;
    subscriptionId: string;
    rail: 'card' | 'upi_autopay' | 'enach';
    mandateStatus?: 'active' | 'paused' | 'revoked' | 'expired';
    annualizedValue?: number;
    failureEventsCount?: number;
  }) {
    RazorpayClient.setSimulatedLiveOverride(data.instrumentId, {
      mandateStatus: data.mandateStatus || 'active',
    });

    await pool.query(
      `INSERT INTO subscriptions (subscription_id, customer_id, plan_id, status)
       VALUES ($1, $2, 'plan_monthly', 'active');`,
      [data.subscriptionId, `cust_${data.subscriptionId}`],
    );

    await pool.query(
      `INSERT INTO instruments (instrument_id, subscription_id, rail, mandate_status, ltv_tier, annualized_value)
       VALUES ($1, $2, $3, $4, 'standard', $5);`,
      [
        data.instrumentId,
        data.subscriptionId,
        data.rail,
        data.mandateStatus || 'active',
        data.annualizedValue || 1200000,
      ],
    );

    // Seed optional failed payment events
    const failureCount = data.failureEventsCount || 0;
    for (let i = 0; i < failureCount; i++) {
      await eventStore.appendEvent({
        subscriptionId: data.subscriptionId,
        instrumentId: data.instrumentId,
        eventType: 'invoice.payment_failed',
        actor: 'razorpay_webhook',
        payload: {
          error_code: 'BAD_REQUEST_PAYMENT_DECLINED_BY_BANK',
          error_reason: 'soft_decline',
        },
      });
    }
  }

  it('1. should process a HEALTHY instrument with NO_ACTION outcome through the full pipeline', async () => {
    await seedTestInstrument({
      instrumentId: 'inst_pipe_healthy_01',
      subscriptionId: 'sub_pipe_healthy_01',
      rail: 'card',
      failureEventsCount: 0,
    });

    const result = await orchestrator.processInstrument('inst_pipe_healthy_01');

    expect(result.instrumentId).toBe('inst_pipe_healthy_01');
    expect(result.healthSnapshot.trajectory).toBe('HEALTHY');
    expect(result.proposedPlan.proposedAction).toBe('NO_ACTION');
    expect(result.policyDecision.finalAction).toBe('NO_ACTION');
    expect(result.pipelineStatus).toBe('no_op');
    expect(result.execution?.status).toBe('no_op');
  });

  it('2. should process a DEGRADING instrument, pass Verification Gateway, and execute retry', async () => {
    await seedTestInstrument({
      instrumentId: 'inst_pipe_degrading_02',
      subscriptionId: 'sub_pipe_degrading_02',
      rail: 'card',
      failureEventsCount: 2, // 2 soft declines -> DEGRADING -> retry
    });

    const result = await orchestrator.processInstrument('inst_pipe_degrading_02');

    expect(result.healthSnapshot.trajectory).toBe('DEGRADING');
    expect(result.proposedPlan.proposedAction).toBe('schedule_retry');
    expect(result.policyDecision.result).toBe('ALLOW');
    expect(result.verification?.status).toBe('VERIFIED_SAFE');
    expect(result.pipelineStatus).toBe('executed');
    expect(result.execution?.status).toBe('scheduled');
  });

  it('3. should intercept and escalate when Verification Gateway detects stale state (2 AM bank revocation)', async () => {
    await seedTestInstrument({
      instrumentId: 'inst_pipe_stale_03',
      subscriptionId: 'sub_pipe_stale_03',
      rail: 'card',
      mandateStatus: 'active', // DB believes active
      failureEventsCount: 1,
    });

    // Simulate silent bank revocation
    RazorpayClient.setSimulatedLiveOverride('inst_pipe_stale_03', {
      mandateStatus: 'revoked',
    });

    const result = await orchestrator.processInstrument('inst_pipe_stale_03');

    expect(result.verification?.status).toBe('BLOCKED');
    expect(result.verification?.blockedReason).toBe('STALE_STATE_DISAGREEMENT');
    expect(result.pipelineStatus).toBe('blocked_by_verification');
    expect(result.execution?.status).toBe('escalated');

    // Confirm escalation queue has entry
    const escalations = await orchestrator.getEscalationService().listEscalations();
    expect(escalations.length).toBeGreaterThan(0);
  });

  it('4. should process a batch of instruments and aggregate summary metrics', async () => {
    // Seed 3 test instruments
    await seedTestInstrument({
      instrumentId: 'inst_batch_01',
      subscriptionId: 'sub_batch_01',
      rail: 'card',
      failureEventsCount: 0,
    });
    await seedTestInstrument({
      instrumentId: 'inst_batch_02',
      subscriptionId: 'sub_batch_02',
      rail: 'card',
      failureEventsCount: 2,
    });
    await seedTestInstrument({
      instrumentId: 'inst_batch_03',
      subscriptionId: 'sub_batch_03',
      rail: 'upi_autopay',
      failureEventsCount: 0,
    });

    const summary = await orchestrator.processBatch();

    expect(summary.totalProcessed).toBe(3);
    expect(summary.wallClockMs).toBeGreaterThanOrEqual(0);
    expect(summary.byActionType).toBeDefined();
    expect(summary.completedAt).toBeDefined();
  });
});
