import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventStore } from '../src/event-store/event-store.js';
import { RecoveryPipelineOrchestrator } from '../src/pipeline/orchestrator.js';
import { HealthService } from '../src/risk/health-service.js';
import { DecisionTraceService } from '../src/audit/decision-trace-service.js';
import { RazorpayClient } from '../src/razorpay/client.js';
import { createTestDatabase, type TestPool } from './test-db.js';

describe('Phase 13: End-to-End Autonomous Control Loop Integration Tests', () => {
  let pool: TestPool;
  let cleanup: () => Promise<void>;
  let eventStore: EventStore;
  let healthService: HealthService;
  let orchestrator: RecoveryPipelineOrchestrator;
  let decisionTraceService: DecisionTraceService;

  beforeEach(async () => {
    const testDb = await createTestDatabase();
    pool = testDb.pool;
    cleanup = testDb.cleanup;
    eventStore = new EventStore(pool);
    healthService = new HealthService(eventStore, pool);
    orchestrator = new RecoveryPipelineOrchestrator({ pool, eventStore });
    decisionTraceService = new DecisionTraceService(pool, eventStore);
  });

  afterEach(async () => {
    RazorpayClient.clearSimulatedLiveOverrides();
    await cleanup();
  });

  it('1. Healthy-Instrument Happy Path: Health >= 0.70 results in NO_ACTION pass-through with zero friction', async () => {
    // Seed healthy subscription & instrument
    await pool.query(
      `INSERT INTO subscriptions (subscription_id, customer_id, plan_id, status)
       VALUES ('sub_healthy_e2e', 'cust_healthy', 'plan_pro', 'active')
       ON CONFLICT (subscription_id) DO NOTHING;`,
    );
    await pool.query(
      `INSERT INTO instruments (instrument_id, subscription_id, rail, mandate_status, annualized_value, ltv_tier)
       VALUES ('inst_healthy_e2e', 'sub_healthy_e2e', 'card', 'active', 60000000, 'critical')
       ON CONFLICT (instrument_id) DO NOTHING;`,
    );

    // Seed historical successful charges
    await eventStore.appendEvent({
      subscriptionId: 'sub_healthy_e2e',
      instrumentId: 'inst_healthy_e2e',
      eventType: 'payment.authorized',
      actor: 'razorpay_webhook',
      payload: { amount: 500000 },
    });

    const result = await orchestrator.processInstrument('inst_healthy_e2e');

    expect(result.pipelineStatus).toBe('no_op');
    expect(result.healthSnapshot.trajectory).toBe('HEALTHY');
    expect(result.proposedPlan.proposedAction).toBe('NO_ACTION');
    expect(result.policyDecision.result).toBe('NO_ACTION');
    expect(result.policyDecision.finalAction).toBe('NO_ACTION');
    expect(result.execution.status).toBe('no_op');

    // Confirm trace is clean
    const trace = await decisionTraceService.getDecisionTrace('sub_healthy_e2e');
    expect(trace.steps.some((s) => s.stage === 'diagnosed')).toBe(true);
    expect(trace.steps.some((s) => s.stage === 'proposed')).toBe(true);
    expect(trace.steps.some((s) => s.stage === 'permitted')).toBe(true);
  });

  it('2. Degrading Proactive-Save Path: Near-expiry card triggers proactive nudge before failure occurs', async () => {
    await pool.query(
      `INSERT INTO subscriptions (subscription_id, customer_id, plan_id, status)
       VALUES ('sub_nudge_e2e', 'cust_nudge', 'plan_tier_high', 'active')
       ON CONFLICT (subscription_id) DO NOTHING;`,
    );
    // Card with expiry in 14 days
    const nearExpiryDate = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();
    await pool.query(
      `INSERT INTO instruments (instrument_id, subscription_id, rail, mandate_status, annualized_value, ltv_tier, expiry_date)
       VALUES ('inst_nudge_e2e', 'sub_nudge_e2e', 'card', 'active', 48000000, 'high', $1)
       ON CONFLICT (instrument_id) DO NOTHING;`,
      [nearExpiryDate],
    );

    const result = await orchestrator.processInstrument('inst_nudge_e2e');

    expect(result.pipelineStatus).toBe('executed');
    expect(result.healthSnapshot.rootCause).toBe('CARD_EXPIRY_RISK');
    expect(result.proposedPlan.proposedAction).toBe('proactive_nudge');
    expect(result.policyDecision.result).toBe('ALLOW');
    expect(result.policyDecision.finalAction).toBe('proactive_nudge');
    expect(result.verification?.status).toBe('VERIFIED_SAFE');
    expect(result.execution.status).toBe('nudged');

    // Verify decision trace has chronological stages
    const trace = await decisionTraceService.getDecisionTrace('sub_nudge_e2e');
    expect(trace.steps.some((s) => s.stage === 'diagnosed')).toBe(true);
    expect(trace.steps.some((s) => s.stage === 'proposed')).toBe(true);
    expect(trace.steps.some((s) => s.stage === 'permitted')).toBe(true);
    expect(trace.steps.some((s) => s.stage === 'executed')).toBe(true);
  });

  it('3. Terminal Grace-Pause Path: High LTV subscription with hard declines is safely escalated/paused', async () => {
    await pool.query(
      `INSERT INTO subscriptions (subscription_id, customer_id, plan_id, status)
       VALUES ('sub_pause_e2e', 'cust_pause', 'plan_tier_crit', 'active')
       ON CONFLICT (subscription_id) DO NOTHING;`,
    );
    await pool.query(
      `INSERT INTO instruments (instrument_id, subscription_id, rail, mandate_status, annualized_value, ltv_tier)
       VALUES ('inst_pause_e2e', 'sub_pause_e2e', 'upi_autopay', 'active', 120000000, 'critical')
       ON CONFLICT (instrument_id) DO NOTHING;`,
    );

    // Append 3 repeated failures
    for (let i = 0; i < 3; i++) {
      await eventStore.appendEvent({
        subscriptionId: 'sub_pause_e2e',
        instrumentId: 'inst_pause_e2e',
        eventType: 'invoice.payment_failed',
        actor: 'razorpay_webhook',
        payload: { error_code: 'MANDATE_INACTIVE' },
      });
    }

    const result = await orchestrator.processInstrument('inst_pause_e2e');

    expect(result.healthSnapshot.trajectory).toBe('TERMINAL');
    expect(result.policyDecision.result).toBe('ALLOW');
    expect(result.policyDecision.finalAction).toBe('escalate');
    expect(result.execution.status).toBe('escalated');
  });

  it('4. 2 AM Stale-State Demo Path: Local cached active vs live Razorpay revoked mandate is BLOCKED', async () => {
    await pool.query(
      `INSERT INTO subscriptions (subscription_id, customer_id, plan_id, status)
       VALUES ('sub_stale_e2e', 'cust_stale', 'plan_standard', 'active')
       ON CONFLICT (subscription_id) DO NOTHING;`,
    );
    await pool.query(
      `INSERT INTO instruments (instrument_id, subscription_id, rail, mandate_status, annualized_value, ltv_tier)
       VALUES ('inst_stale_e2e', 'sub_stale_e2e', 'card', 'active', 36000000, 'standard')
       ON CONFLICT (instrument_id) DO NOTHING;`,
    );

    // Seed a payment failure to prompt a retry
    await eventStore.appendEvent({
      subscriptionId: 'sub_stale_e2e',
      instrumentId: 'inst_stale_e2e',
      eventType: 'invoice.payment_failed',
      actor: 'razorpay_webhook',
      payload: { error_code: 'INSUFFICIENT_FUNDS' },
    });

    // Simulate 2 AM out-of-band mandate revocation in live Razorpay state
    RazorpayClient.setSimulatedLiveOverride('inst_stale_e2e', { mandateStatus: 'revoked' });

    const result = await orchestrator.processInstrument('inst_stale_e2e');

    // Verification Gateway must catch the mismatch and block execution
    expect(result.pipelineStatus).toBe('blocked_by_verification');
    expect(result.verification?.status).toBe('BLOCKED');
    expect(result.verification?.blockedReason).toBe('STALE_STATE_DISAGREEMENT');
    expect(result.verification?.liveMandateStatus).toBe('revoked');
    expect(result.verification?.cachedMandateStatus).toBe('active');
  });

  it('5. Circuit Breaker Trip & Fail-Closed Guard: Tripped cohort blocks subsequent actions', async () => {
    const cb = orchestrator.getCircuitBreaker();
    const cohortKey = 'rail:upi_autopay';

    // Trip the circuit breaker by recording 12 consecutive failure outcomes
    for (let i = 0; i < 12; i++) {
      await cb.recordOutcome(cohortKey, false);
    }

    await pool.query(
      `INSERT INTO subscriptions (subscription_id, customer_id, plan_id, status)
       VALUES ('sub_cb_e2e', 'cust_cb', 'plan_upi', 'active')
       ON CONFLICT (subscription_id) DO NOTHING;`,
    );
    await pool.query(
      `INSERT INTO instruments (instrument_id, subscription_id, rail, mandate_status, annualized_value, ltv_tier)
       VALUES ('inst_cb_e2e', 'sub_cb_e2e', 'upi_autopay', 'active', 24000000, 'standard')
       ON CONFLICT (instrument_id) DO NOTHING;`,
    );
    await eventStore.appendEvent({
      subscriptionId: 'sub_cb_e2e',
      instrumentId: 'inst_cb_e2e',
      eventType: 'invoice.payment_failed',
      actor: 'razorpay_webhook',
      payload: { error_code: 'BANK_DOWNTIME' },
    });

    const result = await orchestrator.processInstrument('inst_cb_e2e');

    expect(result.pipelineStatus).toBe('blocked_by_circuit_breaker');
    expect(result.policyDecision.result).toBe('BLOCK');
    expect(result.policyDecision.ruleIdMatched).toBe('CIRCUIT-BREAKER-OPEN-001');

    // Reset breaker
    await cb.manualReset(cohortKey, 'operator_test', 'Restored after test');
  });

  it('6. Verification Gateway Fail-Closed Resilience: Stale state throws error and safely blocks', async () => {
    const gateway = orchestrator.getVerificationGateway();

    // Instrument with mismatched live vs cached state
    const instrument = {
      instrument_id: 'inst_fail_close',
      subscription_id: 'sub_fail_close',
      rail: 'card' as const,
      created_at: new Date().toISOString(),
      expiry_date: null,
      mandate_status: 'active' as const,
      last_synced_at: new Date().toISOString(),
      ltv_tier: 'standard',
      annualized_value: '12000000',
    };

    RazorpayClient.setSimulatedLiveOverride('inst_fail_close', { mandateStatus: 'revoked' });

    const verifyResult = await gateway.verify({
      instrument,
      decision: {
        decisionId: 'dec_test',
        instrumentId: 'inst_fail_close',
        subscriptionId: 'sub_fail_close',
        ruleIdMatched: 'CARD_RETRY_INTERVAL',
        result: 'ALLOW',
        proposedAction: 'retry',
        finalAction: 'retry',
        reason: 'Retry scheduled',
        evaluatedAt: new Date().toISOString(),
      },
      idempotencyKey: 'idem_test_123',
    });

    // Verification Gateway must fail CLOSED (status = BLOCKED)
    expect(verifyResult.status).toBe('BLOCKED');
    expect(verifyResult.blockedReason).toBe('STALE_STATE_DISAGREEMENT');
  });
});
