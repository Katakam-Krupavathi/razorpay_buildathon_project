import type {
  DbInstrument,
  HealthEvaluationResult,
  ProposedActionRecord,
  ExecutionActionResult,
  PreActionVerificationRecord,
  DbRecoveryOutcome,
  RecoveryType,
  RecoveryOutcomeStatus,
  CounterfactualEvaluation,
  AttributionScorecard,
} from '@recovery/shared';

export interface OutcomeEvaluationInput {
  instrument: DbInstrument;
  healthSnapshot?: HealthEvaluationResult | null;
  proposedPlan?: ProposedActionRecord | null;
  execution?: ExecutionActionResult | null;
  verification?: PreActionVerificationRecord | null;
  costIncurredPaise?: number;
  referenceTime?: string | Date;
}

export interface RecordOutcomeParams {
  outcomeId?: string;
  invoiceId?: string | null;
  subscriptionId: string;
  instrumentId: string;
  atRiskAmount: number;
  recoveredAmount: number;
  costIncurred?: number;
  recoveryType: RecoveryType;
  status: RecoveryOutcomeStatus;
  estimatedBaselineOutcome: string;
  baselineRecoveredEstimate: number;
  revenueSaved: number;
  counterfactualDetails?: Record<string, unknown>;
  closedAt?: string | Date;
}

export type {
  DbRecoveryOutcome,
  RecoveryType,
  RecoveryOutcomeStatus,
  CounterfactualEvaluation,
  AttributionScorecard,
};
