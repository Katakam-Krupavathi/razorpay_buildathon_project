import dotenv from 'dotenv';
import type {
  RazorpaySubscriptionEntity,
  RazorpayMandate,
} from '@recovery/shared';

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
    const webhookSecret =
      customConfig?.webhookSecret || process.env.RAZORPAY_WEBHOOK_SECRET || '';
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
  async createSubscription(
    params: CreateSubscriptionParams,
  ): Promise<RazorpaySubscriptionEntity> {
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

  /**
   * Fetches the live subscription state directly from Razorpay.
   */
  async fetchLiveSubscriptionState(subscriptionId: string): Promise<RazorpaySubscriptionEntity> {
    if (!subscriptionId) {
      throw new Error('Subscription ID is required to fetch live subscription state');
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

    const endpoint = customerId
      ? `/customers/${customerId}/tokens/${tokenId}`
      : `/tokens/${tokenId}`;

    return this.request<RazorpayTokenEntity | RazorpayMandate>(endpoint, {
      method: 'GET',
    });
  }
}
