import type { InstrumentRail, RecoveryActionType, RootCauseType } from '@recovery/shared';

export interface ActionSuccessRateConfig {
  rail: InstrumentRail;
  action: RecoveryActionType;
  expectedSuccessRate: number; // 0.00 to 1.00
  description: string;
}

/**
 * Historical and empirically observed benchmark action success rates by (rail, action_type).
 * Documented in /docs/ERV_CONFIG.md.
 */
export const ACTION_SUCCESS_RATE_MATRIX: Record<
  InstrumentRail,
  Record<RecoveryActionType, number>
> = {
  card: {
    smart_retry_optimal_window: 0.72,
    pre_expiry_card_update_link: 0.88,
    mandate_limit_upgrade_link: 0.5,
    vpa_collect_request: 0.4,
    dunning_step_up_auth: 0.55,
    direct_debit_resubmission: 0.45,
    manual_escalation: 0.3,
  },
  upi_autopay: {
    smart_retry_optimal_window: 0.8,
    pre_expiry_card_update_link: 0.4,
    mandate_limit_upgrade_link: 0.68,
    vpa_collect_request: 0.75,
    dunning_step_up_auth: 0.65,
    direct_debit_resubmission: 0.5,
    manual_escalation: 0.35,
  },
  enach: {
    smart_retry_optimal_window: 0.62,
    pre_expiry_card_update_link: 0.3,
    mandate_limit_upgrade_link: 0.55,
    vpa_collect_request: 0.5,
    dunning_step_up_auth: 0.5,
    direct_debit_resubmission: 0.65,
    manual_escalation: 0.3,
  },
};

/**
 * Determines the optimal recommended recovery action based on root cause and instrument rail.
 */
export function determineRecommendedAction(
  rootCause: RootCauseType,
  rail: InstrumentRail,
): RecoveryActionType {
  switch (rootCause) {
    case 'CARD_EXPIRY_RISK':
      return rail === 'card' ? 'pre_expiry_card_update_link' : 'smart_retry_optimal_window';

    case 'AFA_PENDING':
      return rail === 'upi_autopay' ? 'mandate_limit_upgrade_link' : 'dunning_step_up_auth';

    case 'REPEATED_SOFT_DECLINE':
      return 'smart_retry_optimal_window';

    case 'HARD_DECLINE_PATTERN':
      return rail === 'upi_autopay'
        ? 'vpa_collect_request'
        : rail === 'enach'
          ? 'direct_debit_resubmission'
          : 'dunning_step_up_auth';

    case 'MANDATE_INACTIVE':
      return 'manual_escalation';

    case 'NONE':
    case 'ISSUER_HISTORICAL_RISK':
    case 'UNKNOWN':
    default:
      return 'smart_retry_optimal_window';
  }
}

/**
 * Looks up the benchmark expected success rate for an action on a given rail.
 */
export function getActionSuccessRate(rail: InstrumentRail, action: RecoveryActionType): number {
  const railMatrix = ACTION_SUCCESS_RATE_MATRIX[rail];
  if (!railMatrix || typeof railMatrix[action] !== 'number') {
    return 0.5; // Fallback default
  }
  return railMatrix[action];
}
