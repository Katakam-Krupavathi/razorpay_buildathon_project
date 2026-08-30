import dotenv from 'dotenv';
import {
  VerificationService,
  VerificationGateway,
  RazorpayClient,
  CohortCircuitBreaker,
  EventStore,
  getPool,
  closePool,
  type DbInstrument,
  type PolicyDecisionRecord,
} from '@recovery/server';

dotenv.config();

export async function runStaleCacheDemoCli() {
  const pool = getPool();
  const eventStore = new EventStore(pool);
  const razorpayClient = new RazorpayClient();
  const circuitBreaker = new CohortCircuitBreaker(eventStore);
  const gateway = new VerificationGateway(razorpayClient, circuitBreaker);
  const service = new VerificationService(gateway, eventStore, pool);

  console.log('================================================================');
  console.log(' PRE-ACTION SAFETY & VERIFICATION GATEWAY (2 AM DEMO)');
  console.log('================================================================\n');

  // 1. Fetch or create a test instrument with cached active mandate
  const targetInstrumentId = 'inst_card_0045';
  const targetSubscriptionId = 'sub_synth_0045';

  const instrument: DbInstrument = {
    instrument_id: targetInstrumentId,
    subscription_id: targetSubscriptionId,
    rail: 'card',
    created_at: new Date('2026-01-01').toISOString(),
    expiry_date: new Date('2027-01-01').toISOString(),
    mandate_status: 'active', // Local database believes mandate is active
    last_synced_at: new Date('2026-08-30T00:00:00.000Z').toISOString(),
    ltv_tier: 'high',
    annualized_value: 10463160,
  };

  // 2. Policy Engine permits recovery action at decision time
  const policyDecision: PolicyDecisionRecord = {
    decisionId: 'dec_demo_2am_001',
    instrumentId: targetInstrumentId,
    subscriptionId: targetSubscriptionId,
    result: 'ALLOW',
    proposedAction: 'schedule_retry',
    finalAction: 'schedule_retry',
    ruleIdMatched: 'PASS-THROUGH-PERMIT-001',
    reason: 'Auto-retry complies with rail limits and contact caps',
    evaluatedAt: new Date().toISOString(),
  };

  console.log('[Step 1] Recovery Policy Formulated & Permitted:');
  console.log(`  Instrument ID   : ${instrument.instrument_id}`);
  console.log(`  Cached DB Status: ${instrument.mandate_status.toUpperCase()}`);
  console.log(
    `  Policy Outcome  : ${policyDecision.result} -> Action: ${policyDecision.finalAction}`,
  );

  // 3. Inject silent bank revocation at 2:00 AM (Customer revoked mandate in banking app)
  console.log('\n[Step 2] Simulating silent bank/issuer revocation at 02:00 AM...');
  RazorpayClient.setSimulatedLiveOverride(targetInstrumentId, {
    mandateStatus: 'revoked',
  });
  console.log('  -> Live Gateway Mandate State flipped to: REVOKED');

  // 4. Verification Gateway runs immediately pre-execution (never trusts cache)
  console.log(
    '\n[Step 3] Executing Pre-Action Verification Gateway immediately before money moves...',
  );
  const verifyResult = await service.verifyAndLog({
    instrument,
    decision: policyDecision,
    idempotencyKey: `idem_pre_action_demo_${Date.now()}`,
  });

  const v = verifyResult.verification;
  console.log('\n================ PRE-ACTION VERIFICATION REPORT ================');
  console.log(`Verification ID     : ${v.verificationId}`);
  console.log(`Cached State (DB)   : ${v.cachedMandateStatus.toUpperCase()}`);
  console.log(`Live State (Gateway): ${v.liveMandateStatus.toUpperCase()}`);
  console.log(`Verification Status : ${v.status}`);
  console.log(`Blocked Reason Code : ${v.blockedReason}`);

  console.log('\n--- 4-Point Safety Checks Detail ---');
  for (const c of v.checks) {
    const icon = c.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`  [${icon}] ${c.check.padEnd(24)}: ${c.reason}`);
  }

  // 5. Audit Trail Verification
  console.log('\n================ HASH-CHAINED EVENT AUDIT ================');
  const events = await eventStore.getAllEvents();
  const recentEvents = events.slice(-3);
  for (const ev of recentEvents) {
    console.log(
      `  [Seq ${String(ev.sequenceNumber).padStart(2)}] Event: ${ev.eventType.padEnd(24)} | Actor: ${ev.actor.padEnd(20)} | Hash: ${ev.hash.slice(0, 16)}...`,
    );
  }

  const integrity = await eventStore.verifyChainIntegrity();
  console.log(
    `\nLedger Integrity Status: ${integrity.valid ? 'VALID (100% Intact Chain)' : 'INVALID'}`,
  );
  console.log('================================================================\n');

  // Clean up test override
  RazorpayClient.clearSimulatedLiveOverrides();
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  runStaleCacheDemoCli()
    .then(() => closePool())
    .catch((err) => {
      console.error('[Verification Demo] Fatal error:', err);
      process.exit(1);
    });
}
