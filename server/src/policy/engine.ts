import fs from 'node:fs';
import path from 'node:path';
import type { PolicyContext, PolicyDecisionResult, PolicyRulesConfig } from './types.js';

/**
 * Compliance Verification Note:
 * For the final submission, re-verify every numerical compliance rule against current Razorpay/NPCI documentation.
 * This engine enforces the configured rail/network constraints — it does not itself certify legal compliance.
 */

// Load literal versioned JSON configuration
function loadDefaultConfig(): PolicyRulesConfig {
  try {
    const configPath = path.resolve(__dirname, '../../src/policy/policy-config.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch {
    // Fallback if bundled
  }

  // Exact inline mirror of policy-config.json
  return {
    version: '1.0.0',
    updatedAt: '2026-08-30T00:00:00.000Z',
    complianceNote:
      'For the final submission, re-verify every numerical compliance rule against current Razorpay/NPCI documentation. This engine enforces the configured rail/network constraints — it does not itself certify legal compliance.',
    rails: {
      card: {
        maxAttempts: 4,
        nextAttemptOffsetDays: 1,
        ruleIdMaxAttempts: 'CARD-MAX-ATTEMPTS-001',
        ruleIdOffset: 'CARD-RETRY-OFFSET-001',
        description: 'Card tokenized auto-debit max 4 attempts with minimum 1-day spacing',
      },
      upi_autopay: {
        maxAttempts: 4,
        maxRetries: 3,
        retryWindowsHours: [24, 72, 168],
        standardAfaThresholdPaise: 1500000,
        categoryAfaThresholdPaise: 10000000,
        categoryMccList: ['6211', '6300', '8220', '6012'],
        ruleIdMaxAttempts: 'UPI-NPCI-RETRY-CAP-001',
        ruleIdAfaThreshold: 'UPI-AFA-THRESHOLD-001',
        description:
          'UPI AutoPay NPCI max 1 original + 3 retries, ₹15,000 standard / ₹1,00,000 category AFA limit',
      },
      enach: {
        defaultMaxAttempts: 3,
        bankOverrides: {
          HDFC: 3,
          ICICI: 3,
          SBIN: 2,
          UTIB: 3,
          KKBK: 3,
        },
        ruleIdMaxAttempts: 'ENACH-BANK-RETRY-CAP-001',
        description: 'E-NACH clearing standing instructions per-bank retry limits',
      },
    },
    global: {
      maxNudgesPerCycle: 1,
      staleStatePolicy: 'BLOCK',
      circuitBreaker: 'ENABLED',
      defaultTerminalAction: 'grace_period',
      defaultTerminalGraceDays: 3,
      ruleIdNudgeCap: 'GLOBAL-NUDGE-CAP-001',
      ruleIdTerminalGrace: 'TERMINAL-GRACE-PAUSE-001',
      ruleIdCustomerOptOut: 'CUSTOMER-OPT-OUT-001',
      ruleIdPassThroughNoAction: 'PASS-THROUGH-NO-ACTION-001',
      ruleIdPassThroughAllow: 'PASS-THROUGH-PERMIT-001',
    },
  };
}

export const DEFAULT_POLICY_CONFIG = loadDefaultConfig();

/**
 * Pure deterministic Policy Decision Engine ("PERMIT").
 *
 * Evaluates proposed actions against strict rail and regulatory constraints.
 * No probability, confidence, or AI reasoning can override these rules.
 */
export function decide(
  context: PolicyContext,
  customConfig?: PolicyRulesConfig,
): PolicyDecisionResult {
  const config = customConfig || DEFAULT_POLICY_CONFIG;
  const evaluatedAt = context.evaluatedAt || new Date().toISOString();

  // 1. Customer Opt-Out Policy Check
  if (context.isCustomerOptOut === true) {
    if (context.proposedAction !== 'NO_ACTION' && context.proposedAction !== 'pause') {
      return {
        result: 'MODIFY',
        finalAction: 'pause',
        ruleIdMatched: config.global.ruleIdCustomerOptOut,
        reason:
          'Customer has explicitly opted out of automated recovery interventions. Overriding proposed action to pause.',
        evaluatedAt,
      };
    }
    return {
      result: 'ALLOW',
      finalAction: context.proposedAction,
      ruleIdMatched: config.global.ruleIdCustomerOptOut,
      reason: 'Customer opt-out acknowledged; passive state permitted.',
      evaluatedAt,
    };
  }

  // 2. Pass-Through for NO_ACTION
  if (context.proposedAction === 'NO_ACTION') {
    return {
      result: 'NO_ACTION',
      finalAction: 'NO_ACTION',
      ruleIdMatched: config.global.ruleIdPassThroughNoAction,
      reason:
        'Proposed action is NO_ACTION. Policy engine permits no-op pass-through without intervention.',
      evaluatedAt,
    };
  }

  // 3. Global Proactive Nudge Cap (Max 1 Nudge per Billing Cycle)
  if (
    context.proposedAction === 'proactive_nudge' &&
    context.customerContactCountThisCycle >= config.global.maxNudgesPerCycle
  ) {
    return {
      result: 'MODIFY',
      finalAction: 'schedule_retry',
      ruleIdMatched: config.global.ruleIdNudgeCap,
      reason: `Customer contact limit reached (${context.customerContactCountThisCycle}/${config.global.maxNudgesPerCycle} nudges this billing cycle). Proactive nudge blocked; modified to automated scheduled retry.`,
      modifiedParameters: {
        channel: 'none',
        fallbackAction: 'schedule_retry',
      },
      evaluatedAt,
    };
  }

  // 4. Absolute Rail-Specific Max Attempts Cap (ZERO BYPASS)
  let maxAttempts = 4;
  let maxAttemptRuleId = 'UNKNOWN-RAIL-CAP';

  if (context.rail === 'card') {
    maxAttempts = config.rails.card.maxAttempts;
    maxAttemptRuleId = config.rails.card.ruleIdMaxAttempts;
  } else if (context.rail === 'upi_autopay') {
    maxAttempts = config.rails.upi_autopay.maxAttempts;
    maxAttemptRuleId = config.rails.upi_autopay.ruleIdMaxAttempts;
  } else if (context.rail === 'enach') {
    const bank = context.bankCode?.toUpperCase() || '';
    maxAttempts = config.rails.enach.bankOverrides[bank] ?? config.rails.enach.defaultMaxAttempts;
    maxAttemptRuleId = config.rails.enach.ruleIdMaxAttempts;
  }

  if (
    context.attemptCount >= maxAttempts &&
    (context.proposedAction === 'retry' || context.proposedAction === 'schedule_retry')
  ) {
    return {
      result: 'MODIFY',
      finalAction: config.global.defaultTerminalAction,
      ruleIdMatched: maxAttemptRuleId,
      reason: `Absolute rail attempt limit reached (${context.attemptCount}/${maxAttempts} on ${context.rail.toUpperCase()}). Further automated retries strictly prohibited; modified to bounded ${config.global.defaultTerminalGraceDays}-day grace period pause.`,
      modifiedParameters: {
        graceDays: config.global.defaultTerminalGraceDays,
        attemptCap: maxAttempts,
      },
      evaluatedAt,
    };
  }

  // 5. UPI AutoPay RBI AFA Threshold Limit Enforcement
  if (context.rail === 'upi_autopay' && context.amountPaise) {
    const isCategoryMcc =
      context.mccCode && config.rails.upi_autopay.categoryMccList.includes(context.mccCode);

    const threshold = isCategoryMcc
      ? config.rails.upi_autopay.categoryAfaThresholdPaise
      : config.rails.upi_autopay.standardAfaThresholdPaise;

    if (context.amountPaise > threshold && context.proposedAction === 'retry') {
      return {
        result: 'MODIFY',
        finalAction: 'proactive_nudge',
        ruleIdMatched: config.rails.upi_autopay.ruleIdAfaThreshold,
        reason: `Transaction amount (₹${Math.round(context.amountPaise / 100).toLocaleString('en-IN')}) exceeds RBI AFA limit of ₹${Math.round(threshold / 100).toLocaleString('en-IN')}. Immediate debit disallowed without step-up auth; modified to customer limit authorization nudge.`,
        modifiedParameters: {
          thresholdPaise: threshold,
          requiresAfaStepUp: true,
        },
        evaluatedAt,
      };
    }
  }

  // 6. Terminal Trajectory Default to Bounded Grace-Pause (No Sudden Cancellation)
  if (
    context.trajectory === 'TERMINAL' &&
    (context.proposedAction === 'pause' || context.proposedAction === 'escalate')
  ) {
    return {
      result: 'ALLOW',
      finalAction: context.proposedAction,
      ruleIdMatched: config.global.ruleIdTerminalGrace,
      reason: `Terminal trajectory acknowledged. Preserving ${context.proposedAction} action within bounded grace-period policy guidelines.`,
      evaluatedAt,
    };
  }

  // 7. General PERMIT / ALLOW for Compliant Actions
  return {
    result: 'ALLOW',
    finalAction: context.proposedAction,
    ruleIdMatched: config.global.ruleIdPassThroughAllow,
    reason: `Proposed action '${context.proposedAction}' satisfies all rail attempt caps (${context.attemptCount}/${maxAttempts}), contact frequency limits, and regulatory AFA constraints.`,
    evaluatedAt,
  };
}
