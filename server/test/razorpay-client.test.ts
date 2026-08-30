import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RazorpayClient } from '../src/razorpay/client.js';

describe('RazorpayClient SDK Wrapper', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('1. should construct client with environment or custom configurations', () => {
    const client = new RazorpayClient({
      keyId: 'rzp_test_custom_key',
      keySecret: 'rzp_test_custom_secret',
      webhookSecret: 'custom_wh_secret',
    });

    expect(client.getKeyId()).toBe('rzp_test_custom_key');
    expect(client.getWebhookSecret()).toBe('custom_wh_secret');
  });

  it('2. should fetch live subscription state with proper basic auth', async () => {
    const mockSubscriptionResponse = {
      id: 'sub_live_123',
      entity: 'subscription',
      plan_id: 'plan_gold_monthly',
      customer_id: 'cust_789',
      status: 'active',
      current_start: 1700000000,
      current_end: 1702592000,
      ended_at: null,
      quantity: 1,
      total_count: 12,
      paid_count: 3,
      created_at: 1698000000,
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockSubscriptionResponse,
    } as unknown as Response);

    const client = new RazorpayClient({
      keyId: 'rzp_test_key_1',
      keySecret: 'rzp_test_secret_1',
      baseUrl: 'https://api.razorpay.com/v1',
    });

    const result = await client.fetchLiveSubscriptionState('sub_live_123');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.razorpay.com/v1/subscriptions/sub_live_123');
    expect(options.headers.Authorization).toBe(
      'Basic ' + Buffer.from('rzp_test_key_1:rzp_test_secret_1').toString('base64'),
    );
    expect(result.id).toBe('sub_live_123');
    expect(result.status).toBe('active');
  });

  it('3. should fetch live mandate/token state', async () => {
    const mockTokenResponse = {
      id: 'token_card_abc123',
      entity: 'token',
      token: 'tok_live_mandate_456',
      method: 'card',
      card: {
        last4: '1111',
        network: 'Visa',
        type: 'credit',
      },
      recurring: true,
      auth_type: 'card',
      created_at: 1698000000,
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockTokenResponse,
    } as unknown as Response);

    const client = new RazorpayClient({
      keyId: 'rzp_test_key_1',
      keySecret: 'rzp_test_secret_1',
    });

    const result = await client.fetchLiveMandateState('token_card_abc123', 'cust_789');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.razorpay.com/v1/customers/cust_789/tokens/token_card_abc123');
    expect(result.id).toBe('token_card_abc123');
  });

  it('4. should create recurring plan via API', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'plan_pro_999', entity: 'plan', interval: 1, period: 'monthly' }),
    } as unknown as Response);

    const client = new RazorpayClient({
      keyId: 'rzp_test_key',
      keySecret: 'rzp_test_sec',
    });

    const plan = await client.createPlan({
      period: 'monthly',
      interval: 1,
      item: {
        name: 'Pro Subscription',
        amount: 299900,
        currency: 'INR',
      },
    });

    expect(plan.id).toBe('plan_pro_999');
  });

  it('5. should handle API error responses gracefully', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({
        error: {
          code: 'BAD_REQUEST_ERROR',
          description: 'The id provided does not exist',
        },
      }),
    } as unknown as Response);

    const client = new RazorpayClient();

    await expect(client.fetchLiveSubscriptionState('sub_non_existent')).rejects.toThrow(
      /Razorpay API Error \[404 Not Found\]/,
    );
  });
});
