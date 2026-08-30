import pg from 'pg';
import { EventStore, getPool } from '@recovery/server';
import type { RazorpayWebhookPayload } from '@recovery/shared';
import type { SyntheticSubscriptionSpec } from './types.js';

export interface SeedingResult {
  subscriptionsSeeded: number;
  eventsAppended: number;
  chainIntegrityValid: boolean;
}

export class SyntheticDataSeeder {
  private eventStore: EventStore;
  private pool: pg.Pool;

  constructor(eventStore?: EventStore, pool?: pg.Pool) {
    this.pool = pool || getPool();
    this.eventStore = eventStore || new EventStore(this.pool);
  }

  /**
   * Seeds all synthetic specifications by generating event histories into the EventStore,
   * and then deriving/materializing the relational state in subscriptions and instruments tables.
   */
  async seedBatch(specs: SyntheticSubscriptionSpec[]): Promise<SeedingResult> {
    let totalEventsAppended = 0;

    for (const spec of specs) {
      const eventsCount = await this.seedSingleSubscription(spec);
      totalEventsAppended += eventsCount;
    }

    const integrity = await this.eventStore.verifyChainIntegrity();

    return {
      subscriptionsSeeded: specs.length,
      eventsAppended: totalEventsAppended,
      chainIntegrityValid: integrity.valid,
    };
  }

  /**
   * Generates chronological event lifecycle for a single subscription spec.
   */
  private async seedSingleSubscription(spec: SyntheticSubscriptionSpec): Promise<number> {
    let eventsAppended = 0;
    const baseDate = new Date(spec.createdAt).getTime();

    // 1. Initial Activation Event (subscription.activated)
    const activationPayload: RazorpayWebhookPayload = {
      entity: 'event',
      account_id: 'acc_synthetic_core',
      event: 'subscription.activated',
      contains: ['subscription'],
      payload: {
        subscription: {
          entity: {
            id: spec.subscriptionId,
            plan_id: spec.planId,
            customer_id: spec.customerId,
            token_id: spec.instrumentId,
            status: 'active',
            notes: {
              customer_name: spec.customerName,
              customer_email: spec.customerEmail,
              customer_phone: spec.customerPhone,
              ltv_tier: spec.ltvTier,
              mcc_category: spec.mccCategory,
              mcc_code: spec.mccCode,
              rail: spec.rail,
              is_stale_cache_candidate: spec.isStaleCacheCandidate,
            },
          },
        },
      },
      created_at: Math.floor(baseDate / 1000),
    };

    await this.eventStore.appendEvent({
      subscriptionId: spec.subscriptionId,
      instrumentId: spec.instrumentId,
      eventType: 'subscription.activated',
      actor: 'razorpay_webhook',
      payload: activationPayload,
      createdAt: new Date(baseDate).toISOString(),
    });
    eventsAppended++;

    // 2. Historical Successful Charges (subscription.charged)
    const chargedCycles = Math.max(
      1,
      spec.historyEventCount - (spec.healthProfile === 'HEALTHY' ? 1 : 2),
    );

    for (let cycle = 1; cycle <= chargedCycles; cycle++) {
      const chargeTime = baseDate + cycle * 30 * 86400 * 1000;
      const chargePayload: RazorpayWebhookPayload = {
        entity: 'event',
        account_id: 'acc_synthetic_core',
        event: 'subscription.charged',
        contains: ['subscription', 'payment'],
        payload: {
          subscription: {
            entity: {
              id: spec.subscriptionId,
              plan_id: spec.planId,
              customer_id: spec.customerId,
              token_id: spec.instrumentId,
              status: 'active',
              paid_count: cycle,
            },
          },
          payment: {
            entity: {
              id: `pay_synth_${spec.index}_cycle_${cycle}`,
              amount: spec.monthlyAmount,
              currency: 'INR',
              status: 'captured',
              method: spec.rail,
              token_id: spec.instrumentId,
            },
          },
        },
        created_at: Math.floor(chargeTime / 1000),
      };

      await this.eventStore.appendEvent({
        subscriptionId: spec.subscriptionId,
        instrumentId: spec.instrumentId,
        eventType: 'subscription.charged',
        actor: 'razorpay_webhook',
        payload: chargePayload,
        createdAt: new Date(chargeTime).toISOString(),
      });
      eventsAppended++;
    }

    // 3. Degrading / Terminal Failure Lifecycle Events
    if (spec.healthProfile === 'DEGRADING') {
      const failureTime = Date.now() - 3600 * 1000; // 1 hour ago
      const pendingPayload: RazorpayWebhookPayload = {
        entity: 'event',
        account_id: 'acc_synthetic_core',
        event: 'subscription.pending',
        contains: ['subscription', 'payment'],
        payload: {
          subscription: {
            entity: {
              id: spec.subscriptionId,
              plan_id: spec.planId,
              customer_id: spec.customerId,
              token_id: spec.instrumentId,
              status: 'pending',
            },
          },
          payment: {
            entity: {
              id: `pay_synth_${spec.index}_fail_pending`,
              amount: spec.monthlyAmount,
              currency: 'INR',
              status: 'failed',
              error_code: spec.declineCode || 'BAD_REQUEST_PAYMENT_FAILED',
              error_description:
                spec.failureReason || 'Payment failed during recurring debit attempt',
              method: spec.rail,
              token_id: spec.instrumentId,
            },
          },
        },
        created_at: Math.floor(failureTime / 1000),
      };

      await this.eventStore.appendEvent({
        subscriptionId: spec.subscriptionId,
        instrumentId: spec.instrumentId,
        eventType: 'subscription.pending',
        actor: 'razorpay_webhook',
        payload: pendingPayload,
        createdAt: new Date(failureTime).toISOString(),
      });
      eventsAppended++;
    } else if (spec.healthProfile === 'TERMINAL') {
      const fail1Time = Date.now() - 86400 * 1000 * 3; // 3 days ago
      const haltTime = Date.now() - 86400 * 1000 * 1; // 1 day ago

      // Failed attempt
      const pendingPayload: RazorpayWebhookPayload = {
        entity: 'event',
        account_id: 'acc_synthetic_core',
        event: 'subscription.pending',
        contains: ['subscription', 'payment'],
        payload: {
          subscription: {
            entity: {
              id: spec.subscriptionId,
              plan_id: spec.planId,
              customer_id: spec.customerId,
              token_id: spec.instrumentId,
              status: 'pending',
            },
          },
          payment: {
            entity: {
              id: `pay_synth_${spec.index}_terminal_fail`,
              amount: spec.monthlyAmount,
              currency: 'INR',
              status: 'failed',
              error_code: spec.declineCode || 'USER_CANCELLED_MANDATE',
              error_description: spec.failureReason || 'Mandate revoked or hard decline',
              method: spec.rail,
              token_id: spec.instrumentId,
            },
          },
        },
        created_at: Math.floor(fail1Time / 1000),
      };

      await this.eventStore.appendEvent({
        subscriptionId: spec.subscriptionId,
        instrumentId: spec.instrumentId,
        eventType: 'subscription.pending',
        actor: 'razorpay_webhook',
        payload: pendingPayload,
        createdAt: new Date(fail1Time).toISOString(),
      });
      eventsAppended++;

      // Final halt
      const haltPayload: RazorpayWebhookPayload = {
        entity: 'event',
        account_id: 'acc_synthetic_core',
        event: 'subscription.halted',
        contains: ['subscription'],
        payload: {
          subscription: {
            entity: {
              id: spec.subscriptionId,
              plan_id: spec.planId,
              customer_id: spec.customerId,
              token_id: spec.instrumentId,
              status: 'halted',
            },
          },
        },
        created_at: Math.floor(haltTime / 1000),
      };

      await this.eventStore.appendEvent({
        subscriptionId: spec.subscriptionId,
        instrumentId: spec.instrumentId,
        eventType: 'subscription.halted',
        actor: 'razorpay_webhook',
        payload: haltPayload,
        createdAt: new Date(haltTime).toISOString(),
      });
      eventsAppended++;
    }

    // 4. Materialize Instrument & Subscription Tables in Database
    // (If stale cache candidate, keep mandate_status 'active' in DB for verification gateway demo)
    const effectiveMandateStatus = spec.isStaleCacheCandidate ? 'active' : spec.mandateStatus;

    await this.pool.query(
      `INSERT INTO instruments (
        instrument_id,
        subscription_id,
        rail,
        created_at,
        expiry_date,
        mandate_status,
        last_synced_at,
        ltv_tier,
        annualized_value
      ) VALUES ($1, $2, $3::instrument_rail, $4, $5, $6::mandate_status, NOW(), $7, $8)
      ON CONFLICT (instrument_id) DO UPDATE
      SET mandate_status = EXCLUDED.mandate_status,
          expiry_date = EXCLUDED.expiry_date,
          ltv_tier = EXCLUDED.ltv_tier,
          annualized_value = EXCLUDED.annualized_value,
          last_synced_at = NOW();`,
      [
        spec.instrumentId,
        spec.subscriptionId,
        spec.rail,
        spec.createdAt,
        spec.cardExpiryDate,
        effectiveMandateStatus,
        spec.ltvTier,
        spec.annualizedValue,
      ],
    );

    await this.pool.query(
      `INSERT INTO subscriptions (
        subscription_id,
        customer_id,
        plan_id,
        status,
        current_instrument_id,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4::subscription_status, $5, $6, NOW())
      ON CONFLICT (subscription_id) DO UPDATE
      SET status = EXCLUDED.status,
          current_instrument_id = EXCLUDED.current_instrument_id,
          updated_at = NOW();`,
      [
        spec.subscriptionId,
        spec.customerId,
        spec.planId,
        spec.finalStatus,
        spec.instrumentId,
        spec.createdAt,
      ],
    );

    return eventsAppended;
  }
}
