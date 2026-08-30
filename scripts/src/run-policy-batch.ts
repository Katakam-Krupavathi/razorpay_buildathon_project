import dotenv from 'dotenv';
import {
  RecoveryPlannerService,
  PolicyService,
  HealthService,
  getPool,
  closePool,
  type PolicyDecisionRecord,
  type PolicyDecisionResultType,
} from '@recovery/server';
import type { DbInstrument } from '@recovery/shared';

dotenv.config();

export interface PolicyBatchResult {
  totalInstrumentsEvaluated: number;
  countsByResult: Record<PolicyDecisionResultType, number>;
  countsByRuleId: Record<string, number>;
  decisions: PolicyDecisionRecord[];
}

export async function runPolicyBatchCli(): Promise<PolicyBatchResult> {
  const pool = getPool();
  const healthService = new HealthService(undefined, pool);
  const plannerService = new RecoveryPlannerService(undefined, pool);
  const policyService = new PolicyService(undefined, pool);

  console.log('[Policy Engine] Running batch policy evaluation across all instruments...');

  const instrumentsRes = await pool.query<DbInstrument>(
    'SELECT * FROM instruments ORDER BY created_at ASC;',
  );
  const instruments = instrumentsRes.rows;

  const countsByResult: Record<PolicyDecisionResultType, number> = {
    ALLOW: 0,
    MODIFY: 0,
    BLOCK: 0,
    NO_ACTION: 0,
  };

  const countsByRuleId: Record<string, number> = {};
  const decisions: PolicyDecisionRecord[] = [];

  for (const instrument of instruments) {
    // 1. Health evaluation
    const healthResult = await healthService.evaluateAndPersist(instrument.instrument_id);

    // 2. Proposal from Planner
    const planResult = await plannerService.planAndLog(instrument.instrument_id);
    const proposal = planResult.proposal;

    // 3. Policy evaluation
    const attemptCount = healthResult.health.featureVector.consecutive_failures;
    const policyResult = await policyService.evaluateAndLog({
      instrumentId: instrument.instrument_id,
      subscriptionId: instrument.subscription_id,
      rail: instrument.rail,
      trajectory: healthResult.health.trajectory,
      attemptCount,
      proposedAction: proposal.proposedAction,
      rootCause: healthResult.health.rootCause,
      expectedRecoveryValue: healthResult.erv.expectedRecoveryValue,
      ltvTier: instrument.ltv_tier,
      customerContactCountThisCycle: proposal.proposedAction === 'proactive_nudge' ? 0 : 0,
      amountPaise: healthResult.erv.amountAtRisk,
    });

    const dec = policyResult.decision;
    countsByResult[dec.result]++;
    countsByRuleId[dec.ruleIdMatched] = (countsByRuleId[dec.ruleIdMatched] || 0) + 1;
    decisions.push(dec);
  }

  console.log('\n================ POLICY ENGINE BATCH SUMMARY ================');
  console.log(`Total Instruments Evaluated : ${instruments.length}`);
  console.log(`Total Policy Decisions Made : ${decisions.length}`);

  console.log('\n--- Decision Distribution ---');
  for (const [resultType, count] of Object.entries(countsByResult)) {
    const pct = instruments.length > 0 ? ((count / instruments.length) * 100).toFixed(1) : '0';
    console.log(`  - ${resultType.padEnd(12)}: ${String(count).padStart(3)} (${pct}%)`);
  }

  console.log('\n--- Matched Rule ID Distribution ---');
  for (const [ruleId, count] of Object.entries(countsByRuleId)) {
    const pct = instruments.length > 0 ? ((count / instruments.length) * 100).toFixed(1) : '0';
    console.log(`  - ${ruleId.padEnd(28)}: ${String(count).padStart(3)} (${pct}%)`);
  }

  console.log('\n================ SAMPLE POLICY DECISIONS ================');
  const sampleSelection = decisions.slice(0, 8);
  for (const d of sampleSelection) {
    console.log(`\n[${d.result}] Rule: ${d.ruleIdMatched} | Instrument: ${d.instrumentId}`);
    console.log(`  Proposed: ${d.proposedAction.padEnd(16)} -> Final: ${d.finalAction}`);
    console.log(`  Reason  : "${d.reason}"`);
  }
  console.log('=========================================================\n');

  return {
    totalInstrumentsEvaluated: instruments.length,
    countsByResult,
    countsByRuleId,
    decisions,
  };
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  runPolicyBatchCli()
    .then(() => closePool())
    .catch((err) => {
      console.error('[Policy Engine] Fatal error:', err);
      process.exit(1);
    });
}
