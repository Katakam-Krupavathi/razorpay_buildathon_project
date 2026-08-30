import crypto from 'node:crypto';
import type {
  ProposedActionRecord,
  PlannerActionType,
} from '@recovery/shared';
import type { PlannerContext, PlannerOptions } from './types.js';

/**
 * Pure AI Recovery Planner Engine.
 *
 * ZERO EXECUTION AUTHORITY INVARIANT:
 * This module is 100% pure. It only formulates and proposes actions.
 * It has ZERO execution capabilities and zero dependencies on execution modules.
 */
export function formulateRecoveryPlan(
  context: PlannerContext,
  options?: PlannerOptions,
): ProposedActionRecord {
  const { instrument, health, erv } = context;
  const ltvTier = (instrument.ltv_tier || 'medium').toLowerCase();
  const fv = health.featureVector;
  const refTime = options?.referenceTime
    ? new Date(options.referenceTime)
    : new Date(health.computedAt || Date.now());

  const monthlyAmountRupees = Math.round(erv.amountAtRisk / 100);
  const ervRupees = erv.expectedRecoveryValueRupees;

  let proposedAction: PlannerActionType = 'NO_ACTION';
  let reasoning = '';
  let confidence = 0.85;
  const parameters: Record<string, unknown> = {
    rail: instrument.rail,
    ltvTier,
    healthScore: health.healthScore,
    recoveryProbability: health.recoveryProbability,
    monthlyAmountRupees,
    ervRupees,
  };

  // 1. HEALTHY Cohort with No Active Risk -> NO_ACTION
  if (
    health.trajectory === 'HEALTHY' &&
    health.rootCause === 'NONE' &&
    !fv.is_near_card_expiry
  ) {
    proposedAction = 'NO_ACTION';
    reasoning = `Instrument is in HEALTHY operational status with 0 recent failures and valid mandate. No recovery intervention required.`;
    confidence = 0.99;
    parameters.scheduledAt = null;
  }
  // 2. Economic Low-Value Threshold Check -> NO_ACTION
  else if (
    (health.trajectory === 'TERMINAL' || health.rootCause === 'MANDATE_INACTIVE') &&
    ltvTier === 'low' &&
    ervRupees < 500
  ) {
    proposedAction = 'NO_ACTION';
    reasoning = `Low LTV tier (₹${monthlyAmountRupees.toLocaleString('en-IN')}/mo) with ${health.rootCause} terminal decline. Expected recovery value of ₹${ervRupees.toLocaleString('en-IN')} is below cost-effective intervention threshold.`;
    confidence = 0.89;
    parameters.reason = 'cost_exceeds_expected_value';
  }
  // 3. Card Expiry Risk (Proactive Token Update Nudge)
  else if (health.rootCause === 'CARD_EXPIRY_RISK') {
    const days = fv.days_to_expiry ?? 0;
    if (days >= 0 && days <= 20) {
      proposedAction = 'proactive_nudge';
      reasoning = `Card instrument is ${days} days from expiry (${fv.days_to_expiry_normalized !== null ? `norm: ${fv.days_to_expiry_normalized.toFixed(2)}` : ''}). Proactive card update nudge recommended to prevent upcoming debit failure on next cycle.`;
      confidence = 0.92;
      parameters.template = 'card_expiry_update_request';
      parameters.channel = ltvTier === 'critical' ? 'whatsapp_and_email' : 'email';
      parameters.daysToExpiry = days;
    } else {
      // Expired card
      if (ltvTier === 'critical' || ltvTier === 'high') {
        proposedAction = 'escalate';
        reasoning = `Card expired for high-value customer (₹${monthlyAmountRupees.toLocaleString('en-IN')}/mo). Immediate account manager escalation recommended for card update.`;
        confidence = 0.90;
        parameters.escalationTier = 'vip_account_manager';
      } else {
        proposedAction = 'pause';
        reasoning = `Card expired (${Math.abs(days)} days ago). Pausing automated debits to prevent bank rejection fees.`;
        confidence = 0.85;
      }
    }
  }
  // 4. UPI AFA Limit Over Threshold
  else if (health.rootCause === 'AFA_PENDING') {
    if (ltvTier === 'critical' || ltvTier === 'high') {
      proposedAction = 'proactive_nudge';
      reasoning = `Transaction value ₹${monthlyAmountRupees.toLocaleString('en-IN')} exceeds standard RBI AFA threshold on UPI AutoPay. Dispatching step-up mandate limit increase link to customer.`;
      confidence = 0.88;
      parameters.template = 'upi_mandate_limit_upgrade';
      parameters.targetLimitPaise = erv.amountAtRisk;
    } else {
      proposedAction = 'schedule_retry';
      reasoning = `UPI AutoPay AFA threshold exceeded. Scheduling retry with customer push notification to authorize debit in UPI app.`;
      confidence = 0.80;
      parameters.retryBackoffHours = 12;
      parameters.scheduledAt = new Date(refTime.getTime() + 12 * 3600 * 1000).toISOString();
    }
  }
  // 5. Repeated Soft Declines (Insufficient Funds / Bank Downtime)
  else if (health.rootCause === 'REPEATED_SOFT_DECLINE') {
    const consecutive = fv.consecutive_failures;
    if (consecutive <= 1) {
      proposedAction = 'schedule_retry';
      reasoning = `Initial soft decline recorded (failure count in 3 cycles: ${fv.failure_count_last_3_cycles}). Scheduling smart retry in optimal recovery window (09:00 AM next business day).`;
      confidence = 0.88;
      parameters.retryBackoffHours = 24;
      parameters.scheduledAt = new Date(refTime.getTime() + 24 * 3600 * 1000).toISOString();
    } else if (consecutive === 2) {
      if (ltvTier === 'critical' || ltvTier === 'high') {
        proposedAction = 'grace_period';
        reasoning = `2 consecutive soft declines on high-value tier (₹${monthlyAmountRupees.toLocaleString('en-IN')}/mo). Granting 3-day grace period to protect customer access while scheduling secondary retry.`;
        confidence = 0.85;
        parameters.gracePeriodDays = 3;
        parameters.scheduledAt = new Date(refTime.getTime() + 72 * 3600 * 1000).toISOString();
      } else {
        proposedAction = 'schedule_retry';
        reasoning = `Second soft decline recorded. Scheduling final automated retry attempt before service pause.`;
        confidence = 0.78;
        parameters.retryBackoffHours = 48;
        parameters.scheduledAt = new Date(refTime.getTime() + 48 * 3600 * 1000).toISOString();
      }
    } else {
      // 3+ failures
      if (ltvTier === 'critical' || ltvTier === 'high') {
        proposedAction = 'escalate';
        reasoning = `${consecutive} consecutive soft failures for ${ltvTier} tier. Automated retry threshold exhausted. Escalating to customer success.`;
        confidence = 0.90;
        parameters.escalationReason = 'persistent_soft_declines';
      } else {
        proposedAction = 'pause';
        reasoning = `${consecutive} consecutive soft failures on ${ltvTier} tier. Automated retries exhausted; pausing subscription.`;
        confidence = 0.85;
      }
    }
  }
  // 6. Hard Decline Pattern (Account Blocked / Mandate Revoked by User)
  else if (health.rootCause === 'HARD_DECLINE_PATTERN') {
    if (ltvTier === 'critical' || ltvTier === 'high') {
      proposedAction = 'escalate';
      reasoning = `Hard decline encountered on ${ltvTier} tier (₹${monthlyAmountRupees.toLocaleString('en-IN')}/mo). Automated retries disallowed; escalating for alternate payment collection.`;
      confidence = 0.92;
      parameters.escalationTier = 'high_priority';
    } else if (ltvTier === 'medium') {
      proposedAction = 'pause';
      reasoning = `Hard decline encountered on medium tier. Pausing subscription to avoid repeated gateway penalties.`;
      confidence = 0.88;
    } else {
      proposedAction = 'NO_ACTION';
      reasoning = `Hard decline on low LTV tier (₹${monthlyAmountRupees.toLocaleString('en-IN')}/mo). Expected recovery value too low for manual escalation.`;
      confidence = 0.85;
    }
  }
  // 7. Mandate Inactive / Revoked
  else if (health.rootCause === 'MANDATE_INACTIVE') {
    if (ltvTier === 'critical') {
      proposedAction = 'escalate';
      reasoning = `Mandate status is inactive (${instrument.mandate_status}) on CRITICAL tier. High-touch manual outreach required to re-authenticate mandate.`;
      confidence = 0.90;
    } else {
      proposedAction = 'NO_ACTION';
      reasoning = `Mandate is ${instrument.mandate_status} on ${ltvTier} tier. Automated charge impossible without customer re-authentication.`;
      confidence = 0.95;
    }
  }
  // 8. Fallback Default
  else {
    proposedAction = 'schedule_retry';
    reasoning = `Unclassified degradation (Health score: ${health.healthScore.toFixed(2)}). Scheduling standard retry attempt.`;
    confidence = 0.60;
  }

  const proposalId = `prop_${crypto.randomUUID()}`;

  return {
    proposalId,
    instrumentId: instrument.instrument_id,
    subscriptionId: instrument.subscription_id,
    proposedAction,
    rootCause: health.rootCause,
    expectedRecoveryValue: erv.expectedRecoveryValue,
    expectedRecoveryValueRupees: ervRupees,
    reasoning,
    confidence: Math.round(confidence * 100) / 100,
    parameters,
    evaluatedAt: refTime.toISOString(),
  };
}
