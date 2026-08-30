import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RecoveryPipelineOrchestrator } from '../src/orchestrator/pipeline-orchestrator.js';
import { CohortCircuitBreaker } from '../src/circuit-breaker/circuit-breaker.js';
import { EventStore } from '../src/event-store/event-store.js';
import { RazorpayClient } from '../src/razorpay/client.js';
import { buildApp } from '../src/index.js';
import { createTestDatabase, type TestPool } from './test-db.js';

describe('End-to-End Recovery Pipeline Orchestrator Tests', () => {
  let pool: TestPool;
  let cleanup: () => Promise<void>;
  let eventStore: EventStore;
  let circuitBreaker: CohortCircuitBreaker;
  let orchestrator: RecoveryPipelineOrchestrator;

  beforeEach(async () => {
    const testDb = await createTestDatabase();
    pool = testDb.pool;
    cleanup = testDb.cleanup;
    eventStore = new EventStore(pool);
    circuitBreaker = new CohortCircuitBreaker(eventStore);
    orchestrator = new RecoveryPipelineOrchestrator(
      pool,
      eventStore,
      undefined,
      circuitBreaker,
    );
    RazorpayClient.clearSimulatedLiveOverrides();
  });

  afterEach(async () => {
    RazorpayClient.clearSimulatedLiveOverrides();
    await cleanup();
  });

  async function seedTestInstrument(id: string, rail: 'card' | 'upi_autopay' | 'enach', mandateStatus: 'active' | 'revoked' = 'active') {
    await pool.query(
      `INSERT INTO subscriptions (subscription_id, customer_id, plan_id, status)
       VALUES ('sub_${id}', 'cust_${id}', 'plan_pro', 'active');`,
    );

    await pool.query(
      `INSERT INTO instruments (instrument_id, subscription_id, rail, mandate_status, ltv_tier, annualized_value)
       VALUES ('${id}', 'sub_${id}', '${rail}', '${mandateStatus}', 'high', 12000000);`,
    );
  }

  it('1. HAPPY PATH: should process instrument with payment failure, propose retry, and execute permitted action', async () => {
    const instId = 'inst_orch_happy_001';
    await seedTestInstrument(instId, 'card', 'active');

    // Append failure event so planner proposes schedule_retry
    await eventStore.appendEvent({
      instrumentId: instId,
      subscriptionId: `sub_${instId}`,
      eventType: 'subscription.pending',
      actor: 'razorpay_webhook',
      payload: {
        event: 'subscription.pending',
        payload: {
          payment: {
            entity: {
              id: 'pay_fail_001',
              error_code: 'BAD_REQUEST_ERROR',
              error_description: 'Temporary bank decline',
            },
          },
        },
      },
    });

    const result = await orchestrator.processInstrument(instId);

    expect(result.instrumentId).toBe(instId);
    expect(result.risk).toBeDefined();
    expect(result.erv).toBeDefined();
    expect(result.plan).toBeDefined();
    expect(result.policy).toBeDefined();
    expect(result.verification.status).toBe('VERIFIED_SAFE');
    expect(result.execution.status).toBe('SUCCESS');

    // Verify hash chain ledger integrity
    const integrity = await eventStore.verifyChainIntegrity();
    expect(integrity.valid).toBe(true);
  });

  it('2. VERIFICATION BLOCKED: should abort action and route to escalation queue when live state is revoked', async () => {
    const instId = 'inst_orch_stale_002';
    await seedTestInstrument(instId, 'card', 'active');

    // Simulate silent bank revocation at 2:00 AM
    RazorpayClient.setSimulatedLiveOverride(instId, {
      mandateStatus: 'revoked',
    });

    const result = await orchestrator.processInstrument(instId);

    expect(result.verification.status).toBe('BLOCKED');
    expect(result.verification.blockedReason).toBe('STALE_STATE_DISAGREEMENT');
    expect(result.execution.status).toBe('ESCALATED');
    expect(result.escalation).toBeDefined();
    expect(result.escalation?.triggerReason).toBe('STALE_STATE_DISAGREEMENT');
  });

  it('3. CIRCUIT BREAKER BLOCKED: should intercept action when cohort circuit breaker is OPEN', async () => {
    const instId = 'inst_orch_cb_003';
    await seedTestInstrument(instId, 'upi_autopay', 'active');

    // Append failure event so planner proposes retry
    await eventStore.appendEvent({
      instrumentId: instId,
      subscriptionId: `sub_${instId}`,
      eventType: 'subscription.pending',
      actor: 'razorpay_webhook',
      payload: {
        event: 'subscription.pending',
        payload: {
          payment: {
            entity: {
              id: 'pay_fail_003',
              error_code: 'BAD_REQUEST_ERROR',
              error_description: 'Temporary bank failure',
            },
          },
        },
      },
    });

    // Trip UPI AutoPay breaker
    const cohort = 'rail:upi_autopay';
    for (let i = 0; i < 10; i++) {
      await circuitBreaker.recordOutcome(cohort, false);
    }
    expect(circuitBreaker.getStatus(cohort).state).toBe('OPEN');

    const result = await orchestrator.processInstrument(instId);

    expect(result.policy.result).toBe('BLOCK');
    expect(result.policy.finalAction).toBe('escalate');
    expect(result.execution.status).toBe('ESCALATED');
  });

  it('4. BATCH PROCESSING: should process entire instrument dataset and return structured summary', async () => {
    await seedTestInstrument('inst_batch_1', 'card', 'active');
    await seedTestInstrument('inst_batch_2', 'upi_autopay', 'active');
    await seedTestInstrument('inst_batch_3', 'enach', 'active');

    const summary = await orchestrator.processBatch();

    expect(summary.total).toBe(3);
    expect(summary.results).toHaveLength(3);
    expect(summary.byVerificationStatus.VERIFIED_SAFE).toBe(3);
  });

  it('5. REST API: should handle POST /api/pipeline/process/:instrumentId and escalation resolution', async () => {
    const instId = 'inst_api_test_005';
    await seedTestInstrument(instId, 'card', 'active');

    const app = await buildApp({
      pipelineOptions: { orchestrator },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/pipeline/process/${instId}`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.result.instrumentId).toBe(instId);

    await app.close();
  });
});
