import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { PolicyContext } from '../src/policy/types.js';
import { decide, DEFAULT_POLICY_CONFIG } from '../src/policy/engine.js';
import { PolicyService } from '../src/policy/policy-service.js';
import { EventStore } from '../src/event-store/event-store.js';
import { createTestDatabase, type TestPool } from './test-db.js';

describe('Deterministic Policy Engine ("PERMIT") Unit Tests', () => {
  const REF_TIME = '2026-08-30T12:00:00.000Z';

  function createMockPolicyContext(overrides?: Partial<PolicyContext>): PolicyContext {
    return {
      instrumentId: 'inst_test_1',
      subscriptionId: 'sub_test_1',
      rail: 'card',
      trajectory: 'DEGRADING',
      attemptCount: 1,
      proposedAction: 'schedule_retry',
      rootCause: 'REPEATED_SOFT_DECLINE',
      expectedRecoveryValue: 500000, // ₹5,000
      ltvTier: 'high',
      customerContactCountThisCycle: 0,
      isCustomerOptOut: false,
      amountPaise: 500000,
      evaluatedAt: REF_TIME,
      ...overrides,
    };
  }

  describe('Rail Attempt Caps & Absolute Hard Boundaries', () => {
    it('1. should allow schedule_retry on card when attemptCount is below cap (1/4)', () => {
      const ctx = createMockPolicyContext({ rail: 'card', attemptCount: 1 });
      const res = decide(ctx);

      expect(res.result).toBe('ALLOW');
      expect(res.finalAction).toBe('schedule_retry');
      expect(res.ruleIdMatched).toBe('PASS-THROUGH-PERMIT-001');
    });

    it('2. should modify retry to grace_period on card when attemptCount is at exact cap (4/4)', () => {
      const ctx = createMockPolicyContext({ rail: 'card', attemptCount: 4, proposedAction: 'schedule_retry' });
      const res = decide(ctx);

      expect(res.result).toBe('MODIFY');
      expect(res.finalAction).toBe('grace_period');
      expect(res.ruleIdMatched).toBe('CARD-MAX-ATTEMPTS-001');
      expect(res.reason).toContain('Absolute rail attempt limit reached (4/4 on CARD)');
    });

    it('3. should modify retry to grace_period on card when attemptCount exceeds cap (5/4)', () => {
      const ctx = createMockPolicyContext({ rail: 'card', attemptCount: 5, proposedAction: 'retry' });
      const res = decide(ctx);

      expect(res.result).toBe('MODIFY');
      expect(res.finalAction).toBe('grace_period');
      expect(res.ruleIdMatched).toBe('CARD-MAX-ATTEMPTS-001');
    });

    it('4. should modify retry to grace_period on UPI AutoPay when attemptCount is at exact NPCI cap (4/4)', () => {
      const ctx = createMockPolicyContext({ rail: 'upi_autopay', attemptCount: 4, proposedAction: 'schedule_retry' });
      const res = decide(ctx);

      expect(res.result).toBe('MODIFY');
      expect(res.finalAction).toBe('grace_period');
      expect(res.ruleIdMatched).toBe('UPI-NPCI-RETRY-CAP-001');
      expect(res.reason).toContain('4/4 on UPI_AUTOPAY');
    });

    it('5. should allow schedule_retry on UPI AutoPay when attemptCount is below NPCI cap (2/4)', () => {
      const ctx = createMockPolicyContext({ rail: 'upi_autopay', attemptCount: 2, proposedAction: 'schedule_retry' });
      const res = decide(ctx);

      expect(res.result).toBe('ALLOW');
      expect(res.finalAction).toBe('schedule_retry');
      expect(res.ruleIdMatched).toBe('PASS-THROUGH-PERMIT-001');
    });

    it('6. should modify retry to grace_period on E-NACH default bank when attemptCount is at cap (3/3)', () => {
      const ctx = createMockPolicyContext({ rail: 'enach', bankCode: 'HDFC', attemptCount: 3, proposedAction: 'schedule_retry' });
      const res = decide(ctx);

      expect(res.result).toBe('MODIFY');
      expect(res.finalAction).toBe('grace_period');
      expect(res.ruleIdMatched).toBe('ENACH-BANK-RETRY-CAP-001');
    });

    it('7. should enforce bank-specific lower cap for SBI (SBIN cap = 2) on E-NACH at attemptCount 2', () => {
      const ctx = createMockPolicyContext({ rail: 'enach', bankCode: 'SBIN', attemptCount: 2, proposedAction: 'schedule_retry' });
      const res = decide(ctx);

      expect(res.result).toBe('MODIFY');
      expect(res.finalAction).toBe('grace_period');
      expect(res.ruleIdMatched).toBe('ENACH-BANK-RETRY-CAP-001');
      expect(res.reason).toContain('2/2 on ENACH');
    });
  });

  describe('Customer Contact Cap & Proactive Nudge Guardrails', () => {
    it('8. should allow first proactive nudge when contact count is 0', () => {
      const ctx = createMockPolicyContext({
        proposedAction: 'proactive_nudge',
        customerContactCountThisCycle: 0,
      });
      const res = decide(ctx);

      expect(res.result).toBe('ALLOW');
      expect(res.finalAction).toBe('proactive_nudge');
      expect(res.ruleIdMatched).toBe('PASS-THROUGH-PERMIT-001');
    });

    it('9. should modify second proactive nudge to schedule_retry when contact count is 1 (cap reached)', () => {
      const ctx = createMockPolicyContext({
        proposedAction: 'proactive_nudge',
        customerContactCountThisCycle: 1,
      });
      const res = decide(ctx);

      expect(res.result).toBe('MODIFY');
      expect(res.finalAction).toBe('schedule_retry');
      expect(res.ruleIdMatched).toBe('GLOBAL-NUDGE-CAP-001');
      expect(res.reason).toContain('Customer contact limit reached (1/1 nudges this billing cycle)');
    });
  });

  describe('UPI AutoPay AFA Limit & Regulatory Thresholds', () => {
    it('10. should modify immediate retry to proactive_nudge when UPI amount exceeds ₹15,000 standard AFA limit', () => {
      const ctx = createMockPolicyContext({
        rail: 'upi_autopay',
        amountPaise: 2500000, // ₹25,000
        proposedAction: 'retry',
      });
      const res = decide(ctx);

      expect(res.result).toBe('MODIFY');
      expect(res.finalAction).toBe('proactive_nudge');
      expect(res.ruleIdMatched).toBe('UPI-AFA-THRESHOLD-001');
      expect(res.reason).toContain('exceeds RBI AFA limit of ₹15,000');
    });

    it('11. should allow retry for UPI transaction below ₹15,000 standard threshold', () => {
      const ctx = createMockPolicyContext({
        rail: 'upi_autopay',
        amountPaise: 99900, // ₹999
        proposedAction: 'schedule_retry',
      });
      const res = decide(ctx);

      expect(res.result).toBe('ALLOW');
      expect(res.finalAction).toBe('schedule_retry');
      expect(res.ruleIdMatched).toBe('PASS-THROUGH-PERMIT-001');
    });

    it('12. should allow retry for ₹50,000 transaction under category-specific MCC (6300 Insurance)', () => {
      const ctx = createMockPolicyContext({
        rail: 'upi_autopay',
        amountPaise: 5000000, // ₹50,000 (< ₹1,00,000)
        mccCode: '6300',
        proposedAction: 'schedule_retry',
      });
      const res = decide(ctx);

      expect(res.result).toBe('ALLOW');
      expect(res.ruleIdMatched).toBe('PASS-THROUGH-PERMIT-001');
    });

    it('13. should modify retry to proactive_nudge when Mutual Funds transaction (MCC 6211) exceeds ₹1,00,000', () => {
      const ctx = createMockPolicyContext({
        rail: 'upi_autopay',
        amountPaise: 15000000, // ₹1,50,000 (> ₹1,00,000)
        mccCode: '6211',
        proposedAction: 'retry',
      });
      const res = decide(ctx);

      expect(res.result).toBe('MODIFY');
      expect(res.finalAction).toBe('proactive_nudge');
      expect(res.ruleIdMatched).toBe('UPI-AFA-THRESHOLD-001');
      expect(res.reason).toContain('exceeds RBI AFA limit of ₹1,00,000');
    });
  });

  describe('Customer Opt-Out & Terminal Trajectory Handling', () => {
    it('14. should override proposed action to pause when customer has opted out', () => {
      const ctx = createMockPolicyContext({
        isCustomerOptOut: true,
        proposedAction: 'schedule_retry',
      });
      const res = decide(ctx);

      expect(res.result).toBe('MODIFY');
      expect(res.finalAction).toBe('pause');
      expect(res.ruleIdMatched).toBe('CUSTOMER-OPT-OUT-001');
      expect(res.reason).toContain('Customer has explicitly opted out');
    });

    it('15. should allow NO_ACTION pass-through without intervention', () => {
      const ctx = createMockPolicyContext({
        proposedAction: 'NO_ACTION',
      });
      const res = decide(ctx);

      expect(res.result).toBe('NO_ACTION');
      expect(res.finalAction).toBe('NO_ACTION');
      expect(res.ruleIdMatched).toBe('PASS-THROUGH-NO-ACTION-001');
    });

    it('16. should allow pause on terminal trajectory defaulting to bounded grace-period policy', () => {
      const ctx = createMockPolicyContext({
        trajectory: 'TERMINAL',
        proposedAction: 'pause',
        rootCause: 'HARD_DECLINE_PATTERN',
      });
      const res = decide(ctx);

      expect(res.result).toBe('ALLOW');
      expect(res.finalAction).toBe('pause');
      expect(res.ruleIdMatched).toBe('TERMINAL-GRACE-PAUSE-001');
    });

    it('17. should handle trajectory flipping mid-cycle from HEALTHY to TERMINAL', () => {
      const healthyCtx = createMockPolicyContext({ trajectory: 'HEALTHY', proposedAction: 'NO_ACTION' });
      const healthyRes = decide(healthyCtx);
      expect(healthyRes.result).toBe('NO_ACTION');

      const terminalCtx = createMockPolicyContext({ trajectory: 'TERMINAL', proposedAction: 'escalate' });
      const terminalRes = decide(terminalCtx);
      expect(terminalRes.result).toBe('ALLOW');
      expect(terminalRes.finalAction).toBe('escalate');
      expect(terminalRes.ruleIdMatched).toBe('TERMINAL-GRACE-PAUSE-001');
    });
  });

  describe('Zero-Bypass Guard & Persistence', () => {
    it('18. ZERO BYPASS: should strictly reject retry override attempt despite manufactured high confidence / VIP LTV', () => {
      // Simulating a malicious or misconfigured attempt trying to bypass max attempts
      const bypassAttemptCtx: PolicyContext = {
        rail: 'card',
        trajectory: 'DEGRADING',
        attemptCount: 4, // Max reached
        proposedAction: 'retry', // Trying to force retry
        rootCause: 'REPEATED_SOFT_DECLINE',
        expectedRecoveryValue: 100000000, // ₹10,00,000 ARR!
        ltvTier: 'critical',
        customerContactCountThisCycle: 0,
        reasoning: 'Manufactured 100% confidence recovery model recommendation',
      };

      const res = decide(bypassAttemptCtx);

      // The Policy Engine MUST NOT ALLOW the retry
      expect(res.result).toBe('MODIFY');
      expect(res.finalAction).toBe('grace_period');
      expect(res.ruleIdMatched).toBe('CARD-MAX-ATTEMPTS-001');
    });

    it('19. should persist policy decision into policy_decisions table and log policy_decision event to EventStore', async () => {
      const testDb = await createTestDatabase();
      const pool = testDb.pool;
      const eventStore = new EventStore(pool);
      const service = new PolicyService(eventStore, pool);

      try {
        await pool.query(
          `INSERT INTO subscriptions (subscription_id, customer_id, plan_id, status)
           VALUES ('sub_pol_1', 'cust_1', 'plan_ent', 'pending');`,
        );

        await pool.query(
          `INSERT INTO instruments (instrument_id, subscription_id, rail, mandate_status, ltv_tier, annualized_value)
           VALUES ('inst_pol_1', 'sub_pol_1', 'card', 'active', 'high', 12000000);`,
        );

        const ctx = createMockPolicyContext({
          instrumentId: 'inst_pol_1',
          subscriptionId: 'sub_pol_1',
          attemptCount: 1,
          proposedAction: 'schedule_retry',
        });

        const result = await service.evaluateAndLog(ctx);

        expect(result.decision.decisionId).toMatch(/^dec_/);
        expect(result.decision.result).toBe('ALLOW');
        expect(result.decision.finalAction).toBe('schedule_retry');
        expect(result.decision.ruleIdMatched).toBe('PASS-THROUGH-PERMIT-001');

        // Check policy_decisions table in DB
        const rows = await pool.query('SELECT * FROM policy_decisions WHERE decision_id = $1;', [
          result.decision.decisionId,
        ]);
        expect(rows.rows).toHaveLength(1);
        expect(rows.rows[0].decision).toBe('ALLOW');
        expect(rows.rows[0].target_action).toBe('schedule_retry');

        // Check EventStore audit trail
        const events = await eventStore.getEventsForInstrument('inst_pol_1');
        const policyEvent = events.find((e) => e.eventType === 'policy_decision');
        expect(policyEvent).toBeDefined();
        expect(policyEvent?.actor).toBe('policy_engine');

        // Verify chain integrity
        const integrity = await eventStore.verifyChainIntegrity();
        expect(integrity.valid).toBe(true);
      } finally {
        await testDb.cleanup();
      }
    });
  });
});
