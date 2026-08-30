import type { CounterfactualEvaluation, RecoveryType, RecoveryOutcomeStatus } from '@recovery/shared';
import type { OutcomeEvaluationInput } from './types.js';

/**
 * Counterfactual Engine.
 *
 * Evaluates the financial impact and estimated baseline outcome ("what would have happened without the autonomous agent").
 *
 * Core Heuristic Models:
 * 1. PROACTIVE INTERVENTION (e.g. Card Expiry Nudge before billing failure):
 *    - Baseline: Standard rail behavior without agent is silent failure on expiry date, followed by payment failure,
 *      exhausting retries, and customer churn.
 *    - Organic recovery rate without nudge: 15% (self-serve card updates).
 *    - Revenue Saved = Recovered Amount - (0.15 * At-Risk Amount) = 85% net prevented loss.
 *
 * 2. REACTIVE RECOVERY (e.g. Smart Rail-Timed Retry after soft decline):
 *    - Baseline: Naive immediate retry without optimal schedule window or circuit-breaker protection.
 *    - Naive baseline recovery rate: 30%.
 *    - Revenue Saved = Recovered Amount - (0.30 * At-Risk Amount) = 70% net attributed uplift.
 *
 * 3. NO-ACTION / UNTOUCHED (Healthy instrument):
 *    - Baseline: Continues healthy recurring lifecycle. Revenue Saved = 0 (untouched).
 */
export class CounterfactualEngine {
  /**
   * Evaluates the outcome attribution and counterfactual uplift for an executed recovery step.
   */
  evaluate(input: OutcomeEvaluationInput): CounterfactualEvaluation {
    const monthlyAmountPaise = Math.round(Number(input.instrument.annualized_value) / 12);
    const failureCount = input.healthSnapshot?.featureVector.failure_count_last_3_cycles ?? 0;
    const trajectory = input.healthSnapshot?.trajectory ?? 'HEALTHY';
    const rootCause = input.proposedPlan?.rootCause ?? 'NONE';
    const action = input.execution?.action ?? 'NO_ACTION';
    const executionStatus = input.execution?.status ?? 'no_op';

    let recoveryType: RecoveryType = 'none';
    let status: RecoveryOutcomeStatus = 'untouched';
    let atRiskAmountPaise = 0;
    let recoveredAmountPaise = 0;
    let estimatedBaselineOutcome = 'total_loss';
    let baselineRecoveredEstimatePaise = 0;
    let revenueSavedPaise = 0;
    let confidence = 0.85;
    let method = 'deterministic_heuristic_model';

    // 1. Proactive Recovery Path
    if (
      action === 'proactive_nudge' ||
      (rootCause === 'CARD_EXPIRY_RISK' && failureCount === 0 && (action === 'schedule_retry' || action === 'retry'))
    ) {
      recoveryType = 'proactive';
      status = 'recovered';
      atRiskAmountPaise = monthlyAmountPaise;
      recoveredAmountPaise = monthlyAmountPaise;
      estimatedBaselineOutcome = 'card_expiry_exhaustion_churn';

      // 15% organic baseline recovery rate
      baselineRecoveredEstimatePaise = Math.round(monthlyAmountPaise * 0.15);
      revenueSavedPaise = Math.max(0, recoveredAmountPaise - baselineRecoveredEstimatePaise);
      confidence = 0.90;
      method = 'proactive_card_expiry_counterfactual';
    }
    // 2. Reactive Recovery Path (smart retry after failure)
    else if (
      (action === 'retry' || action === 'schedule_retry') &&
      (executionStatus === 'executed' || executionStatus === 'scheduled')
    ) {
      recoveryType = 'reactive';
      status = 'recovered';
      atRiskAmountPaise = monthlyAmountPaise;
      recoveredAmountPaise = monthlyAmountPaise;
      estimatedBaselineOutcome = 'naive_immediate_retry_exhaustion';

      // 30% naive immediate retry success rate
      baselineRecoveredEstimatePaise = Math.round(monthlyAmountPaise * 0.30);
      revenueSavedPaise = Math.max(0, recoveredAmountPaise - baselineRecoveredEstimatePaise);
      confidence = 0.80;
      method = 'reactive_smart_retry_counterfactual';
    }
    // 3. Subscription Pause / Grace Period Path
    else if (action === 'pause' || action === 'grace_period' || executionStatus === 'paused') {
      recoveryType = 'reactive';
      status = 'in_progress';
      atRiskAmountPaise = monthlyAmountPaise;
      recoveredAmountPaise = 0;
      estimatedBaselineOutcome = 'immediate_hard_cancellation';
      baselineRecoveredEstimatePaise = 0;
      revenueSavedPaise = 0;
      confidence = 0.75;
      method = 'grace_period_retention_counterfactual';
    }
    // 4. Untouched / NO_ACTION Path (Healthy)
    else if (action === 'NO_ACTION' || trajectory === 'HEALTHY') {
      recoveryType = 'none';
      status = 'untouched';
      atRiskAmountPaise = 0;
      recoveredAmountPaise = 0;
      estimatedBaselineOutcome = 'healthy_baseline_continuation';
      baselineRecoveredEstimatePaise = monthlyAmountPaise;
      revenueSavedPaise = 0;
      confidence = 0.95;
      method = 'healthy_pass_through_counterfactual';
    }
    // 5. Escalated / Blocked Path
    else if (action === 'escalate' || executionStatus === 'escalated') {
      recoveryType = 'none';
      status = 'in_progress';
      atRiskAmountPaise = monthlyAmountPaise;
      recoveredAmountPaise = 0;
      estimatedBaselineOutcome = 'manual_review_queue_retention';
      baselineRecoveredEstimatePaise = 0;
      revenueSavedPaise = 0;
      confidence = 0.70;
      method = 'manual_escalation_counterfactual';
    }
    // 6. Terminal Failure / Halted Path
    else {
      recoveryType = 'none';
      status = 'halted';
      atRiskAmountPaise = monthlyAmountPaise;
      recoveredAmountPaise = 0;
      estimatedBaselineOutcome = 'permanent_default_loss';
      baselineRecoveredEstimatePaise = 0;
      revenueSavedPaise = 0;
      confidence = 0.90;
      method = 'terminal_loss_counterfactual';
    }

    return {
      instrumentId: input.instrument.instrument_id,
      subscriptionId: input.instrument.subscription_id,
      recoveryType,
      atRiskAmountPaise,
      recoveredAmountPaise,
      estimatedBaselineOutcome,
      baselineRecoveredEstimatePaise,
      revenueSavedPaise,
      method,
      confidence,
      details: {
        outcomeStatus: status,
        trajectory,
        rootCause,
        action,
        executionStatus,
        failureCount,
        rail: input.instrument.rail,
      },
    };
  }
}
