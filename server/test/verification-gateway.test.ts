import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DbInstrument, PolicyDecisionRecord } from '@recovery/shared';
import { VerificationGateway } from '../src/verification/gateway.js';
import { VerificationService } from '../src/verification/verification-service.js';
import { RazorpayClient } from '../src/razorpay/client.js';
import { CohortCircuitBreaker } from '../src/circuit-breaker/circuit-breaker.js';
import { EventStore } from '../src/event-store/event-store.js';
import { buildApp } from '../src/index.js';
import { createTestDatabase, type TestPool } from './test-db.js';

describe('Safety & Verification Gateway ("2 AM" Pre-Action Guard) Tests', () => {
  let pool: TestPool;
  let cleanup: () => Promise<void>;
  let eventStore: EventStore;
  let razorpayClient: RazorpayClient;
  let circuitBreaker: CohortCircuitBreaker;
  let gateway: VerificationGateway;
  let service: VerificationService;

  beforeEach(async () => {
    const testDb = await createTestDatabase();
    pool = testDb.pool;
    cleanup = testDb.cleanup;
    eventStore = new EventStore(pool);
    razorpayClient = new RazorpayClient();
    circuitBreaker = new CohortCircuitBreaker(eventStore);
    gateway = new VerificationGateway(razorpayClient, circuitBreaker, {
      maxPolicyFreshnessAgeSeconds: 900,
    });
    service = new VerificationService(gateway, eventStore, pool);
    RazorpayClient.clearSimulatedLiveOverrides();
  });

  afterEach(async () => {
    RazorpayClient.clearSimulatedLiveOverrides();
    await cleanup();
  });

  function createMockInstrument(overrides?: Partial<DbInstrument>): DbInstrument {
    return {
      instrument_id: 'inst_verify_001',
      subscription_id: 'sub_verify_001',
      rail: 'card',
      created_at: '2026-01-01T00:00:00.000Z',
      expiry_date: '2027-01-01T00:00:00.000Z',
      mandate_status: 'active',
      last_synced_at: '2026-08-30T00:00:00.000Z',
      ltv_tier: 'high',
      annualized_value: 12000000,
      ...overrides,
    };
  }

  function createMockDecision(overrides?: Partial<PolicyDecisionRecord>): PolicyDecisionRecord {
    return {
      decisionId: 'dec_verify_001',
      instrumentId: 'inst_verify_001',
      subscriptionId: 'sub_verify_001',
      result: 'ALLOW',
      proposedAction: 'schedule_retry',
      finalAction: 'schedule_retry',
      ruleIdMatched: 'PASS-THROUGH-PERMIT-001',
      reason: 'Policy allowed',
      evaluatedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  describe('Pre-Action 4-Point Safety Checks', () => {
    it('1. HAPPY PATH: should return VERIFIED_SAFE when all 4 checks pass', async () => {
      const instrument = createMockInstrument();
      const decision = createMockDecision();

      // Mock live state active
      RazorpayClient.setSimulatedLiveOverride(instrument.instrument_id, {
        mandateStatus: 'active',
      });

      const result = await gateway.verify({
        instrument,
        decision,
        idempotencyKey: 'idem_unique_001',
      });

      expect(result.status).toBe('VERIFIED_SAFE');
      expect(result.blockedReason).toBeUndefined();
      expect(result.checks).toHaveLength(4);
      expect(result.checks.every((c) => c.passed)).toBe(true);
    });

    it('2. STALE STATE CHECK: should BLOCK and identify STALE_STATE_DISAGREEMENT when live state is revoked', async () => {
      const instrument = createMockInstrument({ mandate_status: 'active' });
      const decision = createMockDecision();

      // Live state is revoked (simulating silent bank revocation)
      RazorpayClient.setSimulatedLiveOverride(instrument.instrument_id, {
        mandateStatus: 'revoked',
      });

      const result = await gateway.verify({
        instrument,
        decision,
        idempotencyKey: 'idem_unique_002',
      });

      expect(result.status).toBe('BLOCKED');
      expect(result.blockedReason).toBe('STALE_STATE_DISAGREEMENT');
      expect(result.cachedMandateStatus).toBe('active');
      expect(result.liveMandateStatus).toBe('revoked');

      const liveCheck = result.checks.find((c) => c.check === 'LIVE_STATE_CHECK');
      expect(liveCheck?.passed).toBe(false);
      expect(liveCheck?.reason).toContain('Cached state (\'active\') disagrees with live gateway state (\'revoked\')');
    });

    it('3. STALE STATE CHECK: should BLOCK when live mandate state is paused', async () => {
      const instrument = createMockInstrument({ mandate_status: 'active' });
      const decision = createMockDecision();

      RazorpayClient.setSimulatedLiveOverride(instrument.instrument_id, {
        mandateStatus: 'paused',
      });

      const result = await gateway.verify({
        instrument,
        decision,
        idempotencyKey: 'idem_unique_003',
      });

      expect(result.status).toBe('BLOCKED');
      expect(result.blockedReason).toBe('STALE_STATE_DISAGREEMENT');
      expect(result.liveMandateStatus).toBe('paused');
    });

    it('4. IDEMPOTENCY CHECK: should BLOCK and identify IDEMPOTENCY_CONFLICT when key is already executed', async () => {
      const instrument = createMockInstrument();
      const decision = createMockDecision();
      const duplicateKey = 'idem_already_used_999';

      gateway.registerExecutedIdempotencyKey(duplicateKey);

      const result = await gateway.verify({
        instrument,
        decision,
        idempotencyKey: duplicateKey,
      });

      expect(result.status).toBe('BLOCKED');
      expect(result.blockedReason).toBe('IDEMPOTENCY_CONFLICT');

      const idemCheck = result.checks.find((c) => c.check === 'IDEMPOTENCY_CHECK');
      expect(idemCheck?.passed).toBe(false);
      expect(idemCheck?.reason).toContain('Duplicate execution prevented');
    });

    it('5. CIRCUIT BREAKER CHECK: should BLOCK and identify CIRCUIT_BREAKER_OPEN when cohort breaker is OPEN', async () => {
      const instrument = createMockInstrument({ rail: 'upi_autopay' });
      const decision = createMockDecision({ instrumentId: instrument.instrument_id });

      // Trip the UPI AutoPay breaker
      const cohort = 'rail:upi_autopay';
      for (let i = 0; i < 10; i++) {
        await circuitBreaker.recordOutcome(cohort, false);
      }
      expect(circuitBreaker.getStatus(cohort).state).toBe('OPEN');

      const result = await gateway.verify({
        instrument,
        decision,
        idempotencyKey: 'idem_unique_005',
        cohortKey: cohort,
      });

      expect(result.status).toBe('BLOCKED');
      expect(result.blockedReason).toBe('CIRCUIT_BREAKER_OPEN');

      const cbCheck = result.checks.find((c) => c.check === 'CIRCUIT_BREAKER_CHECK');
      expect(cbCheck?.passed).toBe(false);
      expect(cbCheck?.reason).toContain('is OPEN');
    });

    it('6. POLICY FRESHNESS CHECK: should BLOCK and identify POLICY_DECISION_STALE when decision age > 15 minutes', async () => {
      const instrument = createMockInstrument();
      const decision = createMockDecision({
        evaluatedAt: new Date(Date.now() - 1000 * 1000).toISOString(), // 1000s old (> 900s TTL)
      });

      const result = await gateway.verify({
        instrument,
        decision,
        idempotencyKey: 'idem_unique_006',
        policyDecisionCreatedAt: decision.evaluatedAt,
      });

      expect(result.status).toBe('BLOCKED');
      expect(result.blockedReason).toBe('POLICY_DECISION_STALE');

      const freshCheck = result.checks.find((c) => c.check === 'POLICY_FRESHNESS_CHECK');
      expect(freshCheck?.passed).toBe(false);
      expect(freshCheck?.reason).toContain('exceeds 900s TTL');
    });

    it('7. POLICY FRESHNESS CHECK: should pass when policy decision is fresh (100s <= 900s TTL)', async () => {
      const instrument = createMockInstrument();
      const decision = createMockDecision({
        evaluatedAt: new Date(Date.now() - 100 * 1000).toISOString(), // 100s old (fresh)
      });

      const result = await gateway.verify({
        instrument,
        decision,
        idempotencyKey: 'idem_unique_007',
        policyDecisionCreatedAt: decision.evaluatedAt,
      });

      expect(result.status).toBe('VERIFIED_SAFE');
      const freshCheck = result.checks.find((c) => c.check === 'POLICY_FRESHNESS_CHECK');
      expect(freshCheck?.passed).toBe(true);
    });
  });

  describe('Verification Service & EventStore Audit Trail', () => {
    it('8. SIGNATURE STALE CACHE SCENARIO: should detect stale state, abort action, log stale_state_detected and action_blocked events, and maintain ledger integrity', async () => {
      // 1. Seed instrument in database with cached mandate_status = 'active'
      await pool.query(
        `INSERT INTO subscriptions (subscription_id, customer_id, plan_id, status)
         VALUES ('sub_stale_1', 'cust_1', 'plan_pro', 'active');`,
      );

      await pool.query(
        `INSERT INTO instruments (instrument_id, subscription_id, rail, mandate_status, ltv_tier, annualized_value)
         VALUES ('inst_stale_1', 'sub_stale_1', 'card', 'active', 'high', 12000000);`,
      );

      // 2. Set live simulated mandate state to 'revoked' (bank silent revocation)
      RazorpayClient.setSimulatedLiveOverride('inst_stale_1', {
        mandateStatus: 'revoked',
      });

      const instrument = createMockInstrument({
        instrument_id: 'inst_stale_1',
        subscription_id: 'sub_stale_1',
        mandate_status: 'active',
      });

      const decision = createMockDecision({
        instrumentId: 'inst_stale_1',
        subscriptionId: 'sub_stale_1',
        proposedAction: 'schedule_retry',
        finalAction: 'schedule_retry',
      });

      // 3. Execute pre-action verification via service
      const res = await service.verifyAndLog({
        instrument,
        decision,
        idempotencyKey: 'idem_stale_test_001',
      });

      expect(res.isSafe).toBe(false);
      expect(res.verification.status).toBe('BLOCKED');
      expect(res.verification.blockedReason).toBe('STALE_STATE_DISAGREEMENT');

      // 4. Verify EventStore audit events
      const events = await eventStore.getAllEvents();

      // Check stale_state_detected event
      const staleEvent = events.find((e) => e.eventType === 'stale_state_detected');
      expect(staleEvent).toBeDefined();
      expect(staleEvent?.actor).toBe('verification_gateway');
      expect(staleEvent?.payload.cachedStatus).toBe('active');
      expect(staleEvent?.payload.liveStatus).toBe('revoked');
      expect(staleEvent?.payload.reason).toContain('Stale state divergence');

      // Check action_blocked event
      const blockedEvent = events.find((e) => e.eventType === 'action_blocked');
      expect(blockedEvent).toBeDefined();
      expect(blockedEvent?.actor).toBe('verification_gateway');
      expect(blockedEvent?.payload.blockedReason).toBe('STALE_STATE_DISAGREEMENT');

      // 5. Verify 100% hash chain integrity
      const integrity = await eventStore.verifyChainIntegrity();
      expect(integrity.valid).toBe(true);
      expect(integrity.verifiedCount).toBe(2);
    });
  });

  describe('Dev Test Hooks Endpoints', () => {
    it('9. should handle POST /api/dev/simulate-mandate-revocation and POST /api/dev/clear-overrides', async () => {
      const app = await buildApp();

      // 1. Set simulated revocation
      const simRes = await app.inject({
        method: 'POST',
        url: '/api/dev/simulate-mandate-revocation',
        payload: {
          instrumentId: 'inst_dev_demo_01',
          mandateStatus: 'revoked',
        },
      });

      expect(simRes.statusCode).toBe(200);
      const simBody = JSON.parse(simRes.body);
      expect(simBody.success).toBe(true);
      expect(simBody.simulatedState.mandateStatus).toBe('revoked');

      // Verify override is active in client
      expect(
        RazorpayClient.getSimulatedLiveOverride('inst_dev_demo_01')?.mandateStatus,
      ).toBe('revoked');

      // 2. Clear overrides
      const clearRes = await app.inject({
        method: 'POST',
        url: '/api/dev/clear-overrides',
      });
      expect(clearRes.statusCode).toBe(200);
      expect(RazorpayClient.getSimulatedLiveOverride('inst_dev_demo_01')).toBeUndefined();

      await app.close();
    });
  });
});
