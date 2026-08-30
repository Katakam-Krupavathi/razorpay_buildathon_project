import dotenv from 'dotenv';
import { EventStore, closePool } from '@recovery/server';
import type { ChainIntegrityResult, CreateEventInput, EventActor } from '@recovery/shared';

dotenv.config();

export interface SeedOptions {
  eventCount?: number;
  eventStore?: EventStore;
}

export async function seedSyntheticEvents(options?: SeedOptions): Promise<ChainIntegrityResult> {
  const store = options?.eventStore || new EventStore();
  const count = options?.eventCount ?? 25;

  console.log(`[Seed] Generating and appending ${count} synthetic events...`);

  const eventTemplates: Array<{
    eventType: string;
    actor: EventActor;
    payloadGenerator: (i: number) => Record<string, unknown>;
  }> = [
    {
      eventType: 'invoice.payment_failed',
      actor: 'razorpay_webhook',
      payloadGenerator: (i) => ({
        invoiceId: `inv_synth_${1000 + i}`,
        amount: 299900,
        currency: 'INR',
        errorCode: 'BAD_REQUEST_PAYMENT_FAILED',
        errorDescription: 'Payment failed due to insufficient balance in customer account',
        attemptCount: 1,
      }),
    },
    {
      eventType: 'risk.evaluated',
      actor: 'health_scorer',
      payloadGenerator: (i) => ({
        invoiceId: `inv_synth_${1000 + i}`,
        failureCategory: 'insufficient_funds',
        riskScore: 0.285,
        isRecoverable: true,
        recommendedBackoffSeconds: 86400,
      }),
    },
    {
      eventType: 'erv.computed',
      actor: 'health_scorer',
      payloadGenerator: (i) => ({
        invoiceId: `inv_synth_${1000 + i}`,
        expectedRecoveryValue: 245000,
        historicalRecoveryProb: 0.82,
        churnPropensity: 0.15,
        shouldIntervene: true,
      }),
    },
    {
      eventType: 'plan.generated',
      actor: 'recovery_planner',
      payloadGenerator: (i) => ({
        invoiceId: `inv_synth_${1000 + i}`,
        planId: `plan_${2000 + i}`,
        strategy: 'optimal_salary_window_retry',
        steps: [
          { step: 1, rail: 'upi_autopay', delaySeconds: 3600 },
          { step: 2, rail: 'dunning_link', delaySeconds: 86400 },
        ],
      }),
    },
    {
      eventType: 'policy.permitted',
      actor: 'policy_engine',
      payloadGenerator: (i) => ({
        invoiceId: `inv_synth_${1000 + i}`,
        decision: 'PERMIT',
        targetAction: 'DISPATCH_UPI_AUTOPAY',
        ruleResults: [
          { rule: 'MAX_ATTEMPTS_PER_CYCLE', passed: true },
          { rule: 'QUIET_HOURS_RESPECTED', passed: true },
          { rule: 'GLOBAL_VELOCITY_CAP', passed: true },
        ],
      }),
    },
    {
      eventType: 'recovery.initiated',
      actor: 'execution_engine',
      payloadGenerator: (i) => ({
        invoiceId: `inv_synth_${1000 + i}`,
        rail: 'upi_autopay',
        razorpayPaymentId: `pay_synth_${3000 + i}`,
        amount: 299900,
      }),
    },
    {
      eventType: 'recovery.succeeded',
      actor: 'execution_engine',
      payloadGenerator: (i) => ({
        invoiceId: `inv_synth_${1000 + i}`,
        rail: 'upi_autopay',
        amountRecovered: 299900,
        settlementTimestamp: new Date().toISOString(),
      }),
    },
    {
      eventType: 'attribution.recorded',
      actor: 'execution_engine',
      payloadGenerator: (i) => ({
        invoiceId: `inv_synth_${1000 + i}`,
        netValueRecovered: 293900,
        processingFee: 6000,
        autonomousEfficiencyGain: 1.0,
      }),
    },
  ];

  for (let i = 0; i < count; i++) {
    const template = eventTemplates[i % eventTemplates.length];
    const subId = `sub_test_${Math.floor(i / 4) + 1}`;
    const instId = `inst_test_${Math.floor(i / 4) + 1}`;

    const eventInput: CreateEventInput = {
      eventId: `evt_seed_${String(i + 1).padStart(4, '0')}`,
      subscriptionId: subId,
      instrumentId: instId,
      eventType: template.eventType,
      actor: template.actor,
      payload: template.payloadGenerator(i),
      createdAt: new Date(Date.now() - (count - i) * 60000).toISOString(),
    };

    const stored = await store.appendEvent(eventInput);
    console.log(
      `[Seed] Appended [Seq ${stored.sequenceNumber}] ${stored.eventType} | Hash: ${stored.hash.substring(0, 16)}... | PrevHash: ${stored.prevHash.substring(0, 16)}...`,
    );
  }

  console.log('[Seed] Verifying complete event chain integrity...');
  const integrity = await store.verifyChainIntegrity();
  console.log('[Seed] Chain Integrity Verification Result:', integrity);

  return integrity;
}

async function runStandalone() {
  try {
    const result = await seedSyntheticEvents();
    if (!result.valid) {
      console.error('[Seed] Chain verification failed!', result.errors);
      process.exit(1);
    }
    console.log('[Seed] Chain verified valid with zero tampering detected.');
  } catch (error) {
    console.error('[Seed] Error during seeding:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  runStandalone();
}
