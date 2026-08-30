import type {
  DbInstrument,
  HealthEvaluationResult,
  ERVCalculationResult,
  RecoveryActionType,
} from '@recovery/shared';
import { determineRecommendedAction, getActionSuccessRate } from './erv-config.js';

export interface ERVOptions {
  customAmountAtRiskPaise?: number;
  overrideAction?: RecoveryActionType;
}

/**
 * Pure Expected Recovery Value (ERV) Engine.
 *
 * Formula:
 * ERV = AmountAtRisk * RecoveryProbability * ExpectedActionSuccessRate
 *
 * All amounts are computed in paise and converted to rupees for reporting.
 */
export function calculateERV(
  instrument: DbInstrument,
  healthResult: HealthEvaluationResult,
  options?: ERVOptions,
): ERVCalculationResult {
  // Amount at risk: Monthly recurring value (annualized_value / 12) or custom override
  const amountAtRisk =
    options?.customAmountAtRiskPaise ??
    (instrument.annualized_value > 0 ? Math.round(instrument.annualized_value / 12) : 299900); // fallback ₹2,999

  const recommendedAction =
    options?.overrideAction || determineRecommendedAction(healthResult.rootCause, instrument.rail);

  const expectedActionSuccessRate = getActionSuccessRate(instrument.rail, recommendedAction);

  const rawERV = amountAtRisk * healthResult.recoveryProbability * expectedActionSuccessRate;

  const expectedRecoveryValue = Math.round(rawERV);
  const expectedRecoveryValueRupees = Math.round(expectedRecoveryValue / 100);

  return {
    instrumentId: instrument.instrument_id,
    subscriptionId: instrument.subscription_id,
    amountAtRisk,
    recoveryProbability: healthResult.recoveryProbability,
    recommendedAction,
    expectedActionSuccessRate,
    expectedRecoveryValue,
    expectedRecoveryValueRupees,
    computedAt: healthResult.computedAt,
  };
}
