import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { RazorpayWebhookPayload } from '@recovery/shared';
import { EventStore } from '../src/event-store/event-store.js';
import { WebhookProcessor } from '../src/razorpay/webhook-processor.js';
import { verifyWebhookSignature } from '../src/razorpay/webhook-verifier.js';
import { buildApp } from '../src/index.js';
import { createTestDatabase, type TestPool } from './test-db.js';

describe('Razorpay Webhook Verification & Ingestion Engine', () => {
  let pool: TestPool;
  let cleanup: () => Promise<void>;
  let eventStore: EventStore;
  let processor: WebhookProcessor;
  let app: FastifyInstance;

  const TEST_WEBHOOK_SECRET = 'whsec_test_secret_key_12345';

  function signPayload(body: string, secret = TEST_WEBHOOK_SECRET): string {
    return crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  }

  beforeEach(async () => {
    const testDb = await createTestDatabase();
    pool = testDb.pool;
    cleanup = testDb.cleanup;
    eventStore = new EventStore(pool);
    processor = new WebhookProcessor(eventStore, pool);

    app = await buildApp({
      webhookOptions: {
        processor,
        webhookSecret: TEST_WEBHOOK_SECRET,
      },
    });
  });

  afterEach(async () => {
    await app.close();
    await cleanup();
  });

  describe('HMAC-SHA256 Signature Verification', () => {
    it('1. should accept valid signatures', () => {
      const rawBody = JSON.stringify({ event: 'subscription.charged', test: true });
      const signature = signPayload(rawBody);

      const isValid = verifyWebhookSignature(rawBody, signature, TEST_WEBHOOK_SECRET);
      expect(isValid).toBe(true);
    });

    it('2. should reject invalid / mismatched signatures', () => {
      const rawBody = JSON.stringify({ event: 'subscription.charged' });
      const badSignature = 'a'.repeat(64);

      const isValid = verifyWebhookSignature(rawBody, badSignature, TEST_WEBHOOK_SECRET);
      expect(isValid).toBe(false);
    });

    it('3. should reject when secret or signature is missing', () => {
      const rawBody = JSON.stringify({ event: 'subscription.charged' });
      expect(verifyWebhookSignature(rawBody, undefined, TEST_WEBHOOK_SECRET)).toBe(false);
      expect(verifyWebhookSignature(rawBody, 'some_sig', '')).toBe(false);
      expect(verifyWebhookSignature('', 'some_sig', TEST_WEBHOOK_SECRET)).toBe(false);
    });

    it('4. should reject tampered payload even if signature format is valid', () => {
      const originalBody = JSON.stringify({ amount: 1000 });
      const signature = signPayload(originalBody);
      const tamperedBody = JSON.stringify({ amount: 999999 });

      const isValid = verifyWebhookSignature(tamperedBody, signature, TEST_WEBHOOK_SECRET);
      expect(isValid).toBe(false);
    });
  });

  describe('Webhook Ingestion Endpoint & State Transitions', () => {
    it('5. should reject POST /api/webhooks/razorpay with 400 when signature header is missing or invalid', async () => {
      const payload = {
        entity: 'event',
        account_id: 'acc_test_1',
        event: 'subscription.charged',
        contains: ['subscription'],
        payload: {
          subscription: {
            entity: {
              id: 'sub_test_001',
              plan_id: 'plan_pro',
              status: 'active',
            },
          },
        },
        created_at: 1700000000,
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/webhooks/razorpay',
        payload,
      });

      expect(res.statusCode).toBe(400);
      const json = JSON.parse(res.payload);
      expect(json.error).toBe('Invalid webhook signature');
    });

    it('6. should successfully ingest subscription.pending and project state to pending', async () => {
      const webhookBody: RazorpayWebhookPayload = {
        entity: 'event',
        account_id: 'acc_test_123',
        event: 'subscription.pending',
        contains: ['subscription', 'payment'],
        payload: {
          subscription: {
            entity: {
              id: 'sub_alpha_1',
              plan_id: 'plan_gold',
              customer_id: 'cust_user_456',
              token_id: 'tok_upi_123',
              status: 'pending',
            },
          },
          payment: {
            entity: {
              id: 'pay_failed_001',
              amount: 499900,
              currency: 'INR',
              status: 'failed',
              error_code: 'BAD_REQUEST_PAYMENT_FAILED',
              error_description: 'Payment failed due to insufficient balance in customer account',
            },
          },
        },
        created_at: 1700000000,
      };

      const rawString = JSON.stringify(webhookBody);
      const signature = signPayload(rawString);

      const res = await app.inject({
        method: 'POST',
        url: '/api/webhooks/razorpay',
        headers: {
          'x-razorpay-signature': signature,
          'content-type': 'application/json',
        },
        payload: rawString,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.subscriptionId).toBe('sub_alpha_1');
      expect(body.status).toBe('pending');
      expect(body.sequenceNumber).toBe(1);

      // Verify event was saved to EventStore
      const events = await eventStore.getEventsForSubscription('sub_alpha_1');
      expect(events).toHaveLength(1);
      expect(events[0].actor).toBe('razorpay_webhook');
      expect(events[0].eventType).toBe('subscription.pending');
      expect(events[0].instrumentId).toBe('tok_upi_123');

      // Verify subscriptions materialized view updated
      const subRes = await pool.query('SELECT * FROM subscriptions WHERE subscription_id = $1;', [
        'sub_alpha_1',
      ]);
      expect(subRes.rows).toHaveLength(1);
      expect(subRes.rows[0].status).toBe('pending');
      expect(subRes.rows[0].customer_id).toBe('cust_user_456');
    });

    it('7. should transition subscription from pending to halted when subscription.halted arrives', async () => {
      // 1. Initial pending event
      const pendingEvent: RazorpayWebhookPayload = {
        entity: 'event',
        account_id: 'acc_123',
        event: 'subscription.pending',
        contains: ['subscription'],
        payload: {
          subscription: {
            entity: {
              id: 'sub_lifecycle_1',
              plan_id: 'plan_starter',
              customer_id: 'cust_777',
              status: 'pending',
            },
          },
        },
        created_at: 1700000000,
      };

      await app.inject({
        method: 'POST',
        url: '/api/webhooks/razorpay',
        headers: {
          'x-razorpay-signature': signPayload(JSON.stringify(pendingEvent)),
          'content-type': 'application/json',
        },
        payload: JSON.stringify(pendingEvent),
      });

      // 2. Subscription halted event
      const haltedEvent: RazorpayWebhookPayload = {
        entity: 'event',
        account_id: 'acc_123',
        event: 'subscription.halted',
        contains: ['subscription'],
        payload: {
          subscription: {
            entity: {
              id: 'sub_lifecycle_1',
              plan_id: 'plan_starter',
              customer_id: 'cust_777',
              status: 'halted',
            },
          },
        },
        created_at: 1700000100,
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/webhooks/razorpay',
        headers: {
          'x-razorpay-signature': signPayload(JSON.stringify(haltedEvent)),
          'content-type': 'application/json',
        },
        payload: JSON.stringify(haltedEvent),
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.status).toBe('halted');

      // Check materialized status
      const subRow = await pool.query(
        'SELECT status FROM subscriptions WHERE subscription_id = $1;',
        ['sub_lifecycle_1'],
      );
      expect(subRow.rows[0].status).toBe('halted');
    });

    it('8. should correctly handle and project all 9 Razorpay subscription webhook lifecycle events', async () => {
      const eventSequence: Array<{
        event: RazorpayWebhookPayload['event'];
        expectedStatus: string;
      }> = [
        { event: 'subscription.activated', expectedStatus: 'active' },
        { event: 'subscription.charged', expectedStatus: 'active' },
        { event: 'subscription.updated', expectedStatus: 'active' },
        { event: 'subscription.pending', expectedStatus: 'pending' },
        { event: 'subscription.halted', expectedStatus: 'halted' },
        { event: 'subscription.paused', expectedStatus: 'paused' },
        { event: 'subscription.resumed', expectedStatus: 'active' },
        { event: 'subscription.cancelled', expectedStatus: 'cancelled' },
        { event: 'subscription.completed', expectedStatus: 'completed' },
      ];

      const subscriptionId = 'sub_full_lifecycle_999';

      for (let i = 0; i < eventSequence.length; i++) {
        const item = eventSequence[i];
        const payload: RazorpayWebhookPayload = {
          entity: 'event',
          account_id: 'acc_test',
          event: item.event,
          contains: ['subscription'],
          payload: {
            subscription: {
              entity: {
                id: subscriptionId,
                plan_id: 'plan_enterprise',
                customer_id: 'cust_mega_corp',
                status: item.expectedStatus,
              },
            },
          },
          created_at: 1700000000 + i * 60,
        };

        const raw = JSON.stringify(payload);
        const res = await app.inject({
          method: 'POST',
          url: '/api/webhooks/razorpay',
          headers: {
            'x-razorpay-signature': signPayload(raw),
            'content-type': 'application/json',
          },
          payload: raw,
        });

        expect(res.statusCode).toBe(200);
        const resBody = JSON.parse(res.payload);
        expect(resBody.status).toBe(item.expectedStatus);
      }

      // Check that all 9 events are stored in event store
      const events = await eventStore.getEventsForSubscription(subscriptionId);
      expect(events).toHaveLength(9);

      // Verify chain integrity across all 9 ingested events
      const integrity = await eventStore.verifyChainIntegrity();
      expect(integrity.valid).toBe(true);
      expect(integrity.verifiedCount).toBe(9);
      expect(integrity.errors).toHaveLength(0);
    });
  });
});
