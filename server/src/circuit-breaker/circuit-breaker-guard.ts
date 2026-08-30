import type {
  PolicyDecisionRecord,
  StoredEvent,
} from '@recovery/shared';
import { CohortCircuitBreaker } from './circuit-breaker.js';
import { EventStore } from '../event-store/event-store.js';

export interface GuardEvaluationResult {
  allowed: boolean;
  decision: PolicyDecisionRecord;
  interceptedEvent?: StoredEvent<PolicyDecisionRecord>;
}

export interface CircuitBreakerInterceptedPayload {
  cohortKey: string;
  originalDecisionId: string;
  originalAction: string;
  overriddenAction: string;
  reason: string;
  evaluatedAt: string;
}

/**
 * Circuit Breaker Pipeline Guard.
 *
 * Sits between the Policy Engine and the downstream Verification/Execution layers.
 * If the targeted cohort's circuit breaker is OPEN, automatically intercepts and converts
 * the action to BLOCK / manual escalation, logging an immutable audit event.
 */
export class CircuitBreakerGuard {
  private circuitBreaker: CohortCircuitBreaker;
  private eventStore?: EventStore;

  constructor(circuitBreaker: CohortCircuitBreaker, eventStore?: EventStore) {
    this.circuitBreaker = circuitBreaker;
    this.eventStore = eventStore;
  }

  /**
   * Helper to derive the cohort key for an instrument/policy decision.
   */
  static deriveCohortKey(rail: string, bankCode?: string): string {
    if (bankCode) {
      return `rail:${rail}:bank:${bankCode.toUpperCase()}`;
    }
    return `rail:${rail}`;
  }

  /**
   * Evaluates a policy decision through the cohort circuit breaker.
   */
  async evaluateDecision(
    decision: PolicyDecisionRecord,
    cohortKey: string,
    now: Date = new Date(),
  ): Promise<GuardEvaluationResult> {
    // If policy already decided NO_ACTION or BLOCK, let it pass as-is
    if (decision.result === 'NO_ACTION' || decision.result === 'BLOCK') {
      return { allowed: true, decision };
    }

    const evaluation = this.circuitBreaker.evaluate(cohortKey, now);

    // If Circuit Breaker is OPEN -> INTERCEPT & OVERRIDE
    if (!evaluation.allowed) {
      const nowIso = now.toISOString();
      const modifiedDecision: PolicyDecisionRecord = {
        ...decision,
        result: 'BLOCK',
        finalAction: 'escalate',
        reason: evaluation.overrideReason || `Circuit breaker is OPEN for cohort '${cohortKey}'. Automated execution intercepted; converted to manual escalation.`,
        ruleIdMatched: 'CIRCUIT-BREAKER-OPEN-001',
        evaluatedAt: nowIso,
        parameters: {
          ...decision.parameters,
          circuitBreakerState: 'OPEN',
          originalAction: decision.finalAction,
        },
      };

      let interceptedEvent: StoredEvent<PolicyDecisionRecord> | undefined;

      if (this.eventStore) {
        interceptedEvent = await this.eventStore.appendEvent<PolicyDecisionRecord>({
          subscriptionId: decision.subscriptionId,
          instrumentId: decision.instrumentId,
          eventType: 'circuit_breaker_intercepted',
          actor: 'circuit_breaker',
          payload: modifiedDecision,
          createdAt: nowIso,
        });
      }

      return {
        allowed: false,
        decision: modifiedDecision,
        interceptedEvent,
      };
    }

    // Breaker is CLOSED / HALF_OPEN -> ALLOW
    return {
      allowed: true,
      decision,
    };
  }
}
