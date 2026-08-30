import dotenv from 'dotenv';
import {
  BatchRiskRunner,
  getPool,
  closePool,
  type BatchRiskAnalysisResult,
} from '@recovery/server';

dotenv.config();

export async function runRiskAnalysisCli(): Promise<BatchRiskAnalysisResult> {
  const pool = getPool();
  const runner = new BatchRiskRunner(undefined, pool);

  console.log('[Risk Intelligence] Running batch risk scoring & ERV analysis across all instruments...');
  const result = await runner.runBatchAnalysis();

  console.log('\n================ RISK INTELLIGENCE BATCH SUMMARY ================');
  console.log(`Total Instruments Evaluated : ${result.totalInstrumentsEvaluated}`);
  console.log(`Total Monthly ARR at Risk   : ₹${result.totalMonthlyAmountAtRiskRupees.toLocaleString('en-IN')}`);
  console.log(`Total Expected Recovery (ERV): ₹${result.totalExpectedRecoveryValueRupees.toLocaleString('en-IN')}`);

  console.log('\n--- Trajectory Breakdown ---');
  console.log(`HEALTHY (Score >= 0.70)   : ${result.countsByTrajectory.HEALTHY}`);
  console.log(`DEGRADING (0.30 - 0.69)   : ${result.countsByTrajectory.DEGRADING}`);
  console.log(`TERMINAL (Score < 0.30)   : ${result.countsByTrajectory.TERMINAL}`);

  console.log('\n--- Root Cause Taxonomy Distribution ---');
  for (const [cause, count] of Object.entries(result.countsByRootCause)) {
    if (count > 0) {
      console.log(`  - ${cause.padEnd(25)}: ${count}`);
    }
  }

  console.log('\n================ TOP-10 ERV OPPORTUNITY QUEUE ================');
  console.log(
    'Rank | Instrument ID | Sub ID | Rail | Health | Trajectory | RecovProb | Monthly ₹ | Expected Recovery (ERV) | Recommended Action',
  );
  console.log('-'.repeat(120));

  const top10 = result.opportunityQueue.slice(0, 10);
  for (const item of top10) {
    console.log(
      `${String(item.rank).padEnd(4)} | ` +
        `${item.instrumentId.padEnd(13)} | ` +
        `${(item.subscriptionId || 'none').padEnd(14)} | ` +
        `${item.rail.padEnd(11)} | ` +
        `${item.healthScore.toFixed(2).padEnd(6)} | ` +
        `${item.trajectory.padEnd(10)} | ` +
        `${(item.recoveryProbability * 100).toFixed(0).padStart(3)}%     | ` +
        `₹${item.monthlyAmountRupees.toLocaleString('en-IN').padStart(9)} | ` +
        `₹${item.expectedRecoveryValueRupees.toLocaleString('en-IN').padStart(10)} (${item.recommendedAction})`,
    );
  }
  console.log('==============================================================\n');

  return result;
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  runRiskAnalysisCli()
    .then(() => closePool())
    .catch((err) => {
      console.error('[Risk Intelligence] Fatal error:', err);
      process.exit(1);
    });
}
