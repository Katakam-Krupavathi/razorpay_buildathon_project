import dotenv from 'dotenv';
import {
  RazorpayClient,
  getPool,
  closePool,
  type CreatePlanParams,
  type CreateSubscriptionParams,
} from '@recovery/server';

dotenv.config();

export interface TestDataCreationResult {
  planId: string;
  subscriptions: Array<{
    subscriptionId: string;
    customerId: string;
    instrumentId: string;
    status: string;
  }>;
}

export async function createRazorpayTestData(
  client?: RazorpayClient,
): Promise<TestDataCreationResult> {
  const rzp = client || new RazorpayClient();
  const pool = getPool();

  console.log('[Razorpay Test Data] Initializing test plan and subscriptions setup...');

  const isPlaceholderKey =
    !rzp.getKeyId() || rzp.getKeyId().includes('placeholder');

  let planId = 'plan_test_pro_monthly';

  if (!isPlaceholderKey) {
    try {
      console.log('[Razorpay Test Data] Creating live test-mode Plan via API...');
      const planParams: CreatePlanParams = {
        period: 'monthly',
        interval: 1,
        item: {
          name: 'Pro Subscription Plan',
          amount: 299900, // ₹2,999.00
          currency: 'INR',
          description: 'Autonomous Recovery Control Plane Test Plan',
        },
        notes: {
          environment: 'test_sandbox',
        },
      };
      const plan = await rzp.createPlan(planParams);
      planId = plan.id;
      console.log(`[Razorpay Test Data] Created Plan: ${planId}`);
    } catch (error) {
      console.warn(
        '[Razorpay Test Data] Live plan creation failed, using mock plan ID:',
        error,
      );
    }
  } else {
    console.log(
      '[Razorpay Test Data] Test placeholder keys detected. Creating structured local test data...',
    );
  }

  const testSubscriptions: Array<{
    subscriptionId: string;
    customerId: string;
    instrumentId: string;
    status: string;
  }> = [];

  const sampleSubscriptions = [
    {
      subId: 'sub_test_live_001',
      customerId: 'cust_acme_corp',
      instrumentId: 'inst_card_001',
      rail: 'card',
      status: 'active',
      annualizedValue: 3598800,
    },
    {
      subId: 'sub_test_live_002',
      customerId: 'cust_starlight_labs',
      instrumentId: 'inst_upi_002',
      rail: 'upi_autopay',
      status: 'active',
      annualizedValue: 2400000,
    },
    {
      subId: 'sub_test_live_003',
      customerId: 'cust_nexus_fintech',
      instrumentId: 'inst_enach_003',
      rail: 'enach',
      status: 'pending',
      annualizedValue: 12000000,
    },
  ];

  for (const item of sampleSubscriptions) {
    let subscriptionId = item.subId;

    if (!isPlaceholderKey) {
      try {
        const subParams: CreateSubscriptionParams = {
          planId,
          totalCount: 12,
          customerNotify: false,
          notes: {
            customerId: item.customerId,
          },
        };
        const liveSub = await rzp.createSubscription(subParams);
        subscriptionId = liveSub.id;
      } catch (err) {
        console.warn(`[Razorpay Test Data] Live subscription create failed for ${item.subId}, using local ID:`, err);
      }
    }

    // Upsert instrument in database
    await pool.query(
      `INSERT INTO instruments (
        instrument_id,
        subscription_id,
        rail,
        mandate_status,
        ltv_tier,
        annualized_value,
        created_at,
        last_synced_at
      ) VALUES ($1, $2, $3::instrument_rail, 'active', 'tier_1', $4, NOW(), NOW())
      ON CONFLICT (instrument_id) DO UPDATE
      SET mandate_status = 'active', last_synced_at = NOW();`,
      [item.instrumentId, subscriptionId, item.rail, item.annualizedValue],
    );

    // Upsert subscription in database
    await pool.query(
      `INSERT INTO subscriptions (
        subscription_id,
        customer_id,
        plan_id,
        status,
        current_instrument_id,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4::subscription_status, $5, NOW(), NOW())
      ON CONFLICT (subscription_id) DO UPDATE
      SET status = EXCLUDED.status,
          current_instrument_id = EXCLUDED.current_instrument_id,
          updated_at = NOW();`,
      [
        subscriptionId,
        item.customerId,
        planId,
        item.status,
        item.instrumentId,
      ],
    );

    testSubscriptions.push({
      subscriptionId,
      customerId: item.customerId,
      instrumentId: item.instrumentId,
      status: item.status,
    });

    console.log(
      `[Razorpay Test Data] Seeded Subscription: ${subscriptionId} (${item.status}) with Instrument: ${item.instrumentId}`,
    );
  }

  return {
    planId,
    subscriptions: testSubscriptions,
  };
}

async function run() {
  try {
    const result = await createRazorpayTestData();
    console.log('[Razorpay Test Data] Result Summary:');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('[Razorpay Test Data] Failed:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  run();
}
