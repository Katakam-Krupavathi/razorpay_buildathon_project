/**
 * Autonomous Revenue Recovery Control Plane - Shared Domain Types & Contracts
 * Phase 0: Base Scaffolding & Shared Data Models
 */

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
  aggregateId: string; // e.g., invoiceId or subscriptionId
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
  churnPropensityScore: number; // 0.00 to 1.00 (higher = higher risk of churn on friction)
  interventionCost: number; // cost of sending SMS/WhatsApp/retry attempt
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
