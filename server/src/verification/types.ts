import type {
  PolicyDecisionRecord,
  DbInstrument,
  VerificationCheckName,
  VerificationCheckResult,
  VerificationStatus,
  VerificationBlockReason,
  PreActionVerificationRecord,
  StaleStateDetectedPayload,
} from '@recovery/shared';

export interface VerificationContext {
  decision: PolicyDecisionRecord;
  instrument: DbInstrument;
  idempotencyKey: string;
  cohortKey?: string;
  referenceTime?: string | Date;
  policyDecisionCreatedAt?: string | Date;
  maxPolicyAgeSeconds?: number;
}

export interface VerificationGatewayConfig {
  maxPolicyFreshnessAgeSeconds: number; // Max time between policy decision and execution (e.g. 900s / 15 mins)
}

export type {
  VerificationCheckName,
  VerificationCheckResult,
  VerificationStatus,
  VerificationBlockReason,
  PreActionVerificationRecord,
  StaleStateDetectedPayload,
};
