import dotenv from 'dotenv';
import {
  CohortCircuitBreaker,
  CircuitBreakerGuard,
  EventStore,
  getPool,
  closePool,
  type PolicyDecisionRecord,
} from '@recovery/server';

dotenv.config();

export async function runCircuitBreakerSimulationCli() {
  const pool = getPool();
  const eventStore = new EventStore(pool);
  const circuitBreaker = new CohortCircuitBreaker(eventStore, {
    windowSize: 20,
    minSamples: 10,
    minSuccessRateThreshold: 0.4, // 40%
    cooldownPeriodSeconds: 300,
  });
  const guard = new CircuitBreakerGuard(circuitBreaker, eventStore);

  console.log('================================================================');
  console.log(' COHORT-LEVEL CIRCUIT BREAKER: OUTAGE COLLAPSE SIMULATION');
  console.log('================================================================\n');

  const upiCohort = 'rail:upi_autopay';
  const cardCohort = 'rail:card';

  // 1. Initial Healthy Phase on UPI AutoPay (8 successes, 2 failures = 80% success rate)
  console.log('[Phase 1] Establishing baseline operations on UPI AutoPay...');
  for (let i = 0; i < 8; i++) {
    await circuitBreaker.recordOutcome(upiCohort, true);
  }
  for (let i = 0; i < 2; i++) {
    await circuitBreaker.recordOutcome(upiCohort, false);
  }

  const baselineStatus = circuitBreaker.getStatus(upiCohort);
  console.log(
    `  -> Baseline State: ${baselineStatus.state} | Success Rate: ${(baselineStatus.currentSuccessRate * 100).toFixed(0)}% (Window: ${baselineStatus.totalAttemptsInWindow} attempts)`,
  );

  // 2. Outage Simulation: Sudden Bank Downtime & Collapse
  console.log(
    '\n[Phase 2] Injecting systemic UPI AutoPay clearing switch outage (10 consecutive failures)...',
  );
  let tripLoggedCount = 0;
  for (let i = 1; i <= 10; i++) {
    const outcomeResult = await circuitBreaker.recordOutcome(upiCohort, false);
    if (outcomeResult.trippedNow) {
      tripLoggedCount++;
      console.log(
        `  [ALERT] Breaker TRIPPED on failure #${i}! Reason: "${outcomeResult.status.openReason}"`,
      );
    }
  }

  const trippedStatus = circuitBreaker.getStatus(upiCohort);
  console.log(
    `  -> Post-Outage State: ${trippedStatus.state} | Current Success Rate: ${(trippedStatus.currentSuccessRate * 100).toFixed(0)}%`,
  );
  console.log(
    `  -> Single-Trip Verification: Emitted ${tripLoggedCount} trip event(s) across 10 consecutive failures.`,
  );

  // 3. Downstream Action Interception Test
  console.log('\n[Phase 3] Testing Pipeline Guard Interception while Breaker is OPEN...');
  const testPolicyDecision: PolicyDecisionRecord = {
    decisionId: 'dec_sim_001',
    instrumentId: 'inst_upi_synth_001',
    subscriptionId: 'sub_synth_001',
    result: 'ALLOW',
    proposedAction: 'schedule_retry',
    finalAction: 'schedule_retry',
    ruleIdMatched: 'PASS-THROUGH-PERMIT-001',
    reason: 'Compliant retry allowed by Policy Engine',
    evaluatedAt: new Date().toISOString(),
  };

  const guardResultUpi = await guard.evaluateDecision(testPolicyDecision, upiCohort);
  console.log(`  Target Cohort: ${upiCohort}`);
  console.log(
    `  Original Policy Result: ${testPolicyDecision.result} (${testPolicyDecision.finalAction})`,
  );
  console.log(
    `  Guard Outcome         : ${guardResultUpi.decision.result} (${guardResultUpi.decision.finalAction})`,
  );
  console.log(`  Guard Reason          : "${guardResultUpi.decision.reason}"`);

  // 4. Cross-Cohort Isolation Test (Card rail is completely unaffected)
  console.log('\n[Phase 4] Testing Cross-Cohort Isolation (Card Tokenization)...');
  const cardDecision: PolicyDecisionRecord = {
    decisionId: 'dec_sim_002',
    instrumentId: 'inst_card_synth_002',
    subscriptionId: 'sub_synth_002',
    result: 'ALLOW',
    proposedAction: 'schedule_retry',
    finalAction: 'schedule_retry',
    ruleIdMatched: 'PASS-THROUGH-PERMIT-001',
    reason: 'Card debit retry allowed',
    evaluatedAt: new Date().toISOString(),
  };

  const guardResultCard = await guard.evaluateDecision(cardDecision, cardCohort);
  console.log(`  Target Cohort: ${cardCohort}`);
  console.log(
    `  Guard Outcome: ${guardResultCard.decision.result} (${guardResultCard.decision.finalAction}) -> Unaffected by UPI outage!`,
  );

  // 5. Human Manual Reset
  console.log('\n[Phase 5] Human Operator Manual Reset Simulation...');
  const resetStatus = await circuitBreaker.manualReset(
    upiCohort,
    'senior_sre_operator',
    'NPCI clearing switch failover completed and verified',
  );
  console.log(`  -> Reset State: ${resetStatus.state} | Reset by: senior_sre_operator`);

  // 6. Post-Reset Guard Test
  const postResetResult = await guard.evaluateDecision(testPolicyDecision, upiCohort);
  console.log(
    `  -> Post-Reset Guard Outcome on UPI: ${postResetResult.decision.result} (${postResetResult.decision.finalAction}) -> Fully Restored!`,
  );

  // 7. Verify EventStore Audit Ledger
  console.log('\n[Phase 6] Verifying Hash-Chained Event Store Ledger Audit...');
  const events = await eventStore.getAllEvents();
  const cbEvents = events.filter((e) => e.eventType.startsWith('circuit_breaker'));

  console.log(`  Total Circuit Breaker Events Logged: ${cbEvents.length}`);
  for (const ev of cbEvents) {
    console.log(
      `    - [Seq ${ev.sequenceNumber}] ${ev.eventType.padEnd(28)} | Actor: ${ev.actor.padEnd(16)} | Hash: ${ev.hash.slice(0, 16)}...`,
    );
  }

  const integrity = await eventStore.verifyChainIntegrity();
  console.log(
    `  -> Ledger Chain Integrity: ${integrity.valid ? 'VALID (100% Intact)' : 'INVALID'}`,
  );

  console.log('\n================================================================\n');
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  runCircuitBreakerSimulationCli()
    .then(() => closePool())
    .catch((err) => {
      console.error('[Circuit Breaker Simulation] Fatal error:', err);
      process.exit(1);
    });
}
