import type { RiskFeatureVector, InstrumentRail } from '@recovery/shared';

export interface ReasoningInput {
  instrumentId: string;
  rail: InstrumentRail;
  ltvTier: string;
  healthScore: number;
  trajectory: string;
  rootCause: string;
  proposedAction: string;
  expectedRecoveryValueRupees: number;
  monthlyAmountRupees: number;
  featureVector: RiskFeatureVector;
}

/**
 * AI Narrative Reasoning Synthesizer.
 *
 * Provides natural-language, explainable narration for recovery proposals.
 * Grounded strictly in the mathematical feature vector and economic priors.
 *
 * ARCHITECTURAL SAFETY INVARIANT:
 * - This module only generates narrative explanations (text).
 * - It possesses ZERO execution authority and zero ability to mutate states or move funds.
 */
export class AiReasoningEngine {
  /**
   * Deterministic narrative synthesizer grounded directly in the feature vector.
   */
  public generateDeterministicNarration(input: ReasoningInput): string {
    const fv = input.featureVector;
    const parts: string[] = [];

    if (input.trajectory === 'HEALTHY' && input.rootCause === 'NONE') {
      return `Instrument is in HEALTHY operational status (Health Score: ${(input.healthScore * 100).toFixed(0)}/100) with 0 recent failures and active mandate. No recovery intervention required.`;
    }

    if (input.rootCause === 'CARD_EXPIRY_RISK') {
      const days = fv.days_to_expiry ?? 0;
      if (days >= 0 && days <= 20) {
        return `Card instrument is ${days} days from expiry (normalized proximity: ${fv.days_to_expiry_normalized?.toFixed(2) || '0.00'}). Proactive token update recommended to prevent debit failures on next billing cycle.`;
      }
      return `Card instrument is expired (${Math.abs(days)} days overdue). Immediate customer token update required.`;
    }

    if (input.rootCause === 'AFA_PENDING') {
      return `Transaction value ₹${input.monthlyAmountRupees.toLocaleString('en-IN')} exceeds standard RBI AFA threshold on ${input.rail.toUpperCase()}. Step-up mandate limit increase requested.`;
    }

    if (input.rootCause === 'REPEATED_SOFT_DECLINE') {
      return `Detected ${fv.consecutive_failures} consecutive debit failures (${fv.failure_count_last_3_cycles} across last 3 billing cycles). Top decline code: ${Object.keys(fv.decline_code_distribution)[0] || 'INSUFFICIENT_FUNDS'}. Optimal retry window scheduled based on issuer prior (${(fv.issuer_prior * 100).toFixed(0)}%).`;
    }

    if (input.rootCause === 'MANDATE_INACTIVE' || input.trajectory === 'TERMINAL') {
      return `Hard terminal status detected (${input.rootCause}) for ${input.ltvTier.toUpperCase()} LTV tier. ERV is ₹${input.expectedRecoveryValueRupees.toLocaleString('en-IN')}. Action: ${input.proposedAction}.`;
    }

    parts.push(
      `Health Score: ${(input.healthScore * 100).toFixed(0)}/100 (${input.trajectory} trajectory).`,
    );
    parts.push(
      `Action: ${input.proposedAction} formulated with ERV ₹${input.expectedRecoveryValueRupees.toLocaleString('en-IN')}.`,
    );

    return parts.join(' ');
  }
}

export const aiReasoningEngine = new AiReasoningEngine();
