import crypto from 'node:crypto';
import type {
  PreActionVerificationRecord,
  VerificationCheckResult,
  VerificationBlockReason,
} from './types.js';
import type { VerificationContext, VerificationGatewayConfig } from './types.js';
import { RazorpayClient } from '../razorpay/client.js';
import { CohortCircuitBreaker } from '../circuit-breaker/circuit-breaker.js';
import { CircuitBreakerGuard } from '../circuit-breaker/circuit-breaker-guard.js';

export const DEFAULT_GATEWAY_CONFIG: VerificationGatewayConfig = {
  maxPolicyFreshnessAgeSeconds: 900, // 15 minutes max freshness TTL
};

/**
 * Safety & Verification Gateway ("2 AM" Pre-Action Guard).
 *
 * Runs immediately before any money-moving or customer-facing action executes.
 * Performs 4 mandatory pre-flight checks:
 *   1. Live State Check (Live Razorpay/Bank API vs advisory local cache)
 *   2. Idempotency Check (Duplicate action collision detection)
 *   3. Circuit Breaker Re-Check (Cohort outage status)
 *   4. Policy Decision Freshness Check (Decision age <= 15 minutes)
 */
export class VerificationGateway {
  private razorpayClient: RazorpayClient;
  private circuitBreaker: CohortCircuitBreaker;
  private config: VerificationGatewayConfig;
  private executedIdempotencyKeys: Set<string> = new Set();

  constructor(
    razorpayClient?: RazorpayClient,
    circuitBreaker?: CohortCircuitBreaker,
    config?: Partial<VerificationGatewayConfig>,
  ) {
    this.razorpayClient = razorpayClient || new RazorpayClient();
    this.circuitBreaker = circuitBreaker || new CohortCircuitBreaker();
    this.config = { ...DEFAULT_GATEWAY_CONFIG, ...config };
  }

  /**
   * Registers an executed idempotency key in the gateway cache.
   */
  registerExecutedIdempotencyKey(key: string): void {
    this.executedIdempotencyKeys.add(key);
  }

  /**
   * Clears executed idempotency keys (test utility).
   */
  clearIdempotencyKeys(): void {
    this.executedIdempotencyKeys.clear();
  }

  /**
   * Performs all 4 pre-action verification checks.
   */
  async verify(
    context: VerificationContext,
    customConfig?: Partial<VerificationGatewayConfig>,
  ): Promise<PreActionVerificationRecord> {
    const config = { ...this.config, ...customConfig };
    const refTime = context.referenceTime ? new Date(context.referenceTime) : new Date();
    const verificationId = `ver_${crypto.randomUUID()}`;
    const checks: VerificationCheckResult[] = [];
    let blockedReason: VerificationBlockReason | undefined;

    const cachedMandateStatus = context.instrument.mandate_status || 'active';
    let liveMandateStatus: string = cachedMandateStatus;

    // =========================================================================
    // 1. LIVE STATE CHECK (Zero-Trust Cache Philosophy)
    // =========================================================================
    try {
      const liveMandate = await this.razorpayClient.fetchLiveMandateState(
        context.instrument.instrument_id,
      );

      liveMandateStatus =
        (liveMandate as { status?: string }).status ||
        (liveMandate as { state?: string }).state ||
        'active';

      // Check if local cache is ACTIVE while live state is REVOKED/PAUSED/EXPIRED/FAILED
      const isLiveActive = liveMandateStatus.toLowerCase() === 'active';
      const isCachedActive = cachedMandateStatus.toLowerCase() === 'active';

      if (isCachedActive && !isLiveActive) {
        checks.push({
          check: 'LIVE_STATE_CHECK',
          passed: false,
          reason: `Cached state ('${cachedMandateStatus}') disagrees with live gateway state ('${liveMandateStatus}'). Action aborted to prevent invalid charge against revoked/inactive mandate.`,
          details: {
            cachedStatus: cachedMandateStatus,
            liveStatus: liveMandateStatus,
          },
        });
        if (!blockedReason) blockedReason = 'STALE_STATE_DISAGREEMENT';
      } else {
        checks.push({
          check: 'LIVE_STATE_CHECK',
          passed: true,
          reason: `Live gateway state verified ('${liveMandateStatus}'). Consistent with cached state.`,
          details: {
            cachedStatus: cachedMandateStatus,
            liveStatus: liveMandateStatus,
          },
        });
      }
    } catch {
      // In case of live API error, check subscription state
      if (context.instrument.subscription_id) {
        try {
          const liveSub = await this.razorpayClient.fetchLiveSubscriptionState(
            context.instrument.subscription_id,
          );
          const liveSubStatus = liveSub.status.toLowerCase();
          if (liveSubStatus === 'cancelled' || liveSubStatus === 'halted') {
            checks.push({
              check: 'LIVE_STATE_CHECK',
              passed: false,
              reason: `Live subscription status is '${liveSub.status}'. Action aborted.`,
              details: { liveSubStatus },
            });
            if (!blockedReason) blockedReason = 'STALE_STATE_DISAGREEMENT';
          } else {
            checks.push({
              check: 'LIVE_STATE_CHECK',
              passed: true,
              reason: `Live subscription state verified ('${liveSub.status}').`,
            });
          }
        } catch (subErr) {
          checks.push({
            check: 'LIVE_STATE_CHECK',
            passed: false,
            reason: `Failed to verify live state against gateway API: ${(subErr as Error).message}`,
          });
          if (!blockedReason) blockedReason = 'INTERNAL_VERIFICATION_ERROR';
        }
      } else {
        checks.push({
          check: 'LIVE_STATE_CHECK',
          passed: true,
          reason: 'Live status check bypassed (no subscription ID).',
        });
      }
    }

    // =========================================================================
    // 2. IDEMPOTENCY CHECK
    // =========================================================================
    const isDuplicate = this.executedIdempotencyKeys.has(context.idempotencyKey);
    if (isDuplicate) {
      checks.push({
        check: 'IDEMPOTENCY_CHECK',
        passed: false,
        reason: `Duplicate execution prevented: idempotency key '${context.idempotencyKey}' was already processed.`,
        details: { idempotencyKey: context.idempotencyKey },
      });
      if (!blockedReason) blockedReason = 'IDEMPOTENCY_CONFLICT';
    } else {
      checks.push({
        check: 'IDEMPOTENCY_CHECK',
        passed: true,
        reason: `Idempotency key '${context.idempotencyKey}' is unique and unused.`,
      });
    }

    // =========================================================================
    // 3. CIRCUIT BREAKER CHECK (Re-Check at Execution Time)
    // =========================================================================
    const cohortKey =
      context.cohortKey ||
      CircuitBreakerGuard.deriveCohortKey(context.instrument.rail);

    const cbEval = this.circuitBreaker.evaluate(cohortKey, refTime);
    if (!cbEval.allowed) {
      checks.push({
        check: 'CIRCUIT_BREAKER_CHECK',
        passed: false,
        reason: `Circuit breaker for cohort '${cohortKey}' is OPEN (${cbEval.status.openReason}). Execution suspended.`,
        details: {
          cohortKey,
          state: cbEval.state,
          currentSuccessRate: cbEval.status.currentSuccessRate,
        },
      });
      if (!blockedReason) blockedReason = 'CIRCUIT_BREAKER_OPEN';
    } else {
      checks.push({
        check: 'CIRCUIT_BREAKER_CHECK',
        passed: true,
        reason: `Cohort circuit breaker is ${cbEval.state} (Success rate: ${(cbEval.status.currentSuccessRate * 100).toFixed(0)}%).`,
      });
    }

    // =========================================================================
    // 4. POLICY DECISION FRESHNESS CHECK
    // =========================================================================
    const decisionTime = new Date(
      context.policyDecisionCreatedAt ||
        context.decision.evaluatedAt ||
        refTime.toISOString(),
    );
    const ageSeconds = Math.max(0, Math.floor((refTime.getTime() - decisionTime.getTime()) / 1000));

    if (ageSeconds > config.maxPolicyFreshnessAgeSeconds) {
      checks.push({
        check: 'POLICY_FRESHNESS_CHECK',
        passed: false,
        reason: `Policy decision is stale (${ageSeconds}s old, exceeds ${config.maxPolicyFreshnessAgeSeconds}s TTL). Requires fresh risk scoring before execution.`,
        details: {
          decisionAgeSeconds: ageSeconds,
          maxAgeSeconds: config.maxPolicyFreshnessAgeSeconds,
        },
      });
      if (!blockedReason) blockedReason = 'POLICY_DECISION_STALE';
    } else {
      checks.push({
        check: 'POLICY_FRESHNESS_CHECK',
        passed: true,
        reason: `Policy decision is fresh (${ageSeconds}s old <= ${config.maxPolicyFreshnessAgeSeconds}s TTL).`,
      });
    }

    // =========================================================================
    // FINAL RESULT CONSOLIDATION
    // =========================================================================
    const allPassed = checks.every((c) => c.passed);
    const status = allPassed ? 'VERIFIED_SAFE' : 'BLOCKED';

    return {
      verificationId,
      decisionId: context.decision.decisionId,
      instrumentId: context.instrument.instrument_id,
      subscriptionId: context.instrument.subscription_id,
      status,
      blockedReason,
      checks,
      cachedMandateStatus,
      liveMandateStatus,
      verifiedAt: refTime.toISOString(),
    };
  }
}
