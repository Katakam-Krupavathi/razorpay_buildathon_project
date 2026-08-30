import type {
  DbInstrument,
  HealthEvaluationResult,
  ERVCalculationResult,
  ProposedActionRecord,
  PlannerActionType,
} from '@recovery/shared';

export interface PlannerContext {
  instrument: DbInstrument;
  health: HealthEvaluationResult;
  erv: ERVCalculationResult;
  ltvTier?: string;
  customerName?: string;
}

export interface PlannerOptions {
  referenceTime?: string | Date;
  minErvForInterventionRupees?: number; // threshold under which terminal/low LTV gets NO_ACTION
}

export type { ProposedActionRecord, PlannerActionType };
