import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DbInstrument, HealthEvaluationResult, ProposedActionRecord, ExecutionActionResult } from '@recovery/shared';
import { CounterfactualEngine } from '../src/attribution/counterfactual-engine.js';
import { AttributionService } from '../src/attribution/attribution-service.js';
import { EventStore } from '../src/event-store/event-store.js';
import { buildApp } from '../src/index.js';
import { createTestDatabase, type TestPool } from './test-db.js';

describe('Outcome Attribution & Counterfactual Financial Engine Tests', () => {
  let pool: TestPool;
  let cleanup: () => Promise<void>;
  let eventStore: EventStore;
  let attributionService: AttributionService;
  let counterfactualEngine: CounterfactualEngine;

  beforeEach(async () => {
    const testDb = await createTestDatabase();
    pool = testDb.pool;
    cleanup = testDb.cleanup;
    eventStore = new EventStore(pool);
    counterfactualEngine = new CounterfactualEngine();
    attributionService = new AttributionService(pool, eventStore, counterfactualEngine);
  });

  afterEach(async () => {
    await cleanup();
  });

  function createMockInstrument(overrides?: Partial<DbInstrument>): DbInstrument {
    return {
      instrument_id: 'inst_attr_001',
      subscription_id: 'sub_attr_001',
      rail: 'card',
      created_at: '2026-01-01T00:00:00.000Z',
      expiry_date: '2026-09-05T00:00:00.000Z',
      mandate_status: 'active',
      last_synced_at: '2026-08-30T00:00:00.000Z',
      ltv_tier: 'high',
      annualized_value: 12000000, // Rs 1,20,000 ARR -> Rs 10,000 / 1000000 paise MRR
      ...overrides,
    };
  }

  function createMockHealth(overrides?: Partial<HealthEvaluationResult>): HealthEvaluationResult {
    const baseFeatureVector = {
      failure_count_last_3_cycles: 0,
      success_count_total: 12,
      days_to_expiry_normalized: 0.1,
      consecutive_soft_declines: 0,
      consecutive_hard_declines: 0,
      has_afa_pending: false,
      mandate_active: true,
      issuer_success_rate_prior: 0.9,
    };

    return {
      instrumentId: 'inst_attr_001',
      subscriptionId: 'sub_attr_001',
      healthScore: 0.55,
      trajectory: 'DEGRADING',
      rootCause: 'CARD_EXPIRY_RISK',
      recoveryProbability: 0.85,
      featureVector: {
        ...baseFeatureVector,
        ...(overrides?.featureVector || {}),
      },
      computedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  describe('Counterfactual Engine Classification & Heuristic Uplift', () => {
    it('1. should evaluate PROACTIVE intervention (card expiry nudge) with 15% organic baseline discount', () => {
      const instrument = createMockInstrument({ rail: 'card' });
      const health = createMockHealth({
        trajectory: 'DEGRADING',
        rootCause: 'CARD_EXPIRY_RISK',
        featureVector: {
          failure_count_last_3_cycles: 0,
          success_count_total: 12,
          days_to_expiry_normalized: 0.1,
          consecutive_soft_declines: 0,
          consecutive_hard_declines: 0,
          has_afa_pending: false,
          mandate_active: true,
          issuer_success_rate_prior: 0.9,
        },
      });
      const plan: ProposedActionRecord = {
        instrumentId: instrument.instrument_id,
        subscriptionId: instrument.subscription_id,
        proposedAction: 'proactive_nudge',
        rootCause: 'CARD_EXPIRY_RISK',
        expectedRecoveryValue: 850000,
        confidence: 0.9,
        reasoning: 'Proactive card expiry notice',
        parameters: {},
        plannedAt: new Date().toISOString(),
      };
      const execution: ExecutionActionResult = {
        actionId: 'act_001',
        instrumentId: instrument.instrument_id,
        subscriptionId: instrument.subscription_id,
        action: 'proactive_nudge',
        status: 'nudged',
        idempotencyKey: 'idem_nudge_001',
        executedAt: new Date().toISOString(),
        details: {},
      };

      const result = counterfactualEngine.evaluate({
        instrument,
        healthSnapshot: health,
        proposedPlan: plan,
        execution,
      });

      expect(result.recoveryType).toBe('proactive');
      expect(result.atRiskAmountPaise).toBe(1000000); // Rs 10,000 monthly
      expect(result.recoveredAmountPaise).toBe(1000000);
      expect(result.estimatedBaselineOutcome).toBe('card_expiry_exhaustion_churn');
      expect(result.baselineRecoveredEstimatePaise).toBe(150000); // 15% organic baseline
      expect(result.revenueSavedPaise).toBe(850000); // 85% prevented loss uplift
    });

    it('2. should evaluate REACTIVE recovery (smart retry after failure) with 30% naive baseline discount', () => {
      const instrument = createMockInstrument({ rail: 'upi_autopay' });
      const health = createMockHealth({
        trajectory: 'DEGRADING',
        rootCause: 'REPEATED_SOFT_DECLINE',
        featureVector: {
          failure_count_last_3_cycles: 2,
          success_count_total: 10,
          days_to_expiry_normalized: 1.0,
          consecutive_soft_declines: 2,
          consecutive_hard_declines: 0,
          has_afa_pending: false,
          mandate_active: true,
          issuer_success_rate_prior: 0.9,
        },
      });
      const plan: ProposedActionRecord = {
        instrumentId: instrument.instrument_id,
        subscriptionId: instrument.subscription_id,
        proposedAction: 'schedule_retry',
        rootCause: 'REPEATED_SOFT_DECLINE',
        expectedRecoveryValue: 700000,
        confidence: 0.8,
        reasoning: 'Scheduled retry after soft decline',
        parameters: {},
        plannedAt: new Date().toISOString(),
      };
      const execution: ExecutionActionResult = {
        actionId: 'act_002',
        instrumentId: instrument.instrument_id,
        subscriptionId: instrument.subscription_id,
        action: 'schedule_retry',
        status: 'scheduled',
        idempotencyKey: 'idem_retry_002',
        executedAt: new Date().toISOString(),
        details: {},
      };

      const result = counterfactualEngine.evaluate({
        instrument,
        healthSnapshot: health,
        proposedPlan: plan,
        execution,
      });

      expect(result.recoveryType).toBe('reactive');
      expect(result.atRiskAmountPaise).toBe(1000000);
      expect(result.recoveredAmountPaise).toBe(1000000);
      expect(result.estimatedBaselineOutcome).toBe('naive_immediate_retry_exhaustion');
      expect(result.baselineRecoveredEstimatePaise).toBe(300000); // 30% naive retry rate
      expect(result.revenueSavedPaise).toBe(700000); // 70% net attributed uplift
    });

    it('3. should evaluate NO_ACTION on healthy instruments as untouched with zero revenue saved', () => {
      const instrument = createMockInstrument();
      const health = createMockHealth({
        trajectory: 'HEALTHY',
        rootCause: 'NONE',
        featureVector: {
          failure_count_last_3_cycles: 0,
          success_count_total: 12,
          days_to_expiry_normalized: 1.0,
          consecutive_soft_declines: 0,
          consecutive_hard_declines: 0,
          has_afa_pending: false,
          mandate_active: true,
          issuer_success_rate_prior: 0.95,
        },
      });
      const plan: ProposedActionRecord = {
        instrumentId: instrument.instrument_id,
        subscriptionId: instrument.subscription_id,
        proposedAction: 'NO_ACTION',
        rootCause: 'NONE',
        expectedRecoveryValue: 0,
        confidence: 0.95,
        reasoning: 'Healthy instrument',
        parameters: {},
        plannedAt: new Date().toISOString(),
      };
      const execution: ExecutionActionResult = {
        actionId: 'act_003',
        instrumentId: instrument.instrument_id,
        subscriptionId: instrument.subscription_id,
        action: 'NO_ACTION',
        status: 'no_op',
        idempotencyKey: 'idem_noop_003',
        executedAt: new Date().toISOString(),
        details: {},
      };

      const result = counterfactualEngine.evaluate({
        instrument,
        healthSnapshot: health,
        proposedPlan: plan,
        execution,
      });

      expect(result.recoveryType).toBe('none');
      expect(result.atRiskAmountPaise).toBe(0);
      expect(result.recoveredAmountPaise).toBe(0);
      expect(result.revenueSavedPaise).toBe(0);
      expect(result.estimatedBaselineOutcome).toBe('healthy_baseline_continuation');
    });
  });

  describe('Attribution Service & Scorecard Rollup Aggregations', () => {
    it('4. should persist outcome record and append recovery_recorded event to EventStore', async () => {
      const outcome = await attributionService.recordOutcome({
        subscriptionId: 'sub_test_001',
        instrumentId: 'inst_test_001',
        atRiskAmount: 1000000,
        recoveredAmount: 1000000,
        costIncurred: 25,
        recoveryType: 'proactive',
        status: 'recovered',
        estimatedBaselineOutcome: 'card_expiry_exhaustion_churn',
        baselineRecoveredEstimate: 150000,
        revenueSaved: 850000,
      });

      expect(outcome.outcome_id).toContain('out_');
      expect(outcome.recovery_type).toBe('proactive');
      expect(Number(outcome.net_value_recovered)).toBe(1000000 - 25);

      // Verify EventStore audit ledger entry
      const events = await eventStore.getAllEvents();
      const recEvent = events.find((e) => e.eventType === 'recovery_recorded');
      expect(recEvent).toBeDefined();
      expect(recEvent?.actor).toBe('execution_engine');
      expect(recEvent?.payload.recoveryType).toBe('proactive');
    });

    it('5. should compute financial scorecard rollups across monitored subscriptions', async () => {
      // Seed 2 instruments in test DB
      await pool.query(`
        INSERT INTO subscriptions (subscription_id, customer_id, plan_id, status)
        VALUES ('sub_sc_01', 'cust_01', 'plan_01', 'active'), ('sub_sc_02', 'cust_02', 'plan_02', 'active');
      `);
      await pool.query(`
        INSERT INTO instruments (instrument_id, subscription_id, rail, mandate_status, annualized_value)
        VALUES ('inst_sc_01', 'sub_sc_01', 'card', 'active', 12000000),
               ('inst_sc_02', 'sub_sc_02', 'upi_autopay', 'active', 24000000);
      `);

      // Record 1 proactive recovery and 1 reactive recovery
      await attributionService.recordOutcome({
        subscriptionId: 'sub_sc_01',
        instrumentId: 'inst_sc_01',
        atRiskAmount: 1000000,
        recoveredAmount: 1000000,
        costIncurred: 25,
        recoveryType: 'proactive',
        status: 'recovered',
        estimatedBaselineOutcome: 'card_expiry_exhaustion_churn',
        baselineRecoveredEstimate: 150000,
        revenueSaved: 850000,
      });

      await attributionService.recordOutcome({
        subscriptionId: 'sub_sc_02',
        instrumentId: 'inst_sc_02',
        atRiskAmount: 2000000,
        recoveredAmount: 2000000,
        costIncurred: 50,
        recoveryType: 'reactive',
        status: 'recovered',
        estimatedBaselineOutcome: 'naive_immediate_retry_exhaustion',
        baselineRecoveredEstimate: 600000,
        revenueSaved: 1400000,
      });

      const scorecard = await attributionService.getScorecard();

      expect(scorecard.totalSubscriptionsCount).toBe(2);
      expect(scorecard.totalMonitoredMRRPaise).toBe(3000000); // Rs 10,000 + Rs 20,000
      expect(scorecard.totalMonitoredARRPaise).toBe(36000000); // Rs 1.2L + Rs 2.4L
      expect(scorecard.totalRecoveredMRRPaise).toBe(3000000);
      expect(scorecard.proactiveRecoveredMRRPaise).toBe(1000000);
      expect(scorecard.reactiveRecoveredMRRPaise).toBe(2000000);
      expect(scorecard.revenuePreventedMRRPaise).toBe(850000 + 1400000);
      expect(scorecard.recoveryRatePercent).toBe(100);
    });

    it('6. should handle REST API endpoints GET /api/attribution/scorecard and GET /api/attribution/outcomes', async () => {
      const app = await buildApp({
        attributionOptions: { attributionService },
      });

      // Query scorecard endpoint
      const scorecardRes = await app.inject({
        method: 'GET',
        url: '/api/attribution/scorecard',
      });
      expect(scorecardRes.statusCode).toBe(200);
      const scorecardBody = JSON.parse(scorecardRes.body);
      expect(scorecardBody.success).toBe(true);
      expect(scorecardBody.data.totalMonitoredMRRPaise).toBeDefined();

      // Query outcomes endpoint
      const outcomesRes = await app.inject({
        method: 'GET',
        url: '/api/attribution/outcomes',
      });
      expect(outcomesRes.statusCode).toBe(200);
      const outcomesBody = JSON.parse(outcomesRes.body);
      expect(outcomesBody.success).toBe(true);
      expect(Array.isArray(outcomesBody.data)).toBe(true);

      await app.close();
    });
  });
});
