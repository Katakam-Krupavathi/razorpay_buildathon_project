import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DbInstrument, HealthEvaluationResult, ERVCalculationResult } from '@recovery/shared';
import { formulateRecoveryPlan } from '../src/planner/planner.js';
import { RecoveryPlannerService } from '../src/planner/planner-service.js';
import { EventStore } from '../src/event-store/event-store.js';
import { createTestDatabase, type TestPool } from './test-db.js';

describe('AI Recovery Planner Unit Tests', () => {
  const REF_TIME = '2026-08-30T12:00:00.000Z';

  function createMockContext(overrides?: {
    instrument?: Partial<DbInstrument>;
    health?: Partial<HealthEvaluationResult>;
    erv?: Partial<ERVCalculationResult>;
    ltvTier?: string;
  }) {
    const instrument: DbInstrument = {
      instrument_id: 'inst_mock_1',
      subscription_id: 'sub_mock_1',
      rail: 'card',
      created_at: '2026-01-01T00:00:00.000Z',
      expiry_date: '2027-01-01T00:00:00.000Z',
      mandate_status: 'active',
      last_synced_at: '2026-08-30T00:00:00.000Z',
      ltv_tier: overrides?.ltvTier || 'high',
      annualized_value: 12000000,
      ...overrides?.instrument,
    };

    const health: HealthEvaluationResult = {
      instrumentId: instrument.instrument_id,
      subscriptionId: instrument.subscription_id,
      healthScore: 1.0,
      trajectory: 'HEALTHY',
      rootCause: 'NONE',
      recoveryProbability: 0.98,
      featureVector: {
        failure_count_last_3_cycles: 0,
        success_count_total: 6,
        consecutive_failures: 0,
        days_to_expiry: 120,
        days_to_expiry_normalized: 1.0,
        is_near_card_expiry: false,
        decline_code_distribution: {},
        is_over_afa_threshold: false,
        mandate_status: 'active',
        last_event_type: 'subscription.charged',
        issuer_prior: 0.85,
      },
      computedAt: REF_TIME,
      ...overrides?.health,
    };

    const erv: ERVCalculationResult = {
      instrumentId: instrument.instrument_id,
      subscriptionId: instrument.subscription_id,
      amountAtRisk: 1000000, // ₹10,000
      recoveryProbability: health.recoveryProbability,
      recommendedAction: 'smart_retry_optimal_window',
      expectedActionSuccessRate: 0.72,
      expectedRecoveryValue: 705600, // ₹7,056
      expectedRecoveryValueRupees: 7056,
      computedAt: REF_TIME,
      ...overrides?.erv,
    };

    return { instrument, health, erv, ltvTier: instrument.ltv_tier };
  }

  describe('Heuristic Decision Logic & Action Proposals', () => {
    it('1. should propose NO_ACTION for 100% HEALTHY subscriptions with zero failures', () => {
      const ctx = createMockContext();
      const plan = formulateRecoveryPlan(ctx, { referenceTime: REF_TIME });

      expect(plan.proposedAction).toBe('NO_ACTION');
      expect(plan.confidence).toBe(0.99);
      expect(plan.reasoning).toContain('HEALTHY operational status');
    });

    it('2. should propose NO_ACTION for low LTV tier with terminal decline and low ERV (< ₹500)', () => {
      const ctx = createMockContext({
        ltvTier: 'low',
        instrument: { ltv_tier: 'low', annualized_value: 598800 }, // ₹499/mo
        health: {
          healthScore: 0.15,
          trajectory: 'TERMINAL',
          rootCause: 'MANDATE_INACTIVE',
          recoveryProbability: 0.1,
        },
        erv: {
          amountAtRisk: 49900,
          expectedRecoveryValue: 1497,
          expectedRecoveryValueRupees: 15,
        },
      });

      const plan = formulateRecoveryPlan(ctx, { referenceTime: REF_TIME });

      expect(plan.proposedAction).toBe('NO_ACTION');
      expect(plan.reasoning).toContain('below cost-effective intervention threshold');
      expect(plan.parameters.reason).toBe('cost_exceeds_expected_value');
    });

    it('3. should propose proactive_nudge for cards near expiry (0-20 days)', () => {
      const ctx = createMockContext({
        ltvTier: 'critical',
        instrument: { rail: 'card' },
        health: {
          healthScore: 0.75,
          trajectory: 'HEALTHY',
          rootCause: 'CARD_EXPIRY_RISK',
          recoveryProbability: 0.75,
          featureVector: {
            failure_count_last_3_cycles: 0,
            success_count_total: 5,
            consecutive_failures: 0,
            days_to_expiry: 14,
            days_to_expiry_normalized: 0.16,
            is_near_card_expiry: true,
            decline_code_distribution: {},
            is_over_afa_threshold: false,
            mandate_status: 'active',
            last_event_type: 'subscription.charged',
            issuer_prior: 0.85,
          },
        },
      });

      const plan = formulateRecoveryPlan(ctx, { referenceTime: REF_TIME });

      expect(plan.proposedAction).toBe('proactive_nudge');
      expect(plan.parameters.template).toBe('card_expiry_update_request');
      expect(plan.parameters.channel).toBe('whatsapp_and_email');
      expect(plan.reasoning).toContain('14 days from expiry');
    });

    it('4. should propose schedule_retry on initial soft decline with next-day optimal window backoff', () => {
      const ctx = createMockContext({
        health: {
          healthScore: 0.65,
          trajectory: 'DEGRADING',
          rootCause: 'REPEATED_SOFT_DECLINE',
          recoveryProbability: 0.58,
          featureVector: {
            failure_count_last_3_cycles: 1,
            success_count_total: 4,
            consecutive_failures: 1,
            days_to_expiry: null,
            days_to_expiry_normalized: null,
            is_near_card_expiry: false,
            decline_code_distribution: { INSUFFICIENT_FUNDS: 1 },
            is_over_afa_threshold: false,
            mandate_status: 'active',
            last_event_type: 'subscription.pending',
            issuer_prior: 0.85,
          },
        },
      });

      const plan = formulateRecoveryPlan(ctx, { referenceTime: REF_TIME });

      expect(plan.proposedAction).toBe('schedule_retry');
      expect(plan.parameters.retryBackoffHours).toBe(24);
      expect(plan.reasoning).toContain('Initial soft decline recorded');
    });

    it('5. should propose grace_period for high-value accounts with 2 soft declines', () => {
      const ctx = createMockContext({
        ltvTier: 'high',
        health: {
          healthScore: 0.45,
          trajectory: 'DEGRADING',
          rootCause: 'REPEATED_SOFT_DECLINE',
          recoveryProbability: 0.4,
          featureVector: {
            failure_count_last_3_cycles: 2,
            success_count_total: 5,
            consecutive_failures: 2,
            days_to_expiry: null,
            days_to_expiry_normalized: null,
            is_near_card_expiry: false,
            decline_code_distribution: { INSUFFICIENT_FUNDS: 2 },
            is_over_afa_threshold: false,
            mandate_status: 'active',
            last_event_type: 'subscription.pending',
            issuer_prior: 0.85,
          },
        },
      });

      const plan = formulateRecoveryPlan(ctx, { referenceTime: REF_TIME });

      expect(plan.proposedAction).toBe('grace_period');
      expect(plan.parameters.gracePeriodDays).toBe(3);
      expect(plan.reasoning).toContain('Granting 3-day grace period');
    });

    it('6. should propose escalate for critical LTV hard decline', () => {
      const ctx = createMockContext({
        ltvTier: 'critical',
        health: {
          healthScore: 0.0,
          trajectory: 'TERMINAL',
          rootCause: 'HARD_DECLINE_PATTERN',
          recoveryProbability: 0.2,
          featureVector: {
            failure_count_last_3_cycles: 1,
            success_count_total: 2,
            consecutive_failures: 1,
            days_to_expiry: null,
            days_to_expiry_normalized: null,
            is_near_card_expiry: false,
            decline_code_distribution: { USER_CANCELLED_MANDATE: 1 },
            is_over_afa_threshold: false,
            mandate_status: 'active',
            last_event_type: 'subscription.halted',
            issuer_prior: 0.85,
          },
        },
      });

      const plan = formulateRecoveryPlan(ctx, { referenceTime: REF_TIME });

      expect(plan.proposedAction).toBe('escalate');
      expect(plan.parameters.escalationTier).toBe('high_priority');
      expect(plan.reasoning).toContain('Hard decline encountered on critical tier');
    });

    it('7. should propose proactive_nudge for UPI AFA limit breaches on high LTV subscriptions', () => {
      const ctx = createMockContext({
        ltvTier: 'high',
        instrument: { rail: 'upi_autopay' },
        health: {
          healthScore: 0.7,
          trajectory: 'HEALTHY',
          rootCause: 'AFA_PENDING',
          recoveryProbability: 0.7,
          featureVector: {
            failure_count_last_3_cycles: 1,
            success_count_total: 3,
            consecutive_failures: 1,
            days_to_expiry: null,
            days_to_expiry_normalized: null,
            is_near_card_expiry: false,
            decline_code_distribution: { MANDATE_LIMIT_EXCEEDED: 1 },
            is_over_afa_threshold: true,
            mandate_status: 'active',
            last_event_type: 'subscription.pending',
            issuer_prior: 0.88,
          },
        },
      });

      const plan = formulateRecoveryPlan(ctx, { referenceTime: REF_TIME });

      expect(plan.proposedAction).toBe('proactive_nudge');
      expect(plan.parameters.template).toBe('upi_mandate_limit_upgrade');
    });
  });

  describe('Planner Service & EventStore Audit Integration', () => {
    let pool: TestPool;
    let cleanup: () => Promise<void>;
    let eventStore: EventStore;
    let service: RecoveryPlannerService;

    beforeEach(async () => {
      const testDb = await createTestDatabase();
      pool = testDb.pool;
      cleanup = testDb.cleanup;
      eventStore = new EventStore(pool);
      service = new RecoveryPlannerService(eventStore, pool);
    });

    afterEach(async () => {
      await cleanup();
    });

    it('8. should formulate plan, return proposed action, and append proposed_action event to EventStore', async () => {
      // Seed test instrument & subscription
      await pool.query(
        `INSERT INTO subscriptions (subscription_id, customer_id, plan_id, status)
         VALUES ('sub_plan_1', 'cust_1', 'plan_pro', 'pending');`,
      );

      await pool.query(
        `INSERT INTO instruments (instrument_id, subscription_id, rail, mandate_status, ltv_tier, annualized_value)
         VALUES ('inst_plan_1', 'sub_plan_1', 'card', 'active', 'high', 12000000);`,
      );

      // Append historical charge & failure
      await eventStore.appendEvent({
        subscriptionId: 'sub_plan_1',
        instrumentId: 'inst_plan_1',
        eventType: 'subscription.charged',
        actor: 'razorpay_webhook',
        payload: { amount: 1000000 },
      });

      await eventStore.appendEvent({
        subscriptionId: 'sub_plan_1',
        instrumentId: 'inst_plan_1',
        eventType: 'subscription.pending',
        actor: 'razorpay_webhook',
        payload: {
          payload: {
            payment: {
              entity: {
                error_code: 'INSUFFICIENT_FUNDS',
              },
            },
          },
        },
      });

      const result = await service.planAndLog('inst_plan_1');

      expect(result.proposal.proposalId).toMatch(/^prop_/);
      expect(result.proposal.proposedAction).toBe('schedule_retry');
      expect(result.proposal.reasoning).toBeTruthy();

      // Verify event logged to EventStore with actor = 'recovery_planner'
      const events = await eventStore.getEventsForInstrument('inst_plan_1');
      const planEvent = events.find((e) => e.eventType === 'proposed_action');
      expect(planEvent).toBeDefined();
      expect(planEvent?.actor).toBe('recovery_planner');

      // Verify chain integrity
      const integrity = await eventStore.verifyChainIntegrity();
      expect(integrity.valid).toBe(true);
    });
  });
});
