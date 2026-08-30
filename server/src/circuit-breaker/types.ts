import type {
  CircuitBreakerState,
  CircuitBreakerStatus,
  CircuitBreakerTrippedPayload,
  CircuitBreakerResetPayload,
} from '@recovery/shared';

export interface CircuitBreakerConfig {
  windowSize: number; // Rolling window of outcomes (e.g. 20)
  minSamples: number; // Minimum samples needed before evaluating threshold (e.g. 10)
  minSuccessRateThreshold: number; // Threshold below which breaker trips (e.g. 0.40 / 40%)
  cooldownPeriodSeconds: number; // Cooldown before transitioning to HALF_OPEN (e.g. 300s)
}

export interface ActionOutcome {
  cohortKey: string;
  success: boolean;
  timestamp?: string | Date;
  metadata?: Record<string, unknown>;
}

export interface CircuitBreakerEvaluation {
  allowed: boolean;
  state: CircuitBreakerState;
  cohortKey: string;
  status: CircuitBreakerStatus;
  overrideReason?: string;
}

export type {
  CircuitBreakerState,
  CircuitBreakerStatus,
  CircuitBreakerTrippedPayload,
  CircuitBreakerResetPayload,
};
