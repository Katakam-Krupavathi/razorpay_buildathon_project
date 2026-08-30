import pg from 'pg';
import type {
  DbInstrument,
  HealthEvaluationResult,
  ERVCalculationResult,
  TrajectoryType,
  RootCauseType,
} from '@recovery/shared';
import { EventStore } from '../event-store/event-store.js';
import { getPool } from '../db/connection.js';
import { HealthService } from './health-service.js';
import type { ScorerOptions } from './scorer.js';
import type { ERVOptions } from './erv-engine.js';

export interface OpportunityQueueItem {
  rank: number;
  instrumentId: string;
  subscriptionId: string | null;
  rail: string;
  ltvTier: string;
  monthlyAmountPaise: number;
  monthlyAmountRupees: number;
  healthScore: number;
  trajectory: TrajectoryType;
  rootCause: RootCauseType;
  recoveryProbability: number;
  recommendedAction: string;
  expectedActionSuccessRate: number;
  expectedRecoveryValuePaise: number;
  expectedRecoveryValueRupees: number;
}

export interface BatchRiskAnalysisResult {
  totalInstrumentsEvaluated: number;
  totalMonthlyAmountAtRiskRupees: number;
  totalExpectedRecoveryValueRupees: number;
  countsByTrajectory: Record<TrajectoryType, number>;
  countsByRootCause: Record<RootCauseType, number>;
  opportunityQueue: OpportunityQueueItem[];
  evaluatedAt: string;
}

export class BatchRiskRunner {
  private pool: pg.Pool;
  private healthService: HealthService;

  constructor(eventStore?: EventStore, pool?: pg.Pool) {
    this.pool = pool || getPool();
    const store = eventStore || new EventStore(this.pool);
    this.healthService = new HealthService(store, this.pool);
  }

  /**
   * Evaluates all instruments in the database and generates a ranked Opportunity Queue
   * sorted in descending order of Expected Recovery Value (ERV).
   */
  async runBatchAnalysis(
    options?: ScorerOptions & ERVOptions,
  ): Promise<BatchRiskAnalysisResult> {
    const instrumentsRes = await this.pool.query<DbInstrument>(
      'SELECT * FROM instruments ORDER BY created_at ASC;',
    );
    const instruments = instrumentsRes.rows;

    const countsByTrajectory: Record<TrajectoryType, number> = {
      HEALTHY: 0,
      DEGRADING: 0,
      TERMINAL: 0,
    };

    const countsByRootCause: Record<RootCauseType, number> = {
      CARD_EXPIRY_RISK: 0,
      REPEATED_SOFT_DECLINE: 0,
      HARD_DECLINE_PATTERN: 0,
      AFA_PENDING: 0,
      ISSUER_HISTORICAL_RISK: 0,
      MANDATE_INACTIVE: 0,
      UNKNOWN: 0,
      NONE: 0,
    };

    const evaluatedItems: Array<{
      instrument: DbInstrument;
      health: HealthEvaluationResult;
      erv: ERVCalculationResult;
    }> = [];

    let totalAmountAtRiskPaise = 0;
    let totalExpectedRecoveryValuePaise = 0;

    for (const instrument of instruments) {
      const evaluation = await this.healthService.evaluateAndPersist(
        instrument.instrument_id,
        options,
      );

      countsByTrajectory[evaluation.health.trajectory]++;
      countsByRootCause[evaluation.health.rootCause]++;

      totalAmountAtRiskPaise += evaluation.erv.amountAtRisk;
      totalExpectedRecoveryValuePaise += evaluation.erv.expectedRecoveryValue;

      evaluatedItems.push({
        instrument,
        health: evaluation.health,
        erv: evaluation.erv,
      });
    }

    // Rank by descending ERV (Highest financial value recovery opportunities first)
    evaluatedItems.sort((a, b) => b.erv.expectedRecoveryValue - a.erv.expectedRecoveryValue);

    const opportunityQueue: OpportunityQueueItem[] = evaluatedItems.map(
      (item, idx) => ({
        rank: idx + 1,
        instrumentId: item.instrument.instrument_id,
        subscriptionId: item.instrument.subscription_id,
        rail: item.instrument.rail,
        ltvTier: item.instrument.ltv_tier,
        monthlyAmountPaise: item.erv.amountAtRisk,
        monthlyAmountRupees: Math.round(item.erv.amountAtRisk / 100),
        healthScore: item.health.healthScore,
        trajectory: item.health.trajectory,
        rootCause: item.health.rootCause,
        recoveryProbability: item.health.recoveryProbability,
        recommendedAction: item.erv.recommendedAction,
        expectedActionSuccessRate: item.erv.expectedActionSuccessRate,
        expectedRecoveryValuePaise: item.erv.expectedRecoveryValue,
        expectedRecoveryValueRupees: item.erv.expectedRecoveryValueRupees,
      }),
    );

    return {
      totalInstrumentsEvaluated: instruments.length,
      totalMonthlyAmountAtRiskRupees: Math.round(totalAmountAtRiskPaise / 100),
      totalExpectedRecoveryValueRupees: Math.round(
        totalExpectedRecoveryValuePaise / 100,
      ),
      countsByTrajectory,
      countsByRootCause,
      opportunityQueue,
      evaluatedAt: new Date().toISOString(),
    };
  }
}
