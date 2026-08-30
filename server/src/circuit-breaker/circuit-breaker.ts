import type {
  CircuitBreakerState,
  CircuitBreakerStatus,
  CircuitBreakerTrippedPayload,
  CircuitBreakerResetPayload,
  CircuitBreakerConfig,
  CircuitBreakerEvaluation,
} from './types.js';
import { EventStore } from '../event-store/event-store.js';

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  windowSize: 20,
  minSamples: 10,
  minSuccessRateThreshold: 0.40, // 40% success rate threshold
  cooldownPeriodSeconds: 300, // 5 minutes cooldown
};

interface CohortInternalState {
  cohortKey: string;
  state: CircuitBreakerState;
  outcomes: Array<{ success: boolean; timestamp: string }>;
  trippedAt: string | null;
  cooldownUntil: string | null;
  openReason: string | null;
  lastOutcomeAt: string | null;
}

/**
 * Cohort-Level Rolling-Window Circuit Breaker Engine.
 *
 * Tracks success/failure outcomes per payment rail or issuer cohort.
 * When success rate falls below threshold, trips exactly once and intercepts downstream recovery actions.
 */
export class CohortCircuitBreaker {
  private config: CircuitBreakerConfig;
  private cohorts: Map<string, CohortInternalState> = new Map();
  private eventStore?: EventStore;

  constructor(eventStore?: EventStore, config?: Partial<CircuitBreakerConfig>) {
    this.eventStore = eventStore;
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
  }

  private getOrCreateCohort(cohortKey: string): CohortInternalState {
    let cohort = this.cohorts.get(cohortKey);
    if (!cohort) {
      cohort = {
        cohortKey,
        state: 'CLOSED',
        outcomes: [],
        trippedAt: null,
        cooldownUntil: null,
        openReason: null,
        lastOutcomeAt: null,
      };
      this.cohorts.set(cohortKey, cohort);
    }
    return cohort;
  }

  /**
   * Records an automated recovery action's success/failure outcome.
   * If the rolling window success rate collapses below threshold, trips the breaker exactly once.
   */
  async recordOutcome(
    cohortKey: string,
    success: boolean,
    options?: { timestamp?: string; metadata?: Record<string, unknown> },
  ): Promise<{
    state: CircuitBreakerState;
    trippedNow: boolean;
    successRate: number;
    status: CircuitBreakerStatus;
  }> {
    const cohort = this.getOrCreateCohort(cohortKey);
    const ts = options?.timestamp || new Date().toISOString();

    cohort.lastOutcomeAt = ts;
    cohort.outcomes.push({ success, timestamp: ts });

    // Maintain fixed rolling window size
    if (cohort.outcomes.length > this.config.windowSize) {
      cohort.outcomes.splice(0, cohort.outcomes.length - this.config.windowSize);
    }

    const totalInWindow = cohort.outcomes.length;
    const successes = cohort.outcomes.filter((o) => o.success).length;
    const currentSuccessRate = totalInWindow > 0 ? successes / totalInWindow : 1.0;

    let trippedNow = false;

    // Check transition from CLOSED -> OPEN
    if (cohort.state === 'CLOSED') {
      if (
        totalInWindow >= this.config.minSamples &&
        currentSuccessRate < this.config.minSuccessRateThreshold
      ) {
        // TRIP THE BREAKER (Single-Trip Invariant)
        cohort.state = 'OPEN';
        cohort.trippedAt = ts;
        const cooldownMs = this.config.cooldownPeriodSeconds * 1000;
        cohort.cooldownUntil = new Date(new Date(ts).getTime() + cooldownMs).toISOString();
        cohort.openReason = `Success rate (${(currentSuccessRate * 100).toFixed(1)}%) fell below ${(this.config.minSuccessRateThreshold * 100).toFixed(0)}% threshold in rolling window of ${totalInWindow} actions.`;
        trippedNow = true;

        // Log single trip event into EventStore (actor = 'circuit_breaker')
        if (this.eventStore) {
          await this.eventStore.appendEvent<CircuitBreakerTrippedPayload>({
            eventType: 'circuit_breaker_tripped',
            actor: 'circuit_breaker',
            payload: {
              cohortKey,
              trippedAt: cohort.trippedAt,
              successRate: currentSuccessRate,
              threshold: this.config.minSuccessRateThreshold,
              windowSize: this.config.windowSize,
              totalSamples: totalInWindow,
              reason: cohort.openReason,
            },
            createdAt: ts,
          });
        }
      }
    } else if (cohort.state === 'HALF_OPEN') {
      // In HALF_OPEN, single test success closes breaker; failure re-opens it
      if (success) {
        cohort.state = 'CLOSED';
        cohort.openReason = null;
        cohort.trippedAt = null;
        cohort.cooldownUntil = null;
      } else {
        cohort.state = 'OPEN';
        cohort.trippedAt = ts;
        const cooldownMs = this.config.cooldownPeriodSeconds * 1000;
        cohort.cooldownUntil = new Date(new Date(ts).getTime() + cooldownMs).toISOString();
      }
    }

    return {
      state: cohort.state,
      trippedNow,
      successRate: currentSuccessRate,
      status: this.getStatus(cohortKey, new Date(ts)),
    };
  }

  /**
   * Retrieves current status of a cohort, evaluating time-based cooldown.
   */
  getStatus(cohortKey: string, now: Date = new Date()): CircuitBreakerStatus {
    const cohort = this.getOrCreateCohort(cohortKey);

    // Evaluate time-based automatic transition to HALF_OPEN
    if (cohort.state === 'OPEN' && cohort.cooldownUntil) {
      if (now.getTime() >= new Date(cohort.cooldownUntil).getTime()) {
        cohort.state = 'HALF_OPEN';
      }
    }

    const total = cohort.outcomes.length;
    const successes = cohort.outcomes.filter((o) => o.success).length;
    const failures = total - successes;
    const currentSuccessRate = total > 0 ? successes / total : 1.0;
    const failureRate = total > 0 ? failures / total : 0.0;

    return {
      cohortKey,
      state: cohort.state,
      totalAttemptsInWindow: total,
      failedAttemptsInWindow: failures,
      successAttemptsInWindow: successes,
      currentSuccessRate: Math.round(currentSuccessRate * 10000) / 10000,
      failureRate: Math.round(failureRate * 10000) / 10000,
      trippedAt: cohort.trippedAt,
      cooldownUntil: cohort.cooldownUntil,
      openReason: cohort.openReason,
      lastOutcomeAt: cohort.lastOutcomeAt,
    };
  }

  /**
   * Evaluates if actions targeting this cohort are allowed to proceed.
   */
  evaluate(cohortKey: string, now: Date = new Date()): CircuitBreakerEvaluation {
    const status = this.getStatus(cohortKey, now);
    const allowed = status.state !== 'OPEN';

    return {
      allowed,
      state: status.state,
      cohortKey,
      status,
      overrideReason:
        status.state === 'OPEN'
          ? `Circuit breaker is OPEN for cohort '${cohortKey}' (${status.openReason}). Automated actions suspended; modifying to manual escalation.`
          : undefined,
    };
  }

  /**
   * Manually resets a tripped circuit breaker (human operator action).
   * Appends circuit_breaker_reset event to EventStore (actor = 'human').
   */
  async manualReset(
    cohortKey: string,
    resetBy: string = 'human_operator',
    reason: string = 'Manual operator recovery override',
  ): Promise<CircuitBreakerStatus> {
    const cohort = this.getOrCreateCohort(cohortKey);
    const previousState = cohort.state;
    const now = new Date().toISOString();

    cohort.state = 'CLOSED';
    cohort.outcomes = []; // Clear failed rolling history
    cohort.trippedAt = null;
    cohort.cooldownUntil = null;
    cohort.openReason = null;

    if (this.eventStore) {
      await this.eventStore.appendEvent<CircuitBreakerResetPayload>({
        eventType: 'circuit_breaker_reset',
        actor: 'human',
        payload: {
          cohortKey,
          resetBy,
          resetAt: now,
          reason,
          previousState,
        },
        createdAt: now,
      });
    }

    return this.getStatus(cohortKey, new Date(now));
  }

  /**
   * Returns all active cohort statuses.
   */
  getAllStatuses(now: Date = new Date()): CircuitBreakerStatus[] {
    return Array.from(this.cohorts.keys()).map((key) => this.getStatus(key, now));
  }
}
