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
  const now = Date.now();
  const instId = `inst_${subscriptionId.replace('sub_synth_', '').replace('sub_', '')}`;

  return {
    entityId: subscriptionId,
    subscriptionId,
    instrumentId: instId,
    rail: 'card',
    mandateStatus: 'active',
    annualizedValuePaise: 97509780,
    totalEventsCount: 8,
    chainValid: true,
    assembledAt: new Date().toISOString(),
    narrative: `Because: 1 recent failure detected with root cause 'CARD_EXPIRY_RISK' (Trajectory: DEGRADING, Health Score: 45%). AI Reasoning Engine proposed 'proactive_token_update' with 96% confidence citing ledger hash 7ebe1f928b. Deterministic policy permitted action under RBI ₹15,000 compliance limits. Verification Gateway confirmed 4/4 zero-trust invariants. Recovered ₹81,258.15 attributed as proactive save.`,
    currentHealth: {
      instrumentId: instId,
      healthScore: 0.4575,
      riskScore: 0.5425,
      trajectory: 'DEGRADING',
      rootCause: 'CARD_EXPIRY_RISK',
      evaluatedAt: new Date(now - 3600000).toISOString(),
      featureVector: {
        subscription_id: subscriptionId,
        instrument_id: instId,
        rail: 'card',
        consecutive_failures: 1,
        failure_velocity_24h: 1,
        failure_velocity_72h: 1,
        days_to_expiry: 14,
        amount_paise: 8125815,
        exceeds_afa_cap: false,
        last_failure_code: 'CARD_EXPIRY_RISK',
        has_backup_instrument: false,
        customer_contact_count_cycle: 0,
        recovery_rate_cohort: 0.88,
      },
    },
    currentPlan: {
      plan_id: `plan_${subscriptionId}`,
      subscription_id: subscriptionId,
      instrument_id: instId,
      action_type: 'proactive_token_update',
      priority_rank: 1,
      expected_recovery_value: 5733575,
      confidence_score: 0.96,
      ai_explanation: 'Card token expires in 14 days. Initiating proactive customer token rotation before hard billing cycle decline occurs.',
      status: 'executed',
      created_at: new Date(now - 3000000).toISOString(),
    },
    currentPolicyDecision: {
      decision_id: `pol_${subscriptionId}`,
      subscription_id: subscriptionId,
      instrument_id: instId,
      rule_evaluated: 'CARD_PROACTIVE_EXPIRY_PERMITTED',
      decision: 'PERMITTED',
      reason: 'Proactive token update complies with RBI ₹15,000 AFA rules and is within 1-nudge cycle limit.',
      cooldown_until: null,
      evaluated_at: new Date(now - 2400000).toISOString(),
    },
    currentOutcome: {
      outcome_id: `out_${subscriptionId}`,
      subscription_id: subscriptionId,
      instrument_id: instId,
      recovery_type: 'proactive',
      recovered_amount: 8125815,
      revenue_saved: 8125815,
      status: 'succeeded',
      completed_at: new Date(now - 1200000).toISOString(),
    },
    escalation: null,
    steps: [
      {
        stage: 'detected',
        title: 'Payment Instrument Degradation Detected',
        timestamp: new Date(now - 7200000).toISOString(),
        actor: 'system:ingestion',
        eventId: 'evt_ingest_7ebe1f928b',
        summary: 'Incoming webhook or risk monitor recorded card expiration proximity (14 days remaining).',
        details: { rail: 'card', days_to_expiry: 14, consecutive_failures: 1 },
      },
      {
        stage: 'diagnosed',
        title: '11-Dimension Feature Vector & Health Scored',
        timestamp: new Date(now - 6000000).toISOString(),
        actor: 'engine:risk-scorer',
        eventId: 'evt_risk_b076249ba6',
        summary: 'Health Score evaluated to 0.4575 (DEGRADING). Root Cause categorized as CARD_EXPIRY_RISK.',
        details: { healthScore: 0.4575, trajectory: 'DEGRADING', rootCause: 'CARD_EXPIRY_RISK' },
      },
      {
        stage: 'proposed',
        title: 'AI Diagnostic Reasoning Synthesized',
        timestamp: new Date(now - 4800000).toISOString(),
        actor: 'ai:reasoning-engine',
        eventId: 'evt_ai_168416e9cf',
        summary: 'AI Engine proposed proactive_token_update with 96% confidence and cited ledger event evt_risk_b076249ba6.',
        details: { action: 'proactive_token_update', confidence: 0.96, ervPaise: 5733575 },
      },
      {
        stage: 'permitted',
        title: 'Deterministic Rail Policy Evaluated',
        timestamp: new Date(now - 3600000).toISOString(),
        actor: 'policy:engine',
        eventId: 'evt_pol_e098fd576a',
        summary: 'Policy PERMITTED action: Complies with RBI AFA rules, cooldown windows, and 1-nudge/cycle limit.',
        details: { rule: 'CARD_EXPIRY_PROACTIVE_PERMITTED', decision: 'PERMITTED' },
      },
      {
        stage: 'circuit_breaker_check',
        title: 'Cohort Circuit Breaker Evaluated',
        timestamp: new Date(now - 2400000).toISOString(),
        actor: 'circuit-breaker:redis',
        eventId: 'evt_cb_21d54a7244',
        summary: 'Cohort rail:card circuit breaker state is CLOSED. Issuing bank healthy (Failure rate: 6.25% < 50%).',
        details: { cohortKey: 'rail:card', state: 'CLOSED', failureRate: 0.0625 },
      },
      {
        stage: 'verified',
        title: 'Zero-Trust Safety Pre-Flight Verified',
        timestamp: new Date(now - 1800000).toISOString(),
        actor: 'verification:gateway',
        eventId: 'evt_vg_895f39a350',
        summary: '4/4 zero-trust checks passed: Mandate active, lock acquired, cooldown elapsed, not duplicate.',
        details: { checksPassed: 4, checksTotal: 4, status: 'VERIFIED_SAFE' },
      },
      {
        stage: 'executed',
        title: 'Recovery Action Executed Safely',
        timestamp: new Date(now - 1200000).toISOString(),
        actor: 'execution:service',
        eventId: 'evt_exec_3cb354b098',
        summary: 'Dispatched proactive token update notification link to customer. Token successfully updated.',
        details: { action: 'proactive_token_update', status: 'SUCCEEDED' },
      },
      {
        stage: 'outcome',
        title: 'Counterfactual Financial Attribution Recorded',
        timestamp: new Date(now - 600000).toISOString(),
        actor: 'attribution:service',
        eventId: 'evt_attr_c130d33718',
        summary: 'Recovered: ₹81,258.15. Recovery Type: Proactive. Counterfactual Net Saved recorded in SHA-256 ledger.',
        details: { recoveredAmountPaise: 8125815, recoveryType: 'proactive', netValueSavedPaise: 8125815 },
      },
    ],
  };
}
