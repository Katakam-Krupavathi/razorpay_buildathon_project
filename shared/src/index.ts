/**
 * Autonomous Revenue Recovery Control Plane - Shared Domain Types & Contracts
 * Phase 1: Core Relational Data Model & Hash-Chained Event Store Schemas
 */

// ============================================================================
// Core Database Enums & Entity Models
// ============================================================================

export type InstrumentRail = 'card' | 'upi_autopay' | 'enach';

export type MandateStatusEnum = 'active' | 'paused' | 'revoked' | 'expired';

export interface DbInstrument {
  instrument_id: string;
  subscription_id: string;
  rail: InstrumentRail;
  created_at: string;
  expiry_date: string | null;
  mandate_status: MandateStatusEnum;
  last_synced_at: string;
  ltv_tier: string;
  annualized_value: number; // in minor units (paise)
}

export type SubscriptionStatusEnum =
  | 'authenticated'
  | 'activated'
  | 'active'
  | 'pending'
  | 'halted'
  | 'paused'
  | 'resumed'
  | 'completed'
  | 'cancelled';

export interface DbSubscription {
  subscription_id: string;
  customer_id: string;
  plan_id: string;
  status: SubscriptionStatusEnum;
  current_instrument_id: string | null;
  created_at: string;
  updated_at: string;
}

export type EventActor =
  | 'razorpay_webhook'
  | 'health_scorer'
  | 'recovery_planner'
  | 'policy_engine'
  | 'circuit_breaker'
  | 'verification_gateway'
  | 'execution_engine'
  | 'human';

export interface DbEvent<T = Record<string, unknown>> {
  event_id: string;
  sequence_number: number;
  prev_hash: string;
  hash: string;
  subscription_id: string | null;
  instrument_id: string | null;
  event_type: string;
  payload: T;
  actor: EventActor;
  created_at: string;
}

export interface DbHealthSnapshot {
  snapshot_id: string;
  subscription_id: string;
  risk_score: number;
  failure_category: string;
  churn_probability: number;
  computed_at: string;
}

export interface DbPolicyDecision {
  decision_id: string;
  subscription_id: string;
  decision: string;
  target_action: string;
  evaluated_rules: unknown;
  evaluated_at: string;
}

export type RecoveryType = 'proactive' | 'reactive' | 'none';

export type RecoveryOutcomeStatus =
  | 'recovered'
  | 'halted'
  | 'cancelled'
  | 'untouched'
  | 'in_progress';

export interface DbRecoveryOutcome {
  outcome_id: string;
  invoice_id: string | null;
  subscription_id: string;
  instrument_id: string | null;
  at_risk_amount: number; // in paise
  recovered_amount: number; // in paise
  cost_incurred: number; // in paise
  net_value_recovered: number; // in paise (recovered_amount - cost_incurred)
  recovery_type: RecoveryType;
  status: RecoveryOutcomeStatus;
  estimated_baseline_outcome: string;
  baseline_recovered_estimate: number; // in paise
  revenue_saved: number; // in paise
  counterfactual_details: Record<string, unknown>;
  completed_at: string;
  closed_at: string;
}

// ============================================================================
// Hash-Chained Event Store Contracts
// ============================================================================

export const GENESIS_PREV_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

export interface CreateEventInput<T = Record<string, unknown>> {
  eventId?: string;
  subscriptionId?: string | null;
  instrumentId?: string | null;
  eventType: string;
  payload: T;
  actor: EventActor;
  createdAt?: string | Date;
}

export interface StoredEvent<T = Record<string, unknown>> {
  eventId: string;
  sequenceNumber: number;
  prevHash: string;
  hash: string;
  subscriptionId: string | null;
  instrumentId: string | null;
  eventType: string;
  payload: T;
  actor: EventActor;
  createdAt: string;
}

export interface ChainIntegrityResult {
  valid: boolean;
  verifiedCount: number;
  errors: string[];
  tipHash: string | null;
  tipSequenceNumber: number;
}

// ============================================================================
// Mandate & Razorpay Subscription Types
// ============================================================================

export type MandateAuthType = 'upi_autopay' | 'card' | 'netbanking' | 'nach';

export type MandateStatus =
  'created' | 'authenticated' | 'active' | 'paused' | 'revoked' | 'expired' | 'failed';

export interface RazorpayMandate {
  id: string;
  customerId: string;
  subscriptionId?: string;
  authType: MandateAuthType;
  status: MandateStatus;
  maxAmount: number; // in minor units (e.g. paise)
  currency: string;
  token?: string;
  bankName?: string;
  accountNumberMasked?: string;
  vpa?: string;
  createdAt: string;
  updatedAt: string;
}

export type RazorpayWebhookEvent =
  | 'subscription.charged'
  | 'subscription.pending'
  | 'subscription.halted'
  | 'subscription.activated'
  | 'subscription.updated'
  | 'subscription.paused'
  | 'subscription.resumed'
  | 'subscription.cancelled'
  | 'subscription.completed';

export interface RazorpaySubscriptionEntity {
  id: string;
  plan_id: string;
  customer_id?: string;
  status: string;
  current_start?: number | null;
  current_end?: number | null;
  ended_at?: number | null;
  quantity?: number;
  notes?: Record<string, unknown>;
  charge_at?: number | null;
  start_at?: number | null;
  end_at?: number | null;
  total_count?: number;
  paid_count?: number;
  customer_notify?: boolean;
  created_at?: number;
  token_id?: string | null;
}

export interface RazorpayPaymentEntity {
  id: string;
  amount: number;
  currency: string;
  status: string;
  order_id?: string | null;
  invoice_id?: string | null;
  subscription_id?: string | null;
  method?: string;
  amount_refunded?: number;
  refund_status?: string | null;
  captured?: boolean;
  description?: string | null;
  card_id?: string | null;
  bank?: string | null;
  wallet?: string | null;
  vpa?: string | null;
  email?: string;
  contact?: string;
  token_id?: string | null;
  error_code?: string | null;
  error_description?: string | null;
  error_source?: string | null;
  error_step?: string | null;
  error_reason?: string | null;
}

export interface RazorpayWebhookPayload {
  entity: 'event';
  account_id: string;
  event: RazorpayWebhookEvent;
  contains: string[];
  payload: {
    subscription?: { entity: RazorpaySubscriptionEntity };
    payment?: { entity: RazorpayPaymentEntity };
    invoice?: { entity: Record<string, unknown> };
    order?: { entity: Record<string, unknown> };
  };
  created_at: number;
}

// ============================================================================
// Event Store & Recovery Event Lifecycle
// ============================================================================

export type RecoveryEventType =
  | 'invoice.payment_failed'
  | 'mandate.authenticated'
  | 'mandate.revoked'
  | 'mandate.paused'
  | 'risk.evaluated'
  | 'erv.computed'
  | 'plan.generated'
  | 'policy.permitted'
  | 'policy.denied'
  | 'policy.throttled'
  | 'circuit_breaker.tripped'
  | 'circuit_breaker.reset'
  | 'recovery.initiated'
  | 'recovery.succeeded'
  | 'recovery.failed'
  | 'recovery.escalated'
  | 'reconciliation.completed'
  | 'attribution.recorded';

export interface RecoveryEvent<T = Record<string, unknown>> {
  id: string;
  eventType: RecoveryEventType;
  aggregateId: string;
  aggregateType: 'invoice' | 'subscription' | 'customer' | 'mandate';
  version: number;
  payload: T;
  metadata: {
    correlationId: string;
    causationId?: string;
    timestamp: string;
    actor: 'system' | 'policy_engine' | 'circuit_breaker' | 'operator' | 'webhook';
  };
}

// ============================================================================
// Risk Intelligence & Failure Cause Taxonomy
// ============================================================================

export type TrajectoryType = 'HEALTHY' | 'DEGRADING' | 'TERMINAL';

export type RootCauseType =
  | 'CARD_EXPIRY_RISK'
  | 'REPEATED_SOFT_DECLINE'
  | 'HARD_DECLINE_PATTERN'
  | 'AFA_PENDING'
  | 'ISSUER_HISTORICAL_RISK'
  | 'MANDATE_INACTIVE'
  | 'UNKNOWN'
  | 'NONE';

export interface RiskFeatureVector {
  failure_count_last_3_cycles: number;
  success_count_total: number;
  consecutive_failures: number;
  days_to_expiry: number | null;
  days_to_expiry_normalized: number | null;
  is_near_card_expiry: boolean;
  decline_code_distribution: Record<string, number>;
  is_over_afa_threshold: boolean;
  mandate_status: string;
  last_event_type: string;
  issuer_prior: number;
}

export interface HealthEvaluationResult {
  snapshotId?: string;
  instrumentId: string;
  subscriptionId: string | null;
  healthScore: number; // 0.0000 - 1.0000
  trajectory: TrajectoryType;
  rootCause: RootCauseType;
  recoveryProbability: number; // 0.0000 - 1.0000
  featureVector: RiskFeatureVector;
  computedAt: string;
}

export type FailureCategory =
  | 'insufficient_funds'
  | 'temporary_bank_downtime'
  | 'mandate_limit_exceeded'
  | 'expired_card_instrument'
  | 'user_cancelled_mandate'
  | 'fraud_risk_block'
  | 'network_timeout'
  | 'unknown';

export interface RiskIntelligenceScore {
  invoiceId: string;
  customerId: string;
  failureCategory: FailureCategory;
  rawErrorCode?: string;
  rawErrorDescription?: string;
  confidenceScore: number; // 0.00 to 1.00
  isRecoverable: boolean;
  recommendedBackoffSeconds: number;
  evaluatedAt: string;
}

// ============================================================================
// Expected Recovery Value (ERV) & Churn Scoring
// ============================================================================

export type RecoveryActionType =
  | 'smart_retry_optimal_window'
  | 'pre_expiry_card_update_link'
  | 'mandate_limit_upgrade_link'
  | 'vpa_collect_request'
  | 'dunning_step_up_auth'
  | 'direct_debit_resubmission'
  | 'manual_escalation';

export interface ERVCalculationResult {
  instrumentId: string;
  subscriptionId: string | null;
  amountAtRisk: number; // in paise
  recoveryProbability: number;
  recommendedAction: RecoveryActionType;
  expectedActionSuccessRate: number;
  expectedRecoveryValue: number; // in paise: amountAtRisk * recoveryProbability * expectedActionSuccessRate
  expectedRecoveryValueRupees: number; // in rupees
  computedAt: string;
}

export interface ERVComputation {
  invoiceId: string;
  invoiceAmount: number; // in paise
  customerLifetimeValue: number; // in paise
  historicalRecoveryProbability: number; // 0.00 to 1.00
  churnPropensityScore: number; // 0.00 to 1.00
  interventionCost: number;
  expectedRecoveryValue: number; // (Probability * Amount) - Cost
  shouldIntervene: boolean;
  computedAt: string;
}

// ============================================================================
// Recovery Planner & Strategies (Zero Execution Authority)
// ============================================================================

export type PlannerActionType =
  | 'retry'
  | 'schedule_retry'
  | 'proactive_nudge'
  | 'grace_period'
  | 'pause'
  | 'escalate'
  | 'NO_ACTION';

export interface ProposedActionRecord {
  proposalId: string;
  instrumentId: string;
  subscriptionId: string | null;
  proposedAction: PlannerActionType;
  rootCause: RootCauseType;
  expectedRecoveryValue: number; // in paise
  expectedRecoveryValueRupees: number; // in rupees
  reasoning: string;
  confidence: number; // 0.00 to 1.00
  parameters: Record<string, unknown>;
  evaluatedAt: string;
}

export type ExecutionRail =
  'upi_autopay' | 'card_charge' | 'dunning_link' | 'whatsapp_pay' | 'manual_escalation';

export interface RecoveryStep {
  stepNumber: number;
  rail: ExecutionRail;
  scheduledAt: string;
  retryAttempt: number;
  maxRetries: number;
  templateId?: string;
}

export interface RecoveryPlan {
  planId: string;
  invoiceId: string;
  customerId: string;
  createdAt: string;
  steps: RecoveryStep[];
  currentStepIndex: number;
  isComplete: boolean;
}

// ============================================================================
// Policy Engine (Permit / Deny / Throttle Gate)
// ============================================================================

export type PolicyDecisionResultType = 'ALLOW' | 'MODIFY' | 'BLOCK' | 'NO_ACTION';

export interface PolicyDecisionRecord {
  decisionId: string;
  instrumentId: string;
  subscriptionId: string | null;
  result: PolicyDecisionResultType;
  proposedAction: PlannerActionType;
  finalAction: PlannerActionType;
  ruleIdMatched: string;
  reason: string;
  evaluatedAt: string;
  parameters?: Record<string, unknown>;
}

export type PolicyDecisionType = 'PERMIT' | 'DENY' | 'THROTTLE';

export interface PolicyRuleResult {
  ruleName: string;
  passed: boolean;
  reason?: string;
}

export interface PolicyEvaluation {
  evaluationId: string;
  decision: PolicyDecisionType;
  targetAction: string;
  ruleResults: PolicyRuleResult[];
  throttleDelaySeconds?: number;
  evaluatedAt: string;
}

// ============================================================================
// Circuit Breaker & Safety Invariants
// ============================================================================

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerStatus {
  cohortKey: string;
  state: CircuitBreakerState;
  totalAttemptsInWindow: number;
  failedAttemptsInWindow: number;
  successAttemptsInWindow: number;
  currentSuccessRate: number; // 0.00 to 1.00
  failureRate: number; // 0.00 to 1.00
  trippedAt: string | null;
  cooldownUntil: string | null;
  openReason: string | null;
  lastOutcomeAt: string | null;
}

export interface CircuitBreakerTrippedPayload {
  cohortKey: string;
  trippedAt: string;
  successRate: number;
  threshold: number;
  windowSize: number;
  totalSamples: number;
  reason: string;
}

export interface CircuitBreakerResetPayload {
  cohortKey: string;
  resetBy: string;
  resetAt: string;
  reason: string;
  previousState: CircuitBreakerState;
}

export interface CircuitBreakerMetrics {
  totalAttemptsInWindow: number;
  failedAttemptsInWindow: number;
  failureRatePercentage: number;
  state: CircuitBreakerState;
  lastStateChange: string;
  tripReason?: string;
}

// ============================================================================
// Safety / Verification Gateway (Pre-Action Checks)
// ============================================================================

export type VerificationCheckName =
  'LIVE_STATE_CHECK' | 'IDEMPOTENCY_CHECK' | 'CIRCUIT_BREAKER_CHECK' | 'POLICY_FRESHNESS_CHECK';

export type VerificationStatus = 'VERIFIED_SAFE' | 'BLOCKED';

export type VerificationBlockReason =
  | 'STALE_STATE_DISAGREEMENT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'CIRCUIT_BREAKER_OPEN'
  | 'POLICY_DECISION_STALE'
  | 'INTERNAL_VERIFICATION_ERROR';

export interface VerificationCheckResult {
  check: VerificationCheckName;
  passed: boolean;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface PreActionVerificationRecord {
  verificationId: string;
  decisionId: string;
  instrumentId: string;
  subscriptionId: string | null;
  status: VerificationStatus;
  blockedReason?: VerificationBlockReason;
  checks: VerificationCheckResult[];
  cachedMandateStatus: string;
  liveMandateStatus: string;
  verifiedAt: string;
}

export interface StaleStateDetectedPayload {
  instrumentId: string;
  subscriptionId: string | null;
  cachedStatus: string;
  liveStatus: string;
  divergenceDetectedAt: string;
  reason: string;
}

// ============================================================================
// Escalation Queue & Workflow
// ============================================================================

export type EscalationStatus = 'pending' | 'resolved' | 'dismissed';

export interface DbEscalationRecord {
  escalation_id: string;
  instrument_id: string;
  subscription_id: string | null;
  reason: string;
  blocked_reason: string | null;
  status: EscalationStatus;
  proposed_action: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_notes: string | null;
}

// ============================================================================
// Notification Provider & Channels
// ============================================================================

export type NotificationChannel = 'email' | 'sms' | 'whatsapp';

export interface NotificationDeliveryResult {
  messageId: string;
  recipient: string;
  channel: NotificationChannel;
  template: string;
  status: 'delivered' | 'failed';
  deliveredAt: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// Execution Layer Types
// ============================================================================

export type ExecutionStatus =
  'executed' | 'scheduled' | 'paused' | 'nudged' | 'escalated' | 'no_op' | 'failed';

export interface ExecutionActionResult {
  actionId: string;
  instrumentId: string;
  subscriptionId: string | null;
  action: PlannerActionType;
  status: ExecutionStatus;
  idempotencyKey: string;
  executedAt: string;
  externalReferenceId?: string;
  details: Record<string, unknown>;
}

// ============================================================================
// End-to-End Recovery Pipeline Orchestration
// ============================================================================

export type PipelineStatus =
  | 'executed'
  | 'escalated'
  | 'blocked_by_policy'
  | 'blocked_by_circuit_breaker'
  | 'blocked_by_verification'
  | 'no_op';

export interface PipelineInstrumentResult {
  instrumentId: string;
  subscriptionId: string | null;
  healthSnapshot: HealthEvaluationResult;
  proposedPlan: ProposedActionRecord;
  policyDecision: PolicyDecisionRecord;
  verification?: PreActionVerificationRecord;
  execution?: ExecutionActionResult;
  escalation?: DbEscalationRecord;
  outcome?: DbRecoveryOutcome;
  pipelineStatus: PipelineStatus;
  completedAt: string;
}

export interface PipelineBatchSummary {
  totalProcessed: number;
  executedCount: number;
  byActionType: Record<string, number>;
  escalatedCount: number;
  blockedByPolicyCount: number;
  blockedByCircuitBreakerCount: number;
  blockedByVerificationCount: number;
  noOpCount: number;
  scorecard?: AttributionScorecard;
  wallClockMs: number;
  completedAt: string;
}

// ============================================================================
// Net Value Recovered (NVR), Outcome Attribution & Counterfactual Models
// ============================================================================

export interface CounterfactualEvaluation {
  instrumentId: string;
  subscriptionId?: string | null;
  recoveryType: RecoveryType;
  atRiskAmountPaise: number;
  recoveredAmountPaise: number;
  estimatedBaselineOutcome: string;
  baselineRecoveredEstimatePaise: number;
  revenueSavedPaise: number;
  method: string;
  confidence: number;
  details: Record<string, unknown>;
}

export interface AttributionScorecard {
  totalMonitoredMRRPaise: number;
  totalMonitoredARRPaise: number;
  totalAtRiskMRRPaise: number;
  totalRecoveredMRRPaise: number;
  proactiveRecoveredMRRPaise: number;
  reactiveRecoveredMRRPaise: number;
  revenuePreventedMRRPaise: number;
  untouchedMRRPaise: number;
  unsafeBlockedActionsCount: number;
  totalSubscriptionsCount: number;
  recoveredSubscriptionsCount: number;
  proactiveSubscriptionsCount: number;
  reactiveSubscriptionsCount: number;
  untouchedSubscriptionsCount: number;
  escalatedSubscriptionsCount: number;
  recoveryRatePercent: number;
  netValueRecoveredPaise: number;
  timestamp: string;
}

export interface RecoveryAttribution {
  attributionId: string;
  invoiceId: string;
  recoveredAmount: number; // paise
  recoveryRail: ExecutionRail;
  costIncurred: number; // paise
  netValueRecovered: number; // recoveredAmount - costIncurred
  autonomousCycleSeconds: number;
  timestamp: string;
}

// ============================================================================
// Phase 11 Decision Trace & Compliance Audit Models
// ============================================================================

export type TraceStage =
  | 'detected'
  | 'diagnosed'
  | 'proposed'
  | 'permitted'
  | 'circuit_breaker_check'
  | 'verified'
  | 'executed'
  | 'escalated'
  | 'blocked'
  | 'outcome';

export interface DecisionTraceStep {
  stage: TraceStage;
  title: string;
  timestamp: string;
  actor: EventActor;
  eventId?: string;
  summary: string;
  details: Record<string, unknown>;
}

export interface DecisionTrace {
  entityId: string;
  subscriptionId: string;
  instrumentId: string;
  rail: string;
  mandateStatus: string;
  annualizedValuePaise: number;
  narrative: string;
  currentHealth: HealthEvaluationResult | null;
  currentPlan: ProposedActionRecord | null;
  currentPolicyDecision: PolicyDecisionRecord | null;
  currentOutcome: DbRecoveryOutcome | null;
  escalation: DbEscalationRecord | null;
  steps: DecisionTraceStep[];
  totalEventsCount: number;
  chainValid: boolean;
  assembledAt: string;
}

export interface GracePeriodAuditItem {
  subscriptionId: string;
  instrumentId: string;
  rail: string;
  annualizedValuePaise: number;
  pausedAt: string;
  rootCause: string;
  reasoning: string;
  matchedRuleId: string;
  gracePeriodDays: number;
  status: string;
}

export interface UpiAutopayCapAuditItem {
  subscriptionId: string;
  instrumentId: string;
  totalAttempts: number;
  maxAllowedAttempts: number;
  compliant: boolean;
  attemptTimestamps: string[];
  outcomes: string[];
  currentMandateStatus: string;
}

export interface StaleStateAuditItem {
  subscriptionId: string;
  instrumentId: string;
  rail: string;
  blockedAt: string;
  attemptedAction: string;
  cachedMandateStatus: string;
  liveMandateStatus: string;
  reason: string;
  escalationId?: string;
}

export interface CircuitBreakerTripAuditItem {
  cohortKey: string;
  rail: string;
  trippedAt: string;
  sampleSize: number;
  failureRate: number;
  threshold: number;
  reason: string;
  currentState: string;
  resetAt?: string | null;
}

export interface ComplianceAuditReport {
  generatedAt: string;
  gracePeriodPauses: GracePeriodAuditItem[];
  upiAutopayCaps: UpiAutopayCapAuditItem[];
  staleStateBlocks: StaleStateAuditItem[];
  circuitBreakerTrips: CircuitBreakerTripAuditItem[];
  summary: {
    totalGracePeriodPauses: number;
    totalUpiInstrumentsAudited: number;
    upiCapComplianceRatePercent: number;
    totalStaleStateBlocks: number;
    totalCircuitBreakerTrips: number;
  };
}

// ============================================================================
// Control Plane System Health & Status
// ============================================================================

export interface ControlPlaneHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptimeSeconds: number;
  database: 'connected' | 'disconnected';
  redis: 'connected' | 'disconnected';
  circuitBreaker: CircuitBreakerState;
  version: string;
  timestamp: string;
}
