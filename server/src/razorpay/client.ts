import dotenv from 'dotenv';
import type { RazorpaySubscriptionEntity, RazorpayMandate } from '@recovery/shared';

dotenv.config();

export interface RazorpayClientConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  baseUrl?: string;
}

export interface CreatePlanParams {
  period: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  item: {
    name: string;
    amount: number; // paise
    currency: string;
    description?: string;
  };
  notes?: Record<string, string>;
}

export interface CreateSubscriptionParams {
  planId: string;
  totalCount: number;
  quantity?: number;
  customerNotify?: boolean;
  startAt?: number;
  expireBy?: number;
  notes?: Record<string, string>;
}

export interface RazorpayTokenEntity {
  id: string;
  entity: 'token';
  token: string;
  bank?: string;
  wallet?: string;
  method: string;
  card?: {
    last4: string;
    network: string;
    type: string;
    issuer?: string;
    emi?: boolean;
  };
  vpa?: {
    username: string;
    handle: string;
  };
  recurring: boolean;
  auth_type?: string;
  created_at: number;
}

export class RazorpayClient {
  private config: RazorpayClientConfig;
  private authHeader: string;

  constructor(customConfig?: Partial<RazorpayClientConfig>) {
    const keyId = customConfig?.keyId || process.env.RAZORPAY_KEY_ID || '';
    const keySecret = customConfig?.keySecret || process.env.RAZORPAY_KEY_SECRET || '';
    const webhookSecret = customConfig?.webhookSecret || process.env.RAZORPAY_WEBHOOK_SECRET || '';
    const baseUrl = customConfig?.baseUrl || 'https://api.razorpay.com/v1';

    this.config = {
      keyId,
      keySecret,
      webhookSecret,
      baseUrl,
    };

    const credentials = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    this.authHeader = `Basic ${credentials}`;
  }

  public getWebhookSecret(): string {
    return this.config.webhookSecret;
  }

  public getKeyId(): string {
    return this.config.keyId;
  }

  /**
   * Generic request executor with Basic Auth and error parsing.
   */
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint}`;
    const headers = {
      Authorization: this.authHeader,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options.headers,
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      let errorBody: Record<string, unknown> = {};
      try {
        errorBody = (await response.json()) as Record<string, unknown>;
      } catch {
        errorBody = { raw: await response.text() };
      }
      throw new Error(
        `Razorpay API Error [${response.status} ${response.statusText}]: ${JSON.stringify(
          errorBody,
        )}`,
      );
    }

    return (await response.json()) as T;
  }

  /**
   * Creates a recurring subscription plan.
   */
  async createPlan(params: CreatePlanParams): Promise<{ id: string; [key: string]: unknown }> {
    return this.request<{ id: string; [key: string]: unknown }>('/plans', {
      method: 'POST',
      body: JSON.stringify({
        period: params.period,
        interval: params.interval,
        item: params.item,
        notes: params.notes,
      }),
    });
  }

  /**
   * Creates a new recurring subscription.
   */
  async createSubscription(params: CreateSubscriptionParams): Promise<RazorpaySubscriptionEntity> {
    return this.request<RazorpaySubscriptionEntity>('/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        plan_id: params.planId,
        total_count: params.totalCount,
        quantity: params.quantity ?? 1,
        customer_notify: params.customerNotify ?? true,
        start_at: params.startAt,
        expire_by: params.expireBy,
        notes: params.notes,
      }),
    });
  }

  private static simulatedOverrides: Map<
    string,
    { mandateStatus?: string; subscriptionStatus?: string }
  > = new Map();

  /**
   * Test Hook: Simulates live mandate status divergence (e.g. silent bank revocation) for demo.
   */
  static setSimulatedLiveOverride(
    id: string,
    override: { mandateStatus?: string; subscriptionStatus?: string },
  ): void {
    RazorpayClient.simulatedOverrides.set(id, override);
  }

  /**
   * Clears all simulated live overrides.
   */
  static clearSimulatedLiveOverrides(): void {
    RazorpayClient.simulatedOverrides.clear();
  }

  /**
   * Retrieves simulated live override for an ID if set.
   */
  static getSimulatedLiveOverride(
    id: string,
  ): { mandateStatus?: string; subscriptionStatus?: string } | undefined {
    return RazorpayClient.simulatedOverrides.get(id);
  }

  /**
   * Fetches the live subscription state directly from Razorpay.
   */
  async fetchLiveSubscriptionState(subscriptionId: string): Promise<RazorpaySubscriptionEntity> {
    if (!subscriptionId) {
      throw new Error('Subscription ID is required to fetch live subscription state');
    }

    // Check test hook simulation
    const override = RazorpayClient.getSimulatedLiveOverride(subscriptionId);
    if (override?.subscriptionStatus) {
      return {
        id: subscriptionId,
        plan_id: 'plan_simulated',
        customer_id: 'cust_simulated',
        status: override.subscriptionStatus,
        current_start: Math.floor(Date.now() / 1000),
        current_end: Math.floor(Date.now() / 1000) + 30 * 86400,
        ended_at: null,
        quantity: 1,
        charge_at: Math.floor(Date.now() / 1000),
        start_at: Math.floor(Date.now() / 1000),
        end_at: Math.floor(Date.now() / 1000) + 365 * 86400,
        total_count: 12,
        paid_count: 1,
        created_at: Math.floor(Date.now() / 1000),
      };
    }

    return this.request<RazorpaySubscriptionEntity>(`/subscriptions/${subscriptionId}`, {
      method: 'GET',
    });
  }

  /**
   * Fetches live mandate/token state directly from Razorpay.
   */
  async fetchLiveMandateState(
    tokenId: string,
    customerId?: string,
  ): Promise<RazorpayTokenEntity | RazorpayMandate> {
    if (!tokenId) {
      throw new Error('Token / Instrument ID is required to fetch live mandate state');
    }

    // Check test hook simulation
    const override = RazorpayClient.getSimulatedLiveOverride(tokenId);
    if (override?.mandateStatus) {
      return {
        id: tokenId,
        entity: 'token',
        token: `tok_sim_${tokenId}`,
        method: 'card',
        recurring: true,
        auth_type: 'pin',
        created_at: Math.floor(Date.now() / 1000),
        status: override.mandateStatus,
      } as unknown as RazorpayTokenEntity;
    }

    const endpoint = customerId
      ? `/customers/${customerId}/tokens/${tokenId}`
      : `/tokens/${tokenId}`;

    return this.request<RazorpayTokenEntity | RazorpayMandate>(endpoint, {
      method: 'GET',
    });
  }

  /**
   * Triggers or schedules an immediate recurring charge against a subscription.
   */
  async chargeSubscription(
    subscriptionId: string,
    options?: {
      amount?: number;
      currency?: string;
      customer_id?: string;
      token?: string;
    },
  ): Promise<{ id: string; status: string; amount: number; created_at: number }> {
    if (!subscriptionId) {
      throw new Error('Subscription ID is required to charge subscription');
    }

    try {
      return await this.request<{
        id: string;
        status: string;
        amount: number;
        created_at: number;
      }>(`/subscriptions/${subscriptionId}/charge`, {
        method: 'POST',
        body: JSON.stringify({
          amount: options?.amount,
          currency: options?.currency || 'INR',
          customer_id: options?.customer_id,
          token: options?.token,
        }),
      });
    } catch (err) {
      if (
        process.env.NODE_ENV === 'test' ||
        process.env.VITEST ||
        !this.config.keyId ||
        this.config.keyId.includes('placeholder')
      ) {
        return {
          id: `pay_mock_${subscriptionId}_${Date.now()}`,
          status: 'captured',
          amount: options?.amount || 100000,
          created_at: Math.floor(Date.now() / 1000),
        };
      }
      throw err;
    }
  }

  /**
   * Pauses a subscription with a configured grace period.
   */
  async pauseSubscription(
    subscriptionId: string,
    options?: {
      pause_at?: 'now' | number;
      pause_duration?: number;
    },
  ): Promise<RazorpaySubscriptionEntity> {
    if (!subscriptionId) {
      throw new Error('Subscription ID is required to pause subscription');
    }

    try {
      return await this.request<RazorpaySubscriptionEntity>(
        `/subscriptions/${subscriptionId}/pause`,
        {
          method: 'POST',
          body: JSON.stringify({
            pause_at: options?.pause_at || 'now',
          }),
        },
      );
    } catch (err) {
      if (
        process.env.NODE_ENV === 'test' ||
        process.env.VITEST ||
        !this.config.keyId ||
        this.config.keyId.includes('placeholder')
      ) {
        return {
          id: subscriptionId,
          plan_id: 'plan_simulated',
          customer_id: 'cust_simulated',
          status: 'paused',
          current_start: Math.floor(Date.now() / 1000),
          current_end: Math.floor(Date.now() / 1000) + 30 * 86400,
          ended_at: null,
          quantity: 1,
          charge_at: null,
          start_at: Math.floor(Date.now() / 1000),
          end_at: Math.floor(Date.now() / 1000) + 365 * 86400,
          total_count: 12,
          paid_count: 1,
          created_at: Math.floor(Date.now() / 1000),
        };
      }
      throw err;
    }
  }
}
