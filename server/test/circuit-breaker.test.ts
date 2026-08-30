import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { PolicyDecisionRecord } from '@recovery/shared';
import { CohortCircuitBreaker } from '../src/circuit-breaker/circuit-breaker.js';
import { CircuitBreakerGuard } from '../src/circuit-breaker/circuit-breaker-guard.js';
import { EventStore } from '../src/event-store/event-store.js';
import { buildApp } from '../src/index.js';
import { createTestDatabase, type TestPool } from './test-db.js';

describe('Cohort-Level Rolling-Window Circuit Breaker Tests', () => {
  let pool: TestPool;
  let cleanup: () => Promise<void>;
  let eventStore: EventStore;
  let circuitBreaker: CohortCircuitBreaker;
  let guard: CircuitBreakerGuard;

  beforeEach(async () => {
    const testDb = await createTestDatabase();
    pool = testDb.pool;
    cleanup = testDb.cleanup;
    eventStore = new EventStore(pool);
    circuitBreaker = new CohortCircuitBreaker(eventStore, {
      windowSize: 20,
      minSamples: 10,
      minSuccessRateThreshold: 0.4, // 40%
      cooldownPeriodSeconds: 60, // 60s for testing
    });
    guard = new CircuitBreakerGuard(circuitBreaker, eventStore);
  });

  afterEach(async () => {
    await cleanup();
  });

  function createMockDecision(overrides?: Partial<PolicyDecisionRecord>): PolicyDecisionRecord {
    return {
      decisionId: 'dec_test_1',
      instrumentId: 'inst_upi_1',
      subscriptionId: 'sub_upi_1',
      result: 'ALLOW',
      proposedAction: 'schedule_retry',
      finalAction: 'schedule_retry',
      ruleIdMatched: 'PASS-THROUGH-PERMIT-001',
      reason: 'Permitted',
      evaluatedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  describe('Rolling Window & Collapse Simulation (Single Trip Invariant)', () => {
    it('1. should record outcomes and remain CLOSED while success rate is above threshold', async () => {
      const cohort = 'rail:upi_autopay';

      // 8 successes, 2 failures = 80% success rate (> 40%)
      for (let i = 0; i < 8; i++) {
        await circuitBreaker.recordOutcome(cohort, true);
      }
      for (let i = 0; i < 2; i++) {
        await circuitBreaker.recordOutcome(cohort, false);
      }

      const status = circuitBreaker.getStatus(cohort);
      expect(status.state).toBe('CLOSED');
      expect(status.totalAttemptsInWindow).toBe(10);
      expect(status.currentSuccessRate).toBe(0.8);
      expect(status.failedAttemptsInWindow).toBe(2);
    });

    it('2. should trip breaker EXACTLY ONCE when success rate drops from 75% to 15%', async () => {
      const cohort = 'rail:upi_autopay';

      // Phase A: Seed 6 successes and 2 failures (6/8 = 75%)
      for (let i = 0; i < 6; i++) {
        await circuitBreaker.recordOutcome(cohort, true);
      }
      for (let i = 0; i < 2; i++) {
        await circuitBreaker.recordOutcome(cohort, false);
      }
      expect(circuitBreaker.getStatus(cohort).state).toBe('CLOSED');

      // Phase B: Simulate bank outage with 5 consecutive failures (now 6/13 -> 46% -> 6/14 -> 42% -> 6/15 -> 40% -> 6/16 -> 37.5% TRIPPED!)
      let tripCountObserved = 0;
      for (let i = 0; i < 8; i++) {
        const res = await circuitBreaker.recordOutcome(cohort, false);
        if (res.trippedNow) {
          tripCountObserved++;
        }
      }

      // Assert breaker is OPEN and tripped exactly once
      const status = circuitBreaker.getStatus(cohort);
      expect(status.state).toBe('OPEN');
      expect(tripCountObserved).toBe(1); // Single trip event invariant
      expect(status.openReason).toContain('fell below 40% threshold');

      // Check EventStore audit log for circuit_breaker_tripped event
      const events = await eventStore.getAllEvents();
      const tripEvents = events.filter((e) => e.eventType === 'circuit_breaker_tripped');
      expect(tripEvents).toHaveLength(1);
      expect(tripEvents[0].actor).toBe('circuit_breaker');
      expect(tripEvents[0].payload.cohortKey).toBe(cohort);

      // Verify complete ledger integrity
      const integrity = await eventStore.verifyChainIntegrity();
      expect(integrity.valid).toBe(true);
    });

    it('3. should NOT emit duplicate trip events for subsequent failed actions while breaker is already OPEN', async () => {
      const cohort = 'rail:card';

      // Force 10 failures to trip
      for (let i = 0; i < 10; i++) {
        await circuitBreaker.recordOutcome(cohort, false);
      }
      expect(circuitBreaker.getStatus(cohort).state).toBe('OPEN');

      // Record 5 more failures while already OPEN
      for (let i = 0; i < 5; i++) {
        const res = await circuitBreaker.recordOutcome(cohort, false);
        expect(res.state).toBe('OPEN');
        expect(res.trippedNow).toBe(false); // Must be false!
      }

      // Check that EventStore has only 1 trip event
      const events = await eventStore.getAllEvents();
      const tripEvents = events.filter((e) => e.eventType === 'circuit_breaker_tripped');
      expect(tripEvents).toHaveLength(1);
    });
  });

  describe('Pipeline Guard & Downstream Action Interception', () => {
    it('4. should allow actions when cohort circuit breaker is CLOSED', async () => {
      const decision = createMockDecision({ result: 'ALLOW' });
      const guardResult = await guard.evaluateDecision(decision, 'rail:card');

      expect(guardResult.allowed).toBe(true);
      expect(guardResult.decision.result).toBe('ALLOW');
      expect(guardResult.decision.finalAction).toBe('schedule_retry');
    });

    it('5. should intercept and convert actions to BLOCK/escalate when breaker is OPEN', async () => {
      const cohort = 'rail:upi_autopay';

      // Trip the breaker with 10 failures
      for (let i = 0; i < 10; i++) {
        await circuitBreaker.recordOutcome(cohort, false);
      }
      expect(circuitBreaker.getStatus(cohort).state).toBe('OPEN');

      const decision = createMockDecision({
        result: 'ALLOW',
        finalAction: 'schedule_retry',
      });

      const guardResult = await guard.evaluateDecision(decision, cohort);

      expect(guardResult.allowed).toBe(false);
      expect(guardResult.decision.result).toBe('BLOCK');
      expect(guardResult.decision.finalAction).toBe('escalate');
      expect(guardResult.decision.ruleIdMatched).toBe('CIRCUIT-BREAKER-OPEN-001');
      expect(guardResult.decision.reason).toContain('Circuit breaker is OPEN');

      // Verify circuit_breaker_intercepted event logged to EventStore
      const events = await eventStore.getAllEvents();
      const interceptEvents = events.filter((e) => e.eventType === 'circuit_breaker_intercepted');
      expect(interceptEvents).toHaveLength(1);
      expect(interceptEvents[0].actor).toBe('circuit_breaker');
    });

    it('6. should maintain strict cross-cohort isolation (card unaffected when UPI is open)', async () => {
      const upiCohort = 'rail:upi_autopay';
      const cardCohort = 'rail:card';

      // Trip UPI AutoPay
      for (let i = 0; i < 10; i++) {
        await circuitBreaker.recordOutcome(upiCohort, false);
      }
      expect(circuitBreaker.getStatus(upiCohort).state).toBe('OPEN');
      expect(circuitBreaker.getStatus(cardCohort).state).toBe('CLOSED');

      // Card action must be allowed
      const cardDecision = createMockDecision({ result: 'ALLOW', finalAction: 'schedule_retry' });
      const cardGuardResult = await guard.evaluateDecision(cardDecision, cardCohort);
      expect(cardGuardResult.allowed).toBe(true);
      expect(cardGuardResult.decision.result).toBe('ALLOW');

      // UPI action must be intercepted
      const upiDecision = createMockDecision({ result: 'ALLOW', finalAction: 'schedule_retry' });
      const upiGuardResult = await guard.evaluateDecision(upiDecision, upiCohort);
      expect(upiGuardResult.allowed).toBe(false);
      expect(upiGuardResult.decision.result).toBe('BLOCK');
    });
  });

  describe('Cooldown, Half-Open Recovery & Human Manual Reset', () => {
    it('7. should transition to HALF_OPEN after cooldown expires and recover on success', async () => {
      const cohort = 'rail:enach:bank:HDFC';

      // Trip breaker at T0
      const t0 = new Date('2026-08-30T12:00:00.000Z');
      for (let i = 0; i < 10; i++) {
        await circuitBreaker.recordOutcome(cohort, false, { timestamp: t0.toISOString() });
      }
      expect(circuitBreaker.getStatus(cohort, t0).state).toBe('OPEN');

      // At T0 + 70s (cooldown is 60s) -> should be HALF_OPEN
      const t1 = new Date(t0.getTime() + 70 * 1000);
      expect(circuitBreaker.getStatus(cohort, t1).state).toBe('HALF_OPEN');

      // Record a successful trial action in HALF_OPEN -> should close breaker
      await circuitBreaker.recordOutcome(cohort, true, { timestamp: t1.toISOString() });
      expect(circuitBreaker.getStatus(cohort, t1).state).toBe('CLOSED');
    });

    it('8. should manually reset tripped breaker and log circuit_breaker_reset with actor = human', async () => {
      const cohort = 'rail:card';

      // Trip breaker
      for (let i = 0; i < 10; i++) {
        await circuitBreaker.recordOutcome(cohort, false);
      }
      expect(circuitBreaker.getStatus(cohort).state).toBe('OPEN');

      // Execute manual human reset
      const resetStatus = await circuitBreaker.manualReset(
        cohort,
        'lead_sre_operator',
        'Bank gateway maintenance window completed',
      );

      expect(resetStatus.state).toBe('CLOSED');
      expect(resetStatus.failedAttemptsInWindow).toBe(0);

      // Verify circuit_breaker_reset event in EventStore
      const events = await eventStore.getAllEvents();
      const resetEvent = events.find((e) => e.eventType === 'circuit_breaker_reset');
      expect(resetEvent).toBeDefined();
      expect(resetEvent?.actor).toBe('human');
      expect(resetEvent?.payload.resetBy).toBe('lead_sre_operator');
      expect(resetEvent?.payload.reason).toContain('Bank gateway maintenance');
    });
  });

  describe('REST API Endpoints Integration', () => {
    it('9. should handle GET /api/circuit-breaker/status and POST /api/circuit-breaker/reset', async () => {
      const app = await buildApp({
        circuitBreakerOptions: { circuitBreaker },
      });

      // Trip cohort
      for (let i = 0; i < 10; i++) {
        await circuitBreaker.recordOutcome('rail:upi_autopay', false);
      }

      // 1. GET status
      const getRes = await app.inject({
        method: 'GET',
        url: '/api/circuit-breaker/status',
      });
      expect(getRes.statusCode).toBe(200);
      const getBody = JSON.parse(getRes.body);
      expect(getBody.success).toBe(true);
      expect(getBody.cohorts).toHaveLength(1);
      expect(getBody.cohorts[0].state).toBe('OPEN');

      // 2. POST reset
      const resetRes = await app.inject({
        method: 'POST',
        url: '/api/circuit-breaker/reset',
        payload: {
          cohortKey: 'rail:upi_autopay',
          resetBy: 'ops_lead',
          reason: 'Verified UPI clearing switch restoration',
        },
      });

      expect(resetRes.statusCode).toBe(200);
      const resetBody = JSON.parse(resetRes.body);
      expect(resetBody.success).toBe(true);
      expect(resetBody.status.state).toBe('CLOSED');

      await app.close();
    });
  });
});
