import type {
  InstrumentRail,
  TrajectoryType,
  RootCauseType,
  PlannerActionType,
  PolicyDecisionResultType,
  PolicyDecisionRecord,
} from '@recovery/shared';

export interface CardRailConfig {
  maxAttempts: number;
  nextAttemptOffsetDays: number;
  ruleIdMaxAttempts: string;
  ruleIdOffset: string;
  description: string;
}

export interface UpiRailConfig {
  maxAttempts: number;
  maxRetries: number;
  retryWindowsHours: number[];
  standardAfaThresholdPaise: number;
  categoryAfaThresholdPaise: number;
  categoryMccList: string[];
  ruleIdMaxAttempts: string;
  ruleIdAfaThreshold: string;
  description: string;
}

export interface EnachRailConfig {
  defaultMaxAttempts: number;
  bankOverrides: Record<string, number>;
  ruleIdMaxAttempts: string;
  description: string;
}

export interface GlobalPolicyConfig {
  maxNudgesPerCycle: number;
  staleStatePolicy: 'BLOCK' | 'ALLOW';
  circuitBreaker: 'ENABLED' | 'DISABLED';
  defaultTerminalAction: PlannerActionType;
  defaultTerminalGraceDays: number;
  ruleIdNudgeCap: string;
  ruleIdTerminalGrace: string;
  ruleIdCustomerOptOut: string;
  ruleIdPassThroughNoAction: string;
  ruleIdPassThroughAllow: string;
}

export interface PolicyRulesConfig {
  version: string;
  updatedAt: string;
  complianceNote: string;
  rails: {
    card: CardRailConfig;
    upi_autopay: UpiRailConfig;
    enach: EnachRailConfig;
  };
  global: GlobalPolicyConfig;
}

export interface PolicyContext {
  instrumentId?: string;
  subscriptionId?: string | null;
  rail: InstrumentRail;
  trajectory: TrajectoryType;
  attemptCount: number;
  proposedAction: PlannerActionType;
  rootCause: RootCauseType;
  expectedRecoveryValue: number; // in paise
  ltvTier: string;
  customerContactCountThisCycle: number;
  isCustomerOptOut?: boolean;
  bankCode?: string;
  amountPaise?: number;
  mccCode?: string;
  reasoning?: string;
  evaluatedAt?: string;
}

export interface PolicyDecisionResult {
  result: PolicyDecisionResultType;
  finalAction: PlannerActionType;
  ruleIdMatched: string;
  reason: string;
  modifiedParameters?: Record<string, unknown>;
  evaluatedAt: string;
}

export type { PolicyDecisionRecord, PolicyDecisionResultType };
