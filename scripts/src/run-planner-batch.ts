import dotenv from 'dotenv';
import {
  RecoveryPlannerService,
  getPool,
  closePool,
  type ProposedActionRecord,
  type PlannerActionType,
} from '@recovery/server';

dotenv.config();

export interface PlannerBatchResult {
  totalInstrumentsPlanned: number;
  countsByAction: Record<PlannerActionType, number>;
  sampleProposals: ProposedActionRecord[];
}

export async function runPlannerBatchCli(): Promise<PlannerBatchResult> {
  const pool = getPool();
  const service = new RecoveryPlannerService(undefined, pool);

  console.log('[Recovery Planner] Running batch planning across all instruments...');

  const instrumentsRes = await pool.query<{ instrument_id: string }>(
    'SELECT instrument_id FROM instruments ORDER BY created_at ASC;',
  );
  const instruments = instrumentsRes.rows;

  const countsByAction: Record<PlannerActionType, number> = {
    NO_ACTION: 0,
    schedule_retry: 0,
    proactive_nudge: 0,
    grace_period: 0,
    pause: 0,
    escalate: 0,
    retry: 0,
  };

  const proposals: ProposedActionRecord[] = [];

  for (const row of instruments) {
    const result = await service.planAndLog(row.instrument_id);
    countsByAction[result.proposal.proposedAction]++;
    proposals.push(result.proposal);
  }

  console.log('\n================ RECOVERY PLANNER BATCH SUMMARY ================');
  console.log(`Total Instruments Evaluated : ${instruments.length}`);
  console.log(`Total Proposals Generated   : ${proposals.length}`);

  console.log('\n--- Proposed Action Distribution ---');
  for (const [action, count] of Object.entries(countsByAction)) {
    const pct = instruments.length > 0 ? ((count / instruments.length) * 100).toFixed(1) : '0';
    console.log(`  - ${action.padEnd(20)}: ${String(count).padStart(3)} (${pct}%)`);
  }

  console.log('\n================ SAMPLE PROPOSALS (REASONING AUDIT) ================');
  const sampleSelection = proposals.slice(0, 8);
  for (const p of sampleSelection) {
    console.log(
      `\n[${p.proposedAction.toUpperCase()}] Instrument: ${p.instrumentId} | ERV: ₹${p.expectedRecoveryValueRupees.toLocaleString('en-IN')}`,
    );
    console.log(`  Root Cause: ${p.rootCause} | Confidence: ${(p.confidence * 100).toFixed(0)}%`);
    console.log(`  Reasoning : "${p.reasoning}"`);
  }
  console.log('\n====================================================================\n');

  return {
    totalInstrumentsPlanned: instruments.length,
    countsByAction,
    sampleProposals: proposals,
  };
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  runPlannerBatchCli()
    .then(() => closePool())
    .catch((err) => {
      console.error('[Recovery Planner] Fatal error:', err);
      process.exit(1);
    });
}
