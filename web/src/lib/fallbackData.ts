import type {
  AttributionScorecard,
  OpportunityQueueItem,
  InstrumentListItem,
  CircuitBreakerStatus,
  DecisionTrace,
} from '@recovery/shared';
import rawOpportunities from './opportunities.json';
import rawInstruments from './instruments.json';

export const fallbackScorecard: AttributionScorecard = {
  totalMonitoredMRRPaise: 86860847,
  totalMonitoredARRPaise: 1042330164,
  totalAtRiskMRRPaise: 191979588,
  totalRecoveredMRRPaise: 57474710,
  proactiveRecoveredMRRPaise: 11224039,
  reactiveRecoveredMRRPaise: 46250671,
  revenuePreventedMRRPaise: 41915897,
  untouchedMRRPaise: 374938327,
  unsafeBlockedActionsCount: 86,
  totalSubscriptionsCount: 100,
  recoveredSubscriptionsCount: 62,
  proactiveSubscriptionsCount: 6,
  reactiveSubscriptionsCount: 56,
  untouchedSubscriptionsCount: 434,
  escalatedSubscriptionsCount: 114,
  recoveryRatePercent: 30,
  netValueRecoveredPaise: 57471560,
  timestamp: new Date().toISOString(),
};

export const fallbackOpportunities: OpportunityQueueItem[] = (
  rawOpportunities && Array.isArray((rawOpportunities as { data?: OpportunityQueueItem[] }).data)
    ? (rawOpportunities as { data: OpportunityQueueItem[] }).data
    : []
);

export const fallbackInstruments: InstrumentListItem[] = (
  rawInstruments && Array.isArray((rawInstruments as { data?: InstrumentListItem[] }).data)
    ? (rawInstruments as { data: InstrumentListItem[] }).data
    : []
);

export const fallbackCircuitBreakers: CircuitBreakerStatus[] = [
  {
    cohortKey: 'rail:card',
    state: 'CLOSED',
    totalAttemptsInWindow: 48,
    failedAttemptsInWindow: 3,
    successAttemptsInWindow: 45,
    currentSuccessRate: 0.9375,
    failureRate: 0.0625,
    trippedAt: null,
    cooldownUntil: null,
    openReason: null,
    lastOutcomeAt: new Date().toISOString(),
  },
  {
    cohortKey: 'rail:upi_autopay',
    state: 'CLOSED',
    totalAttemptsInWindow: 36,
    failedAttemptsInWindow: 2,
    successAttemptsInWindow: 34,
    currentSuccessRate: 0.9444,
    failureRate: 0.0556,
    trippedAt: null,
    cooldownUntil: null,
    openReason: null,
    lastOutcomeAt: new Date().toISOString(),
  },
  {
    cohortKey: 'rail:enach',
    state: 'CLOSED',
    totalAttemptsInWindow: 16,
    failedAttemptsInWindow: 1,
    successAttemptsInWindow: 15,
    currentSuccessRate: 0.9375,
    failureRate: 0.0625,
    trippedAt: null,
    cooldownUntil: null,
    openReason: null,
    lastOutcomeAt: new Date().toISOString(),
  },
];

export function getFallbackDecisionTrace(subscriptionId: string): DecisionTrace {
  return {
    traceId: `trace_${subscriptionId}_demo`,
    subscriptionId,
    timestamp: new Date().toISOString(),
    evaluationTimeMs: 42,
    riskAssessment: {
      healthScore: 0.38,
      trajectory: 'DEGRADING',
      rootCause: 'INSUFFICIENT_FUNDS',
      consecutiveFailures: 2,
      velocity: 0.65,
      features: {
        subscription_id: subscriptionId,
        instrument_id: `inst_${subscriptionId.replace('sub_', '')}`,
        rail: 'upi_autopay',
        consecutive_failures: 2,
        failure_velocity_24h: 1,
        failure_velocity_72h: 2,
        days_to_expiry: 180,
        amount_paise: 849900,
        exceeds_afa_cap: false,
        last_failure_code: 'INSUFFICIENT_FUNDS',
        has_backup_instrument: false,
        customer_contact_count_cycle: 0,
        recovery_rate_cohort: 0.72,
      },
    },
    ervAssessment: {
      amountPaise: 849900,
      recoveryProbability: 0.85,
      expectedRecoveryValuePaise: 722415,
      priorityRank: 1,
      ltvTier: 'growth',
    },
    aiDiagnosis: {
      diagnosis: 'AI diagnostic engine detected recurring salary-cycle mismatch failure with high historical cohort recovery probability (85%). Recommending intelligent retry window aligned to next working day 09:00 AM IST.',
      root_cause: 'INSUFFICIENT_FUNDS',
      risk: 'DEGRADING',
      recommendation: 'smart_retry_optimal_window',
      confidence: 0.94,
      evidence_event_ids: ['e_ledger_sha256_01', 'e_ledger_sha256_02'],
    },
    policyDecision: {
      permitted: true,
      action: 'smart_retry_optimal_window',
      reason: 'Complies with RBI ₹15,000 AFA rules, cooldown period satisfied (36h > 24h), and within 1-nudge cycle cap.',
      cooldownExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    },
    circuitBreaker: {
      cohortKey: 'rail:upi_autopay',
      state: 'CLOSED',
      failureRate: 0.055,
      permitted: true,
    },
    verificationGate: {
      verified: true,
      status: 'VERIFIED_SAFE',
      checks: [
        { name: 'Subscription Active & Not Cancelled', passed: true, detail: 'Status confirmed ACTIVE' },
        { name: 'Instrument Not Expired / Revoked', passed: true, detail: 'UPI mandate active' },
        { name: 'Cooldown Elapsed', passed: true, detail: 'Elapsed: 36h >= 24h min' },
        { name: 'No Duplicate In-Flight Execution', passed: true, detail: 'PostgreSQL advisory lock acquired' },
      ],
    },
    executionResult: {
      executed: true,
      actionTaken: 'smart_retry_optimal_window',
      resultStatus: 'SUCCEEDED',
      recoveredAmountPaise: 849900,
      attributionType: 'proactive',
      ledgerEventId: 'evt_rev_rec_demo_sha256_success',
      executedAt: new Date().toISOString(),
    },
    naturalLanguageNarrative: `Autonomous Control Plane evaluated subscription ${subscriptionId}. AI Diagnostic Engine identified a temporary salary-cycle timing mismatch with 94% confidence. Deterministic rail policy approved smart retry presentation. Safety Verification Gateway confirmed 4/4 zero-trust invariants. Action executed and recovered ₹8,499.00 attributed as proactive save.`,
  };
}
