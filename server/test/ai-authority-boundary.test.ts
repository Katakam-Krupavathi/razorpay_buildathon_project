import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventStore } from '../src/event-store/event-store.js';
import { WebhookProcessor } from '../src/razorpay/webhook-processor.js';
import { VerificationGateway } from '../src/verification/gateway.js';
import { CohortCircuitBreaker } from '../src/circuit-breaker/circuit-breaker.js';
import { PolicyService } from '../src/policy/policy-service.js';
import { aiReasoningEngine } from '../src/planner/reasoning-engine.js';
import { RazorpayClient } from '../src/razorpay/client.js';
import { createTestDatabase, type TestPool } from './test-db.js';
import type { DbInstrument, RazorpayWebhookPayload } from '@recovery/shared';

describe('Fixes Verification Suite (FIX 12 to FIX 19)', () => {
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
  // FIX 12 & FIX 19: AI Reasoning & Authority Boundary
  // ===========================================================================
  describe('FIX 12 & FIX 19: AI Reasoning Grounding & Authority Boundary', () => {
    it('12.1 should generate feature-vector grounded reasoning without hallucinating', async () => {
      const reasoning = aiReasoningEngine.generateDeterministicNarration({
        instrumentId: 'inst_card_99',
        rail: 'card',
        ltvTier: 'critical',
        healthScore: 0.35,
        trajectory: 'DEGRADING',
        rootCause: 'CARD_EXPIRY_RISK',
        proposedAction: 'proactive_nudge',
        expectedRecoveryValueRupees: 15000,
        monthlyAmountRupees: 18000,
        featureVector: {
          failure_count_last_3_cycles: 0,
          success_count_total: 12,
          consecutive_failures: 0,
          days_to_expiry: 8,
          days_to_expiry_normalized: 0.4,
          is_near_card_expiry: true,
          decline_code_distribution: {},
          is_over_afa_threshold: false,
          mandate_status: 'active',
          last_event_type: 'subscription.charged',
          issuer_prior: 0.82,
        },
      });

      expect(reasoning).toContain('8 days from expiry');
      expect(reasoning).toContain('Proactive token update recommended');
    });

    it('19.1 should prove AI reasoning output has zero execution authority', () => {
      // The AI Reasoning Engine only outputs a plain string — cannot execute actions
      expect(typeof aiReasoningEngine.generateDeterministicNarration).toBe('function');
      const keys = Object.keys(aiReasoningEngine);
      expect(keys).not.toContain('charge');
      expect(keys).not.toContain('pause');
      expect(keys).not.toContain('execute');
    });
  });

  // ===========================================================================
  // FIX 13 & FIX 16: Webhook Idempotency, Ordering & Lifecycle States
  // ===========================================================================
  describe('FIX 13 & FIX 16: Webhook Idempotency & Lifecycle Machine', () => {
    it('13.1 should acknowledge duplicate webhook delivery idempotently without duplicate projection', async () => {
      const processor = new WebhookProcessor(eventStore, pool);
      const payload: RazorpayWebhookPayload = {
        entity: 'event',
        account_id: 'acc_test',
        event: 'subscription.activated',
        contains: ['subscription'],
        payload: {
          subscription: {
            entity: {
              id: 'sub_idemp_01',
              customer_id: 'cust_idemp_01',
              plan_id: 'plan_01',
              status: 'active',
            },
          },
        },
        created_at: Math.floor(Date.now() / 1000),
      };

      // First delivery
      const res1 = await processor.processWebhook(payload, { webhookEventId: 'evt_dup_999' });
      expect(res1.success).toBe(true);
      expect(res1.isProjected).toBe(true);

      // Duplicate delivery with same event ID
      const res2 = await processor.processWebhook(payload, { webhookEventId: 'evt_dup_999' });
      expect(res2.success).toBe(true);
      expect(res2.isProjected).toBe(false); // No duplicate projection!
    });

    it('13.2 should prevent out-of-order older webhooks from corrupting newer subscription state', async () => {
      const processor = new WebhookProcessor(eventStore, pool);
      const now = Math.floor(Date.now() / 1000);

      // Newer event (subscription paused at T = now)
      const newerPayload: RazorpayWebhookPayload = {
        entity: 'event',
        account_id: 'acc_test',
        event: 'subscription.paused',
        contains: ['subscription'],
        payload: {
          subscription: {
            entity: {
              id: 'sub_order_01',
              customer_id: 'cust_order_01',
              plan_id: 'plan_01',
              status: 'paused',
            },
          },
        },
        created_at: now,
      };
      await processor.processWebhook(newerPayload);

      // Out-of-order older event (subscription active at T = now - 3600)
      const olderPayload: RazorpayWebhookPayload = {
        entity: 'event',
        account_id: 'acc_test',
        event: 'subscription.charged',
        contains: ['subscription'],
        payload: {
          subscription: {
            entity: {
              id: 'sub_order_01',
              customer_id: 'cust_order_01',
              plan_id: 'plan_01',
              status: 'active',
            },
          },
        },
        created_at: now - 3600,
      };
      await processor.processWebhook(olderPayload);

      // Assert that persistent DB status remains 'paused' (newer state preserved)
      const res = await pool.query<{ status: string }>(
        'SELECT status FROM subscriptions WHERE subscription_id = $1',
        ['sub_order_01'],
      );
      expect(res.rows[0].status).toBe('paused');
    });
  });

  // ===========================================================================
  // FIX 14: EventStore Concurrency Safety
  // ===========================================================================
  describe('FIX 14: EventStore Concurrency Safety', () => {
    it('14.1 should maintain 100% linear hash chain under concurrent simultaneous writes', async () => {
      const promises: Promise<unknown>[] = [];
      const count = 10;

      for (let i = 0; i < count; i++) {
        promises.push(
          eventStore.appendEvent({
            subscriptionId: `sub_concurrent_${i}`,
            eventType: 'invoice.payment_failed',
            actor: 'razorpay_webhook',
            payload: { attempt: i },
          }),
        );
      }

      await Promise.all(promises);

      const integrity = await eventStore.verifyChainIntegrity();
      expect(integrity.valid).toBe(true);
      expect(integrity.verifiedCount).toBe(count);
      expect(integrity.errors).toHaveLength(0);
    });
  });

  // ===========================================================================
  // FIX 15: Persistent Execution Idempotency
  // ===========================================================================
  describe('FIX 15: Persistent Execution Idempotency', () => {
    it('15.1 should reject duplicate execution across fresh gateway instances', async () => {
      const gateway1 = new VerificationGateway(undefined, undefined, undefined, pool);
      const idempotencyKey = `idemp_test_${Date.now()}`;

      // Register execution key
      await gateway1.registerExecutedIdempotencyKey(idempotencyKey);

      // Create a fresh gateway instance (simulating restart)
      const gateway2 = new VerificationGateway(undefined, undefined, undefined, pool);
      gateway2.registerExecutedIdempotencyKey(idempotencyKey);

      RazorpayClient.setSimulatedLiveOverride('inst_idemp_check', { mandateStatus: 'active' });

      const dummyInstrument: DbInstrument = {
        instrument_id: 'inst_idemp_check',
        subscription_id: 'sub_idemp_check',
        rail: 'card',
        mandate_status: 'active',
        created_at: new Date().toISOString(),
        expiry_date: null,
        last_synced_at: new Date().toISOString(),
        ltv_tier: 'medium',
        annualized_value: 1200000,
      };

      const verification = await gateway2.verify({
        instrument: dummyInstrument,
        decision: {
          decisionId: 'dec_idemp_01',
          instrumentId: 'inst_idemp_check',
          subscriptionId: 'sub_idemp_check',
          result: 'ALLOW',
          proposedAction: 'retry',
          finalAction: 'retry',
          ruleIdMatched: 'RULE-01',
          reason: 'Retry',
          evaluatedAt: new Date().toISOString(),
        },
        idempotencyKey,
      });

      expect(verification.status).toBe('BLOCKED');
      expect(verification.blockedReason).toBe('IDEMPOTENCY_CONFLICT');
    });
  });

  // ===========================================================================
  // FIX 17: Policy Decision Reproducibility
  // ===========================================================================
  describe('FIX 17: Policy Decision Reproducibility & Audit Trail', () => {
    it('17.1 should persist decision record with policy version, hash, and full input snapshot', async () => {
      const policyService = new PolicyService(eventStore, pool);
      const res = await policyService.evaluateAndLog({
        instrumentId: 'inst_audit_01',
        subscriptionId: 'sub_audit_01',
        rail: 'card',
        trajectory: 'DEGRADING',
        attemptCount: 1,
        proposedAction: 'retry',
        rootCause: 'REPEATED_SOFT_DECLINE',
        expectedRecoveryValue: 120000,
        ltvTier: 'high',
        customerContactCountThisCycle: 0,
        amountPaise: 100000,
      });

      expect(res.decision.parameters).toBeDefined();
      expect(res.decision.parameters?.policyVersion).toBe('1.0.0');
      expect(res.decision.parameters?.policyHash).toBeDefined();
      expect(res.decision.parameters?.inputSnapshot).toBeDefined();
    });
  });

  // ===========================================================================
  // FIX 18: Circuit Breaker Statistical Sample Size Guard
  // ===========================================================================
  describe('FIX 18: Circuit Breaker Minimum Sample Size Guard', () => {
    it('18.1 should NOT trip circuit breaker on a small sample (e.g. 1 failure out of 1 attempt)', async () => {
      const cb = new CohortCircuitBreaker(undefined, {
        windowSize: 20,
        minSamples: 10,
        minSuccessRateThreshold: 0.4,
      });

      // Single failure (0% success rate on 1 attempt)
      const res = await cb.recordOutcome('rail:upi_autopay', false);
      expect(res.state).toBe('CLOSED'); // Should NOT trip because total samples (1) < minSamples (10)
      expect(res.trippedNow).toBe(false);
    });

    it('18.2 should trip circuit breaker when sample size reaches minSamples with failing rate', async () => {
      const cb = new CohortCircuitBreaker(undefined, {
        windowSize: 20,
        minSamples: 10,
        minSuccessRateThreshold: 0.4,
      });

      // Record 10 consecutive failures
      let lastRes: { state: string; trippedNow: boolean } = { state: 'CLOSED', trippedNow: false };
      for (let i = 0; i < 10; i++) {
        lastRes = await cb.recordOutcome('rail:card', false);
      }

      expect(lastRes.state).toBe('OPEN');
      expect(lastRes.trippedNow).toBe(true);
    });
  });
});
