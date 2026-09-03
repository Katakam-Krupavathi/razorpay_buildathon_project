import type {
  DbInstrument,
  StoredEvent,
  HealthEvaluationResult,
  RiskFeatureVector,
  RootCauseType,
  TrajectoryType,
  RazorpayWebhookPayload,
} from '@recovery/shared';

export interface ScorerOptions {
  referenceTime?: string | Date;
}

/**
 * Pure Risk Intelligence scoring engine.
 * Computes health_score ∈ [0,1], trajectory, root_cause, recovery_probability, and feature_vector.
 *
 * Scoring Formula:
 * S = S_0 (1.00)
 *   - Penalty(MandateInactive)       [-0.85 if revoked/expired, -0.40 if paused]
 *   - Penalty(HardDecline)           [-0.50]
 *   - Penalty(ConsecutiveFailures)   [-0.20 * min(consecutive_failures, 3)]
 *   - Penalty(RecentFailures)        [-0.15 * min(recent_failures_last_3, 3)]
 *   - Penalty(CardExpiry)            [-0.70 if expired, -0.35 * (1 - days/20) if 0 <= days <= 20]
 *   - Penalty(AfaOverThreshold)      [-0.30 if amount > AFA limit on UPI]
 *   + Bonus(HistoryReliability)      [+0.05 if >= 3 successes and 0 recent failures]
 *
 * Trajectory:
 * - HEALTHY: score >= 0.70
 * - DEGRADING: 0.30 <= score < 0.70
 * - TERMINAL: score < 0.30
 */
export function evaluateInstrumentHealth(
  instrument: DbInstrument,
  events: StoredEvent[],
  options?: ScorerOptions,
): HealthEvaluationResult {
  const refTime = options?.referenceTime ? new Date(options.referenceTime) : new Date();

  // 1. Extract chronological events for this instrument
  const sortedEvents = [...events].sort(
    (a, b) =>
      a.sequenceNumber - b.sequenceNumber ||
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  let successCountTotal = 0;
  let consecutiveFailures = 0;
  const declineCodeDistribution: Record<string, number> = {};
  let hasHardDecline = false;
  let isOverAfaThreshold = false;
  let lastEventType = 'none';

  // Traverse events to gather signals
  const paymentEvents: Array<{ isSuccess: boolean; declineCode?: string; isOverAfa?: boolean }> =
    [];

  for (const event of sortedEvents) {
    lastEventType = event.eventType;

    if (event.eventType === 'subscription.charged') {
      successCountTotal++;
      consecutiveFailures = 0;
      paymentEvents.push({ isSuccess: true });
    } else if (
      event.eventType === 'subscription.pending' ||
      event.eventType === 'invoice.payment_failed' ||
      event.eventType === 'subscription.halted'
    ) {
      consecutiveFailures++;

      const payload = event.payload as unknown as RazorpayWebhookPayload;
      const payment = payload?.payload?.payment?.entity;
      const rawPayload = event.payload as Record<string, unknown>;
      const errorCode =
        payment?.error_code ||
        (rawPayload?.error_code as string) ||
        (rawPayload?.decline_code as string) ||
        (rawPayload?.code as string) ||
        'UNKNOWN_ERROR';

      declineCodeDistribution[errorCode] = (declineCodeDistribution[errorCode] || 0) + 1;

      if (
        errorCode === 'USER_CANCELLED_MANDATE' ||
        errorCode === 'HARD_DECLINE_FRAUD_BLOCK' ||
        errorCode === 'ACCOUNT_BLOCKED' ||
        errorCode === 'MAX_RETRIES_EXCEEDED' ||
        errorCode === 'EXPIRED_CARD' ||
        errorCode === 'CARD_EXPIRED' ||
        errorCode === 'MANDATE_INACTIVE' ||
        errorCode === 'MANDATE_CANCELLED' ||
        errorCode === 'ACCOUNT_CLOSED'
      ) {
        hasHardDecline = true;
      }

      if (errorCode === 'MANDATE_LIMIT_EXCEEDED') {
        isOverAfaThreshold = true;
      }

      paymentEvents.push({
        isSuccess: false,
        declineCode: errorCode,
        isOverAfa: errorCode === 'MANDATE_LIMIT_EXCEEDED',
      });
    }
  }

  // Last 3 payment attempts
  const last3Attempts = paymentEvents.slice(-3);
  const failureCountLast3Cycles = last3Attempts.filter((p) => !p.isSuccess).length;

  // 2. Card Expiry Computations
  let daysToExpiry: number | null = null;
  let daysToExpiryNormalized: number | null = null;
  let isNearCardExpiry = false;
  let isCardExpired = false;

  if (instrument.rail === 'card' && instrument.expiry_date) {
    const expiryDate = new Date(instrument.expiry_date);
    const diffMs = expiryDate.getTime() - refTime.getTime();
    daysToExpiry = Math.floor(diffMs / (86400 * 1000));
    daysToExpiryNormalized = Math.min(1, Math.max(0, daysToExpiry / 90));

    if (daysToExpiry < 0) {
      isCardExpired = true;
    } else if (daysToExpiry <= 20) {
      isNearCardExpiry = true;
    }
  }

  // 3. Scoring Formula Application
  let score = 1.0;

  // Mandate status penalties
  if (instrument.mandate_status === 'revoked' || instrument.mandate_status === 'expired') {
    score -= 0.85;
  } else if (instrument.mandate_status === 'paused') {
    score -= 0.4;
  }

  // Hard decline penalties
  if (hasHardDecline) {
    score -= 0.5;
  }

  // Consecutive trailing failures
  if (consecutiveFailures > 0) {
    score -= 0.2 * Math.min(consecutiveFailures, 3);
  }

  // Recent 3 cycles failure rate
  if (failureCountLast3Cycles > 0) {
    score -= 0.15 * Math.min(failureCountLast3Cycles, 3);
  }

  // Card expiry penalties
  if (instrument.rail === 'card' && daysToExpiry !== null) {
    if (isCardExpired) {
      score -= 0.7;
    } else if (isNearCardExpiry) {
      // Linear penalty from 0 to 20 days: 0 days -> -0.35, 20 days -> -0.00
      const days = Math.max(0, daysToExpiry);
      score -= 0.35 * (1 - days / 20);
    }
  }

  // AFA limit over threshold penalty
  if (isOverAfaThreshold && instrument.rail === 'upi_autopay') {
    score -= 0.3;
  }

  // Reliability bonus for consistent historical success
  if (successCountTotal >= 3 && consecutiveFailures === 0 && failureCountLast3Cycles === 0) {
    score += 0.05;
  }

  // Clamp health score [0.0000, 1.0000]
  const healthScore = Math.min(1.0, Math.max(0.0, Math.round(score * 10000) / 10000));

  // 4. Trajectory Determination
  let trajectory: TrajectoryType;
  if (healthScore >= 0.7) {
    trajectory = 'HEALTHY';
  } else if (healthScore >= 0.3) {
    trajectory = 'DEGRADING';
  } else {
    trajectory = 'TERMINAL';
  }

  // 5. Root Cause Classification
  let rootCause: RootCauseType;
  if (instrument.mandate_status === 'revoked' || instrument.mandate_status === 'expired') {
    rootCause = 'MANDATE_INACTIVE';
  } else if (isCardExpired || (instrument.rail === 'card' && isNearCardExpiry)) {
    rootCause = 'CARD_EXPIRY_RISK';
  } else if (hasHardDecline) {
    rootCause = 'HARD_DECLINE_PATTERN';
  } else if (isOverAfaThreshold && instrument.rail === 'upi_autopay') {
    rootCause = 'AFA_PENDING';
  } else if (failureCountLast3Cycles > 0 || consecutiveFailures > 0) {
    rootCause = 'REPEATED_SOFT_DECLINE';
  } else if (healthScore >= 0.7) {
    rootCause = 'NONE';
  } else {
    rootCause = 'UNKNOWN';
  }

  // 6. Recovery Probability Calculation
  let recoveryProb = 0.5;
  switch (rootCause) {
    case 'NONE':
      recoveryProb = 0.98;
      break;
    case 'CARD_EXPIRY_RISK':
      if (isCardExpired) {
        recoveryProb = 0.25;
      } else if (daysToExpiry !== null) {
        // High recovery if proactive token migration link is triggered early
        recoveryProb = 0.85 - (20 - Math.max(0, daysToExpiry)) * 0.02;
      } else {
        recoveryProb = 0.6;
      }
      break;
    case 'REPEATED_SOFT_DECLINE':
      recoveryProb = Math.max(0.35, Math.min(0.85, healthScore * 0.9));
      break;
    case 'AFA_PENDING':
      recoveryProb = 0.7;
      break;
    case 'HARD_DECLINE_PATTERN':
      recoveryProb = 0.2;
      break;
    case 'MANDATE_INACTIVE':
      recoveryProb = 0.1;
      break;
    case 'UNKNOWN':
    default:
      recoveryProb = 0.4;
      break;
  }

  const recoveryProbability = Math.min(
    1.0,
    Math.max(0.0, Math.round(recoveryProb * 10000) / 10000),
  );

  // 7. Explicit Explainable Feature Vector
  const featureVector: RiskFeatureVector = {
    failure_count_last_3_cycles: failureCountLast3Cycles,
    success_count_total: successCountTotal,
    consecutive_failures: consecutiveFailures,
    days_to_expiry: daysToExpiry,
    days_to_expiry_normalized: daysToExpiryNormalized,
    is_near_card_expiry: isNearCardExpiry,
    decline_code_distribution: declineCodeDistribution,
    is_over_afa_threshold: isOverAfaThreshold,
    mandate_status: instrument.mandate_status,
    last_event_type: lastEventType,
    // Assumed industry baseline recovery priors per payment rail:
    // UPI AutoPay: 88% success prior, Credit/Debit Cards: 82% success prior, eNACH: 75% success prior.
    issuer_prior:
      instrument.rail === 'upi_autopay' ? 0.88 : instrument.rail === 'card' ? 0.82 : 0.75,
  };

  return {
    instrumentId: instrument.instrument_id,
    subscriptionId: instrument.subscription_id,
    healthScore,
    trajectory,
    rootCause,
    recoveryProbability,
    featureVector,
    computedAt: refTime.toISOString(),
  };
}
