import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventStore } from '../src/event-store/event-store.js';
import { computeEventHash, canonicalizeJson } from '../src/event-store/hasher.js';
import { evaluateInstrumentHealth } from '../src/risk/scorer.js';
import { decide } from '../src/policy/engine.js';
import { CohortCircuitBreaker } from '../src/circuit-breaker/circuit-breaker.js';
import { VerificationGateway } from '../src/verification/gateway.js';
import { CounterfactualEngine } from '../src/attribution/counterfactual-engine.js';
import { EscalationService } from '../src/escalation/escalation-service.js';
import { RazorpayClient } from '../src/razorpay/client.js';
import { createTestDatabase, type TestPool } from './test-db.js';
import type { DbInstrument, StoredEvent } from '@recovery/shared';

describe('Comprehensive Multi-Case Edge & Boundary Test Suite', () => {
  let pool: TestPool;
  let cleanup: () => Promise<void>;
  let eventStore: EventStore;

  beforeEach(async () => {
    const testDb = await createTestDatabase();
    pool = testDb.pool;
    cleanup = testDb.cleanup;
    eventStore = new EventStore(pool);
  });

  afterEach(async () => {
    RazorpayClient.clearSimulatedLiveOverrides();
    await cleanup();
  });

  // ===========================================================================
  // 1. CRYPTOGRAPHIC EVENT STORE & CANONICALIZATION EDGE CASES
  // ===========================================================================
  describe('1. Cryptographic Event Store & Canonicalization', () => {
    it('1.1 should deterministically produce identical SHA-256 hash regardless of object key order', () => {
      const payload1 = { z: 100, a: { beta: 'two', alpha: 'one' }, array: [3, 2, 1] };
      const payload2 = { array: [3, 2, 1], a: { alpha: 'one', beta: 'two' }, z: 100 };

      const hash1 = computeEventHash({
        prevHash: '0000000000000000000000000000000000000000000000000000000000000000',
        eventType: 'invoice.payment_failed',
        createdAt: '2026-08-30T12:00:00.000Z',
        payload: payload1,
      });

      const hash2 = computeEventHash({
        prevHash: '0000000000000000000000000000000000000000000000000000000000000000',
        eventType: 'invoice.payment_failed',
        createdAt: '2026-08-30T12:00:00.000Z',
        payload: payload2,
      });

      expect(hash1).toBe(hash2);
      expect(canonicalizeJson(payload1)).toBe(canonicalizeJson(payload2));
    });

    it('1.2 should strictly protect events from mutation and detect hash chain validity', async () => {
      await eventStore.appendEvent({
        subscriptionId: 'sub_tamper_01',
        eventType: 'mandate.created',
        actor: 'razorpay_webhook',
        payload: { status: 'active' },
      });

      const e2 = await eventStore.appendEvent({
        subscriptionId: 'sub_tamper_01',
        eventType: 'invoice.payment_failed',
        actor: 'razorpay_webhook',
        payload: { error_code: 'INSUFFICIENT_FUNDS' },
      });

      await eventStore.appendEvent({
        subscriptionId: 'sub_tamper_01',
        eventType: 'recovery.initiated',
        actor: 'execution_engine',
        payload: { action: 'smart_retry' },
      });

      // Chain should initially be valid
      const initialCheck = await eventStore.verifyChainIntegrity();
      expect(initialCheck.valid).toBe(true);
      expect(initialCheck.verifiedCount).toBe(3);

      // Confirm that the immutable trigger rejects any attempts to mutate events
      let updateRejected = false;
      try {
        await pool.query(
          `UPDATE events SET payload = $1 WHERE event_id = $2`,
          [JSON.stringify({ error_code: 'TAMPERED_INJECTED_CODE' }), e2.eventId],
        );
      } catch (err: unknown) {
        expect((err as Error).message).toContain('Events table is append-only');
        updateRejected = true;
      }
      expect(updateRejected).toBe(true);

      // Chain integrity remains 100% sound
      const finalCheck = await eventStore.verifyChainIntegrity();
      expect(finalCheck.valid).toBe(true);
      expect(finalCheck.verifiedCount).toBe(3);
    });
  });

  // ===========================================================================
  // 2. RISK SCORING BOUNDARY VALUE ANALYSIS
  // ===========================================================================
  describe('2. Risk Intelligence Boundary Value Analysis', () => {
    it('2.1 should score card near-expiry smoothly across 0, 10, 20, 21 days', () => {
      const baseInstrument: DbInstrument = {
        instrument_id: 'inst_card_boundary',
        subscription_id: 'sub_boundary',
        rail: 'card',
        mandate_status: 'active',
        created_at: new Date().toISOString(),
        last_synced_at: new Date().toISOString(),
        ltv_tier: 'high',
        annualized_value: 12000000,
        expiry_date: null,
      };

      const refTime = new Date('2026-09-01T12:00:00.000Z');

      // Exact day of expiry (0 days) -> penalty = -0.35 * (1 - 0/20) = -0.35 -> Score = 0.65 (DEGRADING)
      const day0Instrument = {
        ...baseInstrument,
        expiry_date: new Date('2026-09-01T12:00:00.000Z').toISOString(),
      };
      const res0 = evaluateInstrumentHealth(day0Instrument, [], { referenceTime: refTime });
      expect(res0.trajectory).toBe('DEGRADING');
      expect(res0.rootCause).toBe('CARD_EXPIRY_RISK');
      expect(res0.healthScore).toBe(0.65);

      // 10 days remaining -> penalty = -0.35 * (1 - 10/20) = -0.175 -> Score = 0.825 (HEALTHY trajectory but near-expiry root cause)
      const day10Instrument = {
        ...baseInstrument,
        expiry_date: new Date(refTime.getTime() + 10 * 86400 * 1000).toISOString(),
      };
      const res10 = evaluateInstrumentHealth(day10Instrument, [], { referenceTime: refTime });
      expect(res10.healthScore).toBe(0.825);
      expect(res10.rootCause).toBe('CARD_EXPIRY_RISK');

      // Exactly 20 days remaining -> penalty = -0.35 * (1 - 20/20) = -0.0 -> Score = 1.0 (HEALTHY)
      const day20Instrument = {
        ...baseInstrument,
        expiry_date: new Date(refTime.getTime() + 20 * 86400 * 1000).toISOString(),
      };
      const res20 = evaluateInstrumentHealth(day20Instrument, [], { referenceTime: refTime });
      expect(res20.healthScore).toBe(1.0);
      expect(res20.trajectory).toBe('HEALTHY');

      // 25 days remaining (>20 days) -> penalty = 0.0 -> Score = 1.0 (HEALTHY, rootCause = NONE)
      const day25Instrument = {
        ...baseInstrument,
        expiry_date: new Date(refTime.getTime() + 25 * 86400 * 1000).toISOString(),
      };
      const res25 = evaluateInstrumentHealth(day25Instrument, [], { referenceTime: refTime });
      expect(res25.healthScore).toBe(1.0);
      expect(res25.rootCause).toBe('NONE');

      // Expired in the past (-5 days) -> penalty = -0.70 -> Score = 0.30 (DEGRADING / TERMINAL boundary)
      const expiredInstrument = {
        ...baseInstrument,
        expiry_date: new Date(refTime.getTime() - 5 * 86400 * 1000).toISOString(),
      };
      const resExpired = evaluateInstrumentHealth(expiredInstrument, [], { referenceTime: refTime });
      expect(resExpired.healthScore).toBe(0.3);
      expect(resExpired.rootCause).toBe('CARD_EXPIRY_RISK');
    });

    it('2.2 should clamp score strictly between [0.0000, 1.0000] under extreme penalties', () => {
      const instrument: DbInstrument = {
        instrument_id: 'inst_extreme',
        subscription_id: 'sub_extreme',
        rail: 'card',
        mandate_status: 'revoked', // -0.85
        created_at: new Date().toISOString(),
        last_synced_at: new Date().toISOString(),
        ltv_tier: 'low',
        annualized_value: 120000,
        expiry_date: new Date('2020-01-01').toISOString(), // -0.70
      };

      const events: StoredEvent[] = [
        {
          eventId: 'evt_1',
          sequenceNumber: 1,
          prevHash: '000',
          hash: '111',
          subscriptionId: 'sub_extreme',
          instrumentId: 'inst_extreme',
          eventType: 'invoice.payment_failed',
          actor: 'razorpay_webhook',
          payload: { error_code: 'USER_CANCELLED_MANDATE' }, // -0.50 + consecutive failure penalties
          createdAt: new Date().toISOString(),
        },
      ];

      const res = evaluateInstrumentHealth(instrument, events);
      expect(res.healthScore).toBe(0.0);
      expect(res.healthScore).toBeGreaterThanOrEqual(0.0);
      expect(res.healthScore).toBeLessThanOrEqual(1.0);
      expect(res.trajectory).toBe('TERMINAL');
    });
  });

  // ===========================================================================
  // 3. DETERMINISTIC POLICY ENGINE COMPLIANCE & BOUNDARY CASES
  // ===========================================================================
  describe('3. Deterministic Policy Engine Compliance Boundaries', () => {
    it('3.1 should enforce exact AFA ₹15,000 threshold boundary on UPI AutoPay', () => {
      // Exactly ₹15,000.00 (1,500,000 paise) -> ALLOW
      const exactAfa = decide({
        instrumentId: 'inst_upi_afa_exact',
        subscriptionId: 'sub_upi_afa_exact',
        rail: 'upi_autopay',
        proposedAction: 'retry',
        attemptCount: 1,
        customerContactCountThisCycle: 0,
        amountPaise: 1500000, // ₹15,000.00
        trajectory: 'DEGRADING',
      });
      expect(exactAfa.result).toBe('ALLOW');
      expect(exactAfa.finalAction).toBe('retry');

      // ₹15,000.01 (1,500,001 paise) -> MODIFY to proactive_nudge (AFA step-up)
      const overAfa = decide({
        instrumentId: 'inst_upi_afa_over',
        subscriptionId: 'sub_upi_afa_over',
        rail: 'upi_autopay',
        proposedAction: 'retry',
        attemptCount: 1,
        customerContactCountThisCycle: 0,
        amountPaise: 1500001, // ₹15,000.01
        trajectory: 'DEGRADING',
      });
      expect(overAfa.result).toBe('MODIFY');
      expect(overAfa.finalAction).toBe('proactive_nudge');
      expect(overAfa.ruleIdMatched).toBe('UPI-AFA-THRESHOLD-001');

      // Insurance category (MCC 6300) with ₹50,000 -> ALLOW (under ₹1,00,000 category cap)
      const insuranceAllowed = decide({
        instrumentId: 'inst_upi_ins',
        subscriptionId: 'sub_upi_ins',
        rail: 'upi_autopay',
        mccCode: '6300', // Insurance
        proposedAction: 'retry',
        attemptCount: 1,
        customerContactCountThisCycle: 0,
        amountPaise: 5000000, // ₹50,000
        trajectory: 'DEGRADING',
      });
      expect(insuranceAllowed.result).toBe('ALLOW');
      expect(insuranceAllowed.finalAction).toBe('retry');

      // Insurance category (MCC 6300) with ₹1,00,001 -> MODIFY
      const insuranceOver = decide({
        instrumentId: 'inst_upi_ins_over',
        subscriptionId: 'sub_upi_ins_over',
        rail: 'upi_autopay',
        mccCode: '6300',
        proposedAction: 'retry',
        attemptCount: 1,
        customerContactCountThisCycle: 0,
        amountPaise: 10000001, // ₹1,00,000.01
        trajectory: 'DEGRADING',
      });
      expect(insuranceOver.result).toBe('MODIFY');
      expect(insuranceOver.finalAction).toBe('proactive_nudge');
    });

    it('3.2 should enforce eNACH per-bank attempt caps (SBI = 2, HDFC = 3)', () => {
      // SBI attempt 1 -> ALLOW
      const sbi1 = decide({
        instrumentId: 'inst_sbi_1',
        subscriptionId: 'sub_sbi_1',
        rail: 'enach',
        bankCode: 'SBIN',
        proposedAction: 'retry',
        attemptCount: 1,
        customerContactCountThisCycle: 0,
        trajectory: 'DEGRADING',
      });
      expect(sbi1.result).toBe('ALLOW');

      // SBI attempt 2 (Cap is 2) -> MODIFY to grace_period
      const sbi2 = decide({
        instrumentId: 'inst_sbi_2',
        subscriptionId: 'sub_sbi_2',
        rail: 'enach',
        bankCode: 'SBIN',
        proposedAction: 'retry',
        attemptCount: 2,
        customerContactCountThisCycle: 0,
        trajectory: 'DEGRADING',
      });
      expect(sbi2.result).toBe('MODIFY');
      expect(sbi2.finalAction).toBe('grace_period');
      expect(sbi2.ruleIdMatched).toBe('ENACH-BANK-RETRY-CAP-001');

      // HDFC attempt 2 (Cap is 3) -> ALLOW
      const hdfc2 = decide({
        instrumentId: 'inst_hdfc_2',
        subscriptionId: 'sub_hdfc_2',
        rail: 'enach',
        bankCode: 'HDFC',
        proposedAction: 'retry',
        attemptCount: 2,
        customerContactCountThisCycle: 0,
        trajectory: 'DEGRADING',
      });
      expect(hdfc2.result).toBe('ALLOW');
    });

    it('3.3 should enforce customer fatigue limit of max 1 nudge per cycle', () => {
      // First nudge this cycle -> ALLOW
      const nudge1 = decide({
        instrumentId: 'inst_nudge_1',
        subscriptionId: 'sub_nudge_1',
        rail: 'card',
        proposedAction: 'proactive_nudge',
        attemptCount: 0,
        customerContactCountThisCycle: 0,
        trajectory: 'DEGRADING',
      });
      expect(nudge1.result).toBe('ALLOW');
      expect(nudge1.finalAction).toBe('proactive_nudge');

      // Second nudge attempt this cycle -> MODIFY to schedule_retry
      const nudge2 = decide({
        instrumentId: 'inst_nudge_2',
        subscriptionId: 'sub_nudge_2',
        rail: 'card',
        proposedAction: 'proactive_nudge',
        attemptCount: 0,
        customerContactCountThisCycle: 1, // already contacted
        trajectory: 'DEGRADING',
      });
      expect(nudge2.result).toBe('MODIFY');
      expect(nudge2.finalAction).toBe('schedule_retry');
      expect(nudge2.ruleIdMatched).toBe('GLOBAL-NUDGE-CAP-001');
    });
  });

  // ===========================================================================
  // 4. COHORT CIRCUIT BREAKER ROLLING WINDOW & COOLDOWN BEHAVIOR
  // ===========================================================================
  describe('4. Cohort Circuit Breaker Rolling Window & State Transitions', () => {
    it('4.1 should maintain exact N=20 rolling window and compute accurate success rate', async () => {
      const cb = new CohortCircuitBreaker(undefined, { windowSize: 20, failureThreshold: 0.4 });
      const cohortKey = 'rail:test_window';

      // Record 10 successes followed by 10 failures (20 total) -> success rate = 10/20 = 50% (CLOSED)
      for (let i = 0; i < 10; i++) await cb.recordOutcome(cohortKey, true);
      for (let i = 0; i < 10; i++) await cb.recordOutcome(cohortKey, false);

      let status = cb.getStatus(cohortKey);
      expect(status.totalAttemptsInWindow).toBe(20);
      expect(status.currentSuccessRate).toBe(0.5);
      expect(status.state).toBe('CLOSED');

      // Record 3 more failures: oldest 3 successes drop off -> 7 successes, 13 failures (7/20 = 35% < 40%) -> TRIPPED to OPEN
      await cb.recordOutcome(cohortKey, false);
      await cb.recordOutcome(cohortKey, false);
      const tripRes = await cb.recordOutcome(cohortKey, false);

      expect(tripRes.state).toBe('OPEN');
      expect(tripRes.trippedNow).toBe(true);

      status = cb.getStatus(cohortKey);
      expect(status.state).toBe('OPEN');
      expect(status.totalAttemptsInWindow).toBe(20);
    });

    it('4.2 should transition from OPEN to HALF_OPEN after cooldown and recover on test success', async () => {
      const cb = new CohortCircuitBreaker(undefined, {
        windowSize: 20,
        failureThreshold: 0.4,
        cooldownPeriodSeconds: 10, // 10s cooldown
      });
      const cohortKey = 'rail:cooldown_test';

      // Force trip
      for (let i = 0; i < 15; i++) await cb.recordOutcome(cohortKey, false);
      expect(cb.getStatus(cohortKey).state).toBe('OPEN');

      // Before cooldown expires -> remains OPEN
      const now = new Date();
      const beforeCooldown = new Date(now.getTime() + 5 * 1000);
      expect(cb.getStatus(cohortKey, beforeCooldown).state).toBe('OPEN');

      // After cooldown (11 seconds) -> transitions to HALF_OPEN
      const afterCooldown = new Date(now.getTime() + 11 * 1000);
      expect(cb.getStatus(cohortKey, afterCooldown).state).toBe('HALF_OPEN');

      // Successful test in HALF_OPEN closes the breaker
      await cb.recordOutcome(cohortKey, true);
      expect(cb.getStatus(cohortKey).state).toBe('CLOSED');
    });
  });

  // ===========================================================================
  // 5. SAFETY VERIFICATION GATEWAY ZERO-TRUST CHECKS
  // ===========================================================================
  describe('5. Safety Verification Gateway Zero-Trust Pre-Action Guard', () => {
    it('5.1 should block stale policy decisions (> 15 minutes old)', async () => {
      const gateway = new VerificationGateway();
      const staleDecisionTime = new Date(Date.now() - 1000 * 1000).toISOString(); // 1000s ago (> 900s limit)

      RazorpayClient.setSimulatedLiveOverride('inst_stale_policy', { mandateStatus: 'active' });

      const verifyResult = await gateway.verify({
        instrument: {
          instrument_id: 'inst_stale_policy',
          subscription_id: 'sub_stale_policy',
          rail: 'card',
          mandate_status: 'active',
          created_at: new Date().toISOString(),
          last_synced_at: new Date().toISOString(),
          ltv_tier: 'standard',
          annualized_value: 3600000,
          expiry_date: null,
        },
        decision: {
          result: 'ALLOW',
          finalAction: 'retry',
          ruleIdMatched: 'CARD-RETRY-OFFSET-001',
          evaluatedAt: staleDecisionTime,
        },
        idempotencyKey: 'idem_freshness_01',
      });

      expect(verifyResult.status).toBe('BLOCKED');
      expect(verifyResult.blockedReason).toBe('POLICY_DECISION_STALE');
    });

    it('5.2 should block duplicate idempotency key execution', async () => {
      const gateway = new VerificationGateway();
      const idemKey = 'idem_unique_test_123';

      RazorpayClient.setSimulatedLiveOverride('inst_idem_test', { mandateStatus: 'active' });

      const context = {
        instrument: {
          instrument_id: 'inst_idem_test',
          subscription_id: 'sub_idem_test',
          rail: 'card' as const,
          mandate_status: 'active' as const,
          created_at: new Date().toISOString(),
          last_synced_at: new Date().toISOString(),
          ltv_tier: 'standard',
          annualized_value: 3600000,
          expiry_date: null,
        },
        decision: {
          result: 'ALLOW' as const,
          finalAction: 'retry' as const,
          ruleIdMatched: 'CARD-RETRY-OFFSET-001',
          evaluatedAt: new Date().toISOString(),
        },
        idempotencyKey: idemKey,
      };

      // First run: SAFE
      const res1 = await gateway.verify(context);
      expect(res1.status).toBe('VERIFIED_SAFE');
      gateway.registerExecutedIdempotencyKey(idemKey);

      // Second run with same idempotency key: BLOCKED
      const res2 = await gateway.verify(context);
      expect(res2.status).toBe('BLOCKED');
      expect(res2.blockedReason).toBe('IDEMPOTENCY_CONFLICT');
    });
  });

  // ===========================================================================
  // 6. ATTRIBUTION & COUNTERFACTUAL ENGINE MATHEMATICAL PRECISION
  // ===========================================================================
  describe('6. Counterfactual Engine Mathematical Precision', () => {
    it('6.1 should accurately calculate Net Value Saved with exact baseline discounts', () => {
      const cfEngine = new CounterfactualEngine();

      // Proactive save on ₹10,000 monthly instrument (15% organic baseline discount)
      const proactiveRes = cfEngine.evaluate({
        instrument: {
          instrument_id: 'inst_card_cf',
          subscription_id: 'sub_cf',
          rail: 'card',
          mandate_status: 'active',
          created_at: new Date().toISOString(),
          last_synced_at: new Date().toISOString(),
          ltv_tier: 'standard',
          annualized_value: 12000000, // ₹10,000 monthly
          expiry_date: null,
        },
        healthSnapshot: {
          instrumentId: 'inst_card_cf',
          subscriptionId: 'sub_cf',
          healthScore: 0.5,
          trajectory: 'DEGRADING',
          rootCause: 'CARD_EXPIRY_RISK',
          recoveryProbability: 0.85,
          featureVector: {
            failure_count_last_3_cycles: 0,
            success_count_total: 0,
            consecutive_failures: 0,
            days_to_expiry: 14,
            days_to_expiry_normalized: 0.15,
            is_near_card_expiry: true,
            decline_code_distribution: {},
            is_over_afa_threshold: false,
            mandate_status: 'active',
            last_event_type: 'health_recomputed',
            issuer_prior: 0.9,
          },
          computedAt: new Date().toISOString(),
        },
        proposedPlan: {
          instrumentId: 'inst_card_cf',
          proposedAction: 'proactive_nudge',
          rootCause: 'CARD_EXPIRY_RISK',
          expectedRecoveryValue: 850000,
          confidence: 0.9,
          reasoning: 'Near expiry',
          generatedAt: new Date().toISOString(),
        },
        execution: {
          status: 'nudged',
          action: 'proactive_nudge',
          success: true,
        },
      });

      expect(proactiveRes.recoveryType).toBe('proactive');
      expect(proactiveRes.atRiskAmountPaise).toBe(1000000); // ₹10,000
      expect(proactiveRes.baselineRecoveredEstimatePaise).toBe(150000); // 15% = ₹1,500
      expect(proactiveRes.revenueSavedPaise).toBe(850000); // 85% = ₹8,500

      // Reactive save on ₹10,000 monthly instrument (30% naive baseline discount)
      const reactiveRes = cfEngine.evaluate({
        instrument: {
          instrument_id: 'inst_upi_cf',
          subscription_id: 'sub_cf_2',
          rail: 'upi_autopay',
          mandate_status: 'active',
          created_at: new Date().toISOString(),
          last_synced_at: new Date().toISOString(),
          ltv_tier: 'standard',
          annualized_value: 12000000,
          expiry_date: null,
        },
        healthSnapshot: {
          instrumentId: 'inst_upi_cf',
          subscriptionId: 'sub_cf_2',
          healthScore: 0.45,
          trajectory: 'DEGRADING',
          rootCause: 'REPEATED_SOFT_DECLINE',
          recoveryProbability: 0.7,
          featureVector: {
            failure_count_last_3_cycles: 1,
            success_count_total: 0,
            consecutive_failures: 1,
            days_to_expiry: 180,
            days_to_expiry_normalized: 1.0,
            is_near_card_expiry: false,
            decline_code_distribution: {},
            is_over_afa_threshold: false,
            mandate_status: 'active',
            last_event_type: 'invoice.payment_failed',
            issuer_prior: 0.9,
          },
          computedAt: new Date().toISOString(),
        },
        proposedPlan: {
          instrumentId: 'inst_upi_cf',
          proposedAction: 'schedule_retry',
          rootCause: 'REPEATED_SOFT_DECLINE',
          expectedRecoveryValue: 700000,
          confidence: 0.8,
          reasoning: 'Retry in window',
          generatedAt: new Date().toISOString(),
        },
        execution: {
          status: 'executed',
          action: 'retry',
          success: true,
        },
      });

      expect(reactiveRes.recoveryType).toBe('reactive');
      expect(reactiveRes.baselineRecoveredEstimatePaise).toBe(300000); // 30% = ₹3,000
      expect(reactiveRes.revenueSavedPaise).toBe(700000); // 70% = ₹7,000
    });
  });

  // ===========================================================================
  // 7. ESCALATION QUEUE LIFECYCLE & ERROR HANDLING
  // ===========================================================================
  describe('7. Human Escalation Queue Lifecycle', () => {
    it('7.1 should create, query, and resolve escalation tickets with audit notes', async () => {
      const escalationService = new EscalationService(pool, eventStore);

      const esc = await escalationService.createEscalation({
        instrumentId: 'inst_esc_test_01',
        subscriptionId: 'sub_esc_test_01',
        reason: 'Repeated hard decline on critical LTV subscription',
        blockedReason: 'STALE_STATE_DISAGREEMENT',
        proposedAction: 'pause',
        payload: { customerEmail: 'vip@acmecorp.com' },
      });

      expect(esc.escalation_id).toBeDefined();
      expect(esc.status).toBe('pending');

      // Query pending escalations
      const pendingList = await escalationService.listEscalations({ status: 'pending' });
      expect(pendingList.some((e) => e.escalation_id === esc.escalation_id)).toBe(true);

      // Resolve escalation
      const resolved = await escalationService.resolveEscalation({
        escalationId: esc.escalation_id,
        resolvedBy: 'lead_ops_agent',
        resolutionNotes: 'Customer updated payment details via VIP portal.',
        status: 'resolved',
      });

      expect(resolved.status).toBe('resolved');
      expect(resolved.resolved_by).toBe('lead_ops_agent');
      expect(resolved.resolved_at).toBeDefined();

      // Query pending again -> should no longer be pending
      const updatedPending = await escalationService.listEscalations({ status: 'pending' });
      expect(updatedPending.some((e) => e.escalation_id === esc.escalation_id)).toBe(false);
    });
  });
});
