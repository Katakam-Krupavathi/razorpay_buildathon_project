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

export interface DbRecoveryOutcome {
  outcome_id: string;
  invoice_id: string;
  subscription_id: string;
  recovered_amount: number;
  cost_incurred: number;
  net_value_recovered: number;
  status: string;
  completed_at: string;
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
// Recovery Planner & Strategies
// ============================================================================

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
// Policy Engine (Permit / Deny / Throttle)
// ============================================================================

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

export interface CircuitBreakerMetrics {
  totalAttemptsInWindow: number;
  failedAttemptsInWindow: number;
  failureRatePercentage: number;
  state: CircuitBreakerState;
  lastStateChange: string;
  tripReason?: string;
}

// ============================================================================
// Net Value Recovered (NVR) & Attribution
// ============================================================================

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
