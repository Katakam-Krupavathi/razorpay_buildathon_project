import type {
  DbInstrument,
  PolicyDecisionRecord,
  PreActionVerificationRecord,
  PlannerActionType,
  ExecutionActionResult,
  ExecutionStatus,
} from '@recovery/shared';

export interface ExecutionContext {
  instrument: DbInstrument;
  decision: PolicyDecisionRecord;
  verification?: PreActionVerificationRecord;
  idempotencyKey: string;
  action: PlannerActionType;
  parameters?: Record<string, unknown>;
  referenceTime?: string | Date;
}

export type { ExecutionActionResult, ExecutionStatus };
