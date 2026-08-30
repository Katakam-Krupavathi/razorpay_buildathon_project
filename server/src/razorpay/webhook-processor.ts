import pg from 'pg';
import type {
  RazorpayWebhookPayload,
  RazorpayWebhookEvent,
  SubscriptionStatusEnum,
  StoredEvent,
} from '@recovery/shared';
import { EventStore } from '../event-store/event-store.js';
import { getPool } from '../db/connection.js';

export interface WebhookProcessingResult {
  success: boolean;
  event: StoredEvent<RazorpayWebhookPayload>;
  subscriptionId: string | null;
  status: SubscriptionStatusEnum | null;
  isProjected: boolean;
}

export class WebhookProcessor {
  private eventStore: EventStore;
  private pool: pg.Pool;

  constructor(eventStore?: EventStore, pool?: pg.Pool) {
    this.pool = pool || getPool();
    this.eventStore = eventStore || new EventStore(this.pool);
  }

  /**
   * Maps Razorpay webhook event types to the internal subscription state graph.
   *
   * State Transitions:
   * - authenticated -> activated -> active
   * - active <-> pending -> halted
   * - active -> paused -> resumed (active)
   * - any -> cancelled / completed
   */
  public mapWebhookEventToSubscriptionStatus(
    event: RazorpayWebhookEvent,
  ): SubscriptionStatusEnum | null {
    switch (event) {
      case 'subscription.charged':
      case 'subscription.activated':
      case 'subscription.updated':
      case 'subscription.resumed':
        return 'active';

      case 'subscription.pending':
        return 'pending';

      case 'subscription.halted':
        return 'halted';

      case 'subscription.paused':
        return 'paused';

      case 'subscription.cancelled':
        return 'cancelled';

      case 'subscription.completed':
        return 'completed';

      default:
        return null;
    }
  }

  /**
   * Extracts the subscription ID from various payload nesting shapes.
   */
  public extractSubscriptionId(payload: RazorpayWebhookPayload): string | null {
    return (
      payload.payload?.subscription?.entity?.id ||
      payload.payload?.payment?.entity?.subscription_id ||
      (payload.payload?.invoice?.entity as { subscription_id?: string } | undefined)
        ?.subscription_id ||
      null
    );
  }

  /**
   * Extracts customer ID from various payload nesting shapes.
   */
  public extractCustomerId(payload: RazorpayWebhookPayload): string | null {
    return (
      payload.payload?.subscription?.entity?.customer_id ||
      (payload.payload?.payment?.entity as { customer_id?: string } | undefined)?.customer_id ||
      'cust_unknown'
    );
  }

  /**
   * Extracts plan ID from subscription payload.
   */
  public extractPlanId(payload: RazorpayWebhookPayload): string | null {
    return payload.payload?.subscription?.entity?.plan_id || 'plan_default';
  }

  /**
   * Extracts instrument / token ID from webhook payload if present.
   */
  public extractInstrumentId(payload: RazorpayWebhookPayload): string | null {
    return (
      payload.payload?.subscription?.entity?.token_id ||
      payload.payload?.payment?.entity?.token_id ||
      null
    );
  }

  /**
   * Ingests a validated webhook event:
   * 1. Appends raw immutable event into the Event Store (actor = 'razorpay_webhook').
   * 2. Projects and materializes the updated subscription state into the subscriptions table.
   */
  public async processWebhook(payload: RazorpayWebhookPayload): Promise<WebhookProcessingResult> {
    const subscriptionId = this.extractSubscriptionId(payload);
    const instrumentId = this.extractInstrumentId(payload);
    const customerId = this.extractCustomerId(payload) || 'cust_unknown';
    const planId = this.extractPlanId(payload) || 'plan_default';
    const mappedStatus = this.mapWebhookEventToSubscriptionStatus(payload.event);

    // 1. Append to the immutable, hash-chained event store
    const storedEvent = await this.eventStore.appendEvent<RazorpayWebhookPayload>({
      subscriptionId,
      instrumentId,
      eventType: payload.event,
      actor: 'razorpay_webhook',
      payload,
      createdAt: payload.created_at
        ? new Date(payload.created_at * 1000).toISOString()
        : new Date().toISOString(),
    });

    let isProjected = false;

    // 2. Materialize / project state into the subscriptions table
    if (subscriptionId && mappedStatus) {
      await this.pool.query(
        `INSERT INTO subscriptions (
          subscription_id,
          customer_id,
          plan_id,
          status,
          current_instrument_id,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
        ON CONFLICT (subscription_id) DO UPDATE
        SET status = EXCLUDED.status,
            current_instrument_id = COALESCE(EXCLUDED.current_instrument_id, subscriptions.current_instrument_id),
            updated_at = NOW();`,
        [subscriptionId, customerId, planId, mappedStatus, instrumentId],
      );
      isProjected = true;
    }

    return {
      success: true,
      event: storedEvent,
      subscriptionId,
      status: mappedStatus,
      isProjected,
    };
  }
}
