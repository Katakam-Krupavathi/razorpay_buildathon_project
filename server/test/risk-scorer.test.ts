import { describe, it, expect } from 'vitest';
import type { DbInstrument, StoredEvent, RazorpayWebhookPayload } from '@recovery/shared';
import { evaluateInstrumentHealth } from '../src/risk/scorer.js';
import { calculateERV } from '../src/risk/erv-engine.js';
import { ACTION_SUCCESS_RATE_MATRIX, determineRecommendedAction } from '../src/risk/erv-config.js';

describe('Risk Intelligence Layer & Scorer Unit Tests', () => {
  const REF_TIME = '2026-08-30T12:00:00.000Z';

  function createMockInstrument(overrides?: Partial<DbInstrument>): DbInstrument {
    return {
      instrument_id: 'inst_card_001',
      subscription_id: 'sub_001',
      rail: 'card',
      created_at: '2026-01-01T00:00:00.000Z',
      expiry_date: '2027-01-01T00:00:00.000Z',
      mandate_status: 'active',
      last_synced_at: '2026-08-30T00:00:00.000Z',
      ltv_tier: 'high',
      annualized_value: 12000000, // ₹1,20,000 ARR -> ₹10,000 MRR (1000000 paise)
      ...overrides,
    };
  }

  function createMockChargeEvent(seq: number, daysAgo: number): StoredEvent {
    const timestamp = new Date(Date.parse(REF_TIME) - daysAgo * 86400 * 1000).toISOString();
    return {
      eventId: `evt_charge_${seq}`,
      sequenceNumber: seq,
      prevHash: '0'.repeat(64),
      hash: 'a'.repeat(64),
      subscriptionId: 'sub_001',
      instrumentId: 'inst_card_001',
      eventType: 'subscription.charged',
      actor: 'razorpay_webhook',
      payload: {
        entity: 'event',
        account_id: 'acc_1',
        event: 'subscription.charged',
        contains: ['payment'],
        payload: {
          payment: {
            entity: {
              id: `pay_${seq}`,
              amount: 1000000,
              currency: 'INR',
              status: 'captured',
            },
          },
        },
        created_at: Math.floor(Date.parse(timestamp) / 1000),
      } as unknown as Record<string, unknown>,
      createdAt: timestamp,
    };
  }

  function createMockFailEvent(
    seq: number,
    daysAgo: number,
    errorCode: string,
    eventType = 'subscription.pending',
  ): StoredEvent {
    const timestamp = new Date(Date.parse(REF_TIME) - daysAgo * 86400 * 1000).toISOString();
    return {
      eventId: `evt_fail_${seq}`,
      sequenceNumber: seq,
      prevHash: '0'.repeat(64),
      hash: 'b'.repeat(64),
      subscriptionId: 'sub_001',
      instrumentId: 'inst_card_001',
      eventType,
      actor: 'razorpay_webhook',
      payload: {
        entity: 'event',
        account_id: 'acc_1',
        event: eventType as RazorpayWebhookPayload['event'],
        contains: ['payment'],
        payload: {
          payment: {
            entity: {
              id: `pay_fail_${seq}`,
              amount: 1000000,
              currency: 'INR',
              status: 'failed',
              error_code: errorCode,
              error_description: 'Payment failure simulated',
            },
          },
        },
        created_at: Math.floor(Date.parse(timestamp) / 1000),
      } as unknown as Record<string, unknown>,
      createdAt: timestamp,
    };
  }

  describe('Health Scoring Edge Cases & Thresholds', () => {
    it('1. should evaluate zero-failure instrument as 100% HEALTHY with 0.98 recovery probability', () => {
      const inst = createMockInstrument();
      const events = [createMockChargeEvent(1, 60), createMockChargeEvent(2, 30)];

      const res = evaluateInstrumentHealth(inst, events, { referenceTime: REF_TIME });

      expect(res.healthScore).toBe(1.0);
      expect(res.trajectory).toBe('HEALTHY');
      expect(res.rootCause).toBe('NONE');
      expect(res.recoveryProbability).toBe(0.98);
      expect(res.featureVector.consecutive_failures).toBe(0);
      expect(res.featureVector.failure_count_last_3_cycles).toBe(0);
    });

    it('2. should apply expiry penalty for a card exactly at 0 days to expiry', () => {
      const inst = createMockInstrument({
        expiry_date: REF_TIME, // exactly 0 days
      });
      const events = [createMockChargeEvent(1, 30)];

      const res = evaluateInstrumentHealth(inst, events, { referenceTime: REF_TIME });

      expect(res.featureVector.days_to_expiry).toBe(0);
      expect(res.featureVector.is_near_card_expiry).toBe(true);
      expect(res.healthScore).toBe(0.65); // 1.0 - 0.35 * (1 - 0/20) = 0.65
      expect(res.trajectory).toBe('DEGRADING');
      expect(res.rootCause).toBe('CARD_EXPIRY_RISK');
    });

    it('3. should detect card exactly on the 20-day near-expiry boundary', () => {
      const expiry20Days = new Date(Date.parse(REF_TIME) + 20 * 86400 * 1000).toISOString();
      const inst = createMockInstrument({ expiry_date: expiry20Days });
      const events = [createMockChargeEvent(1, 30)];

      const res = evaluateInstrumentHealth(inst, events, { referenceTime: REF_TIME });

      expect(res.featureVector.days_to_expiry).toBe(20);
      expect(res.featureVector.is_near_card_expiry).toBe(true);
      expect(res.healthScore).toBe(1.0); // 1.0 - 0.35 * (1 - 20/20) = 1.00
      expect(res.trajectory).toBe('HEALTHY');
    });

    it('4. should not penalize a card at 21 days to expiry (outside threshold)', () => {
      const expiry21Days = new Date(Date.parse(REF_TIME) + 21 * 86400 * 1000).toISOString();
      const inst = createMockInstrument({ expiry_date: expiry21Days });
      const events = [createMockChargeEvent(1, 30)];

      const res = evaluateInstrumentHealth(inst, events, { referenceTime: REF_TIME });

      expect(res.featureVector.days_to_expiry).toBe(21);
      expect(res.featureVector.is_near_card_expiry).toBe(false);
      expect(res.healthScore).toBe(1.0);
      expect(res.rootCause).toBe('NONE');
    });

    it('5. should penalize expired card (<0 days) as TERMINAL/DEGRADING with heavy penalty', () => {
      const expiredDate = new Date(Date.parse(REF_TIME) - 5 * 86400 * 1000).toISOString();
      const inst = createMockInstrument({ expiry_date: expiredDate });
      const events = [createMockChargeEvent(1, 30)];

      const res = evaluateInstrumentHealth(inst, events, { referenceTime: REF_TIME });

      expect(res.featureVector.days_to_expiry).toBe(-5);
      expect(res.healthScore).toBe(0.3); // 1.0 - 0.70 = 0.30
      expect(res.rootCause).toBe('CARD_EXPIRY_RISK');
    });

    it('6. should correctly handle conflicting signals: 4 successful charges + imminent card expiry (5 days)', () => {
      const expiry5Days = new Date(Date.parse(REF_TIME) + 5 * 86400 * 1000).toISOString();
      const inst = createMockInstrument({ expiry_date: expiry5Days });
      const events = [
        createMockChargeEvent(1, 120),
        createMockChargeEvent(2, 90),
        createMockChargeEvent(3, 60),
        createMockChargeEvent(4, 30),
      ];

      const res = evaluateInstrumentHealth(inst, events, { referenceTime: REF_TIME });

      // Base: 1.0 + 0.05 (loyalty) - 0.35 * (1 - 5/20) = 1.05 - 0.2625 = 0.7875 -> 0.7875
      expect(res.healthScore).toBeCloseTo(0.7875, 3);
      expect(res.trajectory).toBe('HEALTHY');
      expect(res.rootCause).toBe('CARD_EXPIRY_RISK');
    });

    it('7. should classify trajectory boundary exactly: 0.70 is HEALTHY, 0.69 is DEGRADING', () => {
      // 2 soft declines: 1.0 - 0.20*1 - 0.15*1 = 0.65 -> DEGRADING
      const inst = createMockInstrument();
      const events = [
        createMockChargeEvent(1, 60),
        createMockFailEvent(2, 2, 'INSUFFICIENT_FUNDS'),
      ];

      const res = evaluateInstrumentHealth(inst, events, { referenceTime: REF_TIME });

      expect(res.healthScore).toBe(0.65);
      expect(res.trajectory).toBe('DEGRADING');
      expect(res.rootCause).toBe('REPEATED_SOFT_DECLINE');
    });

    it('8. should classify trajectory boundary exactly: 0.30 is DEGRADING, <0.30 is TERMINAL', () => {
      const inst = createMockInstrument();
      // 3 consecutive failures: 1.0 - 0.20*3 - 0.15*3 = 1.0 - 0.60 - 0.45 = -0.05 -> 0.00 TERMINAL
      const events = [
        createMockFailEvent(1, 10, 'INSUFFICIENT_FUNDS'),
        createMockFailEvent(2, 5, 'TEMPORARY_BANK_DOWNTIME'),
        createMockFailEvent(3, 1, 'NETWORK_TIMEOUT'),
      ];

      const res = evaluateInstrumentHealth(inst, events, { referenceTime: REF_TIME });

      expect(res.healthScore).toBe(0.0);
      expect(res.trajectory).toBe('TERMINAL');
      expect(res.rootCause).toBe('REPEATED_SOFT_DECLINE');
    });

    it('9. should identify UPI Autopay AFA limit breach and classify as AFA_PENDING', () => {
      const inst = createMockInstrument({
        rail: 'upi_autopay',
        instrument_id: 'inst_upi_afa_1',
      });
      const events = [
        createMockChargeEvent(1, 60),
        createMockFailEvent(2, 2, 'MANDATE_LIMIT_EXCEEDED'),
      ];

      const res = evaluateInstrumentHealth(inst, events, { referenceTime: REF_TIME });

      expect(res.featureVector.is_over_afa_threshold).toBe(true);
      expect(res.rootCause).toBe('AFA_PENDING');
      expect(res.recoveryProbability).toBe(0.7);
    });

    it('10. should identify hard declines (USER_CANCELLED_MANDATE) and classify as HARD_DECLINE_PATTERN', () => {
      const inst = createMockInstrument({ rail: 'upi_autopay' });
      const events = [createMockFailEvent(1, 1, 'USER_CANCELLED_MANDATE', 'subscription.halted')];

      const res = evaluateInstrumentHealth(inst, events, { referenceTime: REF_TIME });

      expect(res.rootCause).toBe('HARD_DECLINE_PATTERN');
      expect(res.trajectory).toBe('TERMINAL');
      expect(res.recoveryProbability).toBe(0.2);
    });

    it('11. should penalize revoked mandate as MANDATE_INACTIVE and TERMINAL', () => {
      const inst = createMockInstrument({ mandate_status: 'revoked' });
      const events = [createMockChargeEvent(1, 60)];

      const res = evaluateInstrumentHealth(inst, events, { referenceTime: REF_TIME });

      expect(res.healthScore).toBe(0.15); // 1.0 - 0.85 = 0.15
      expect(res.trajectory).toBe('TERMINAL');
      expect(res.rootCause).toBe('MANDATE_INACTIVE');
      expect(res.recoveryProbability).toBe(0.1);
    });

    it('12. should produce a fully explainable, transparent feature vector with 11 keys', () => {
      const inst = createMockInstrument();
      const events = [createMockChargeEvent(1, 30)];

      const res = evaluateInstrumentHealth(inst, events, { referenceTime: REF_TIME });

      expect(res.featureVector).toHaveProperty('failure_count_last_3_cycles');
      expect(res.featureVector).toHaveProperty('success_count_total');
      expect(res.featureVector).toHaveProperty('consecutive_failures');
      expect(res.featureVector).toHaveProperty('days_to_expiry');
      expect(res.featureVector).toHaveProperty('days_to_expiry_normalized');
      expect(res.featureVector).toHaveProperty('is_near_card_expiry');
      expect(res.featureVector).toHaveProperty('decline_code_distribution');
      expect(res.featureVector).toHaveProperty('is_over_afa_threshold');
      expect(res.featureVector).toHaveProperty('mandate_status');
      expect(res.featureVector).toHaveProperty('last_event_type');
      expect(res.featureVector).toHaveProperty('issuer_prior');
    });
  });

  describe('Expected Recovery Value (ERV) Calculations', () => {
    it('13. should calculate ERV with formula: AmountAtRisk * RecoveryProbability * ActionSuccessRate', () => {
      const inst = createMockInstrument({
        rail: 'card',
        annualized_value: 12000000, // ₹10,000 MRR = 1,000,000 paise
      });

      const healthRes = evaluateInstrumentHealth(inst, [createMockChargeEvent(1, 30)], {
        referenceTime: REF_TIME,
      });

      const erv = calculateERV(inst, healthRes);

      expect(erv.amountAtRisk).toBe(1000000); // 1000000 paise = ₹10,000
      expect(erv.recoveryProbability).toBe(0.98);
      expect(erv.recommendedAction).toBe('smart_retry_optimal_window');
      expect(erv.expectedActionSuccessRate).toBe(0.72); // card + smart_retry

      // Expected: 1,000,000 * 0.98 * 0.72 = 705,600 paise = ₹7,056
      expect(erv.expectedRecoveryValue).toBe(705600);
      expect(erv.expectedRecoveryValueRupees).toBe(7056);
    });

    it('14. should select pre_expiry_card_update_link for card expiry risk and look up 0.88 benchmark rate', () => {
      const expiry10Days = new Date(Date.parse(REF_TIME) + 10 * 86400 * 1000).toISOString();
      const inst = createMockInstrument({
        rail: 'card',
        expiry_date: expiry10Days,
        annualized_value: 6000000, // ₹5,000 MRR = 500,000 paise
      });

      const healthRes = evaluateInstrumentHealth(inst, [createMockChargeEvent(1, 30)], {
        referenceTime: REF_TIME,
      });

      const action = determineRecommendedAction(healthRes.rootCause, inst.rail);
      expect(action).toBe('pre_expiry_card_update_link');

      const erv = calculateERV(inst, healthRes);
      expect(erv.recommendedAction).toBe('pre_expiry_card_update_link');
      expect(erv.expectedActionSuccessRate).toBe(0.88);
      expect(erv.expectedRecoveryValueRupees).toBeGreaterThan(2000);
    });

    it('15. should select mandate_limit_upgrade_link for UPI AFA breaches with 0.68 success rate', () => {
      const inst = createMockInstrument({
        rail: 'upi_autopay',
        annualized_value: 24000000, // ₹20,000 MRR = 2,000,000 paise
      });

      const healthRes = evaluateInstrumentHealth(
        inst,
        [createMockFailEvent(1, 1, 'MANDATE_LIMIT_EXCEEDED')],
        { referenceTime: REF_TIME },
      );

      const erv = calculateERV(inst, healthRes);
      expect(erv.recommendedAction).toBe('mandate_limit_upgrade_link');
      expect(erv.expectedActionSuccessRate).toBe(0.68);
      // ERV = 2,000,000 * 0.70 * 0.68 = 952,000 paise = ₹9,520
      expect(erv.expectedRecoveryValue).toBe(952000);
      expect(erv.expectedRecoveryValueRupees).toBe(9520);
    });

    it('16. should verify entire matrix lookup coverage for all rails and actions', () => {
      const rails: Array<'card' | 'upi_autopay' | 'enach'> = ['card', 'upi_autopay', 'enach'];
      for (const rail of rails) {
        expect(ACTION_SUCCESS_RATE_MATRIX[rail]).toBeDefined();
        expect(ACTION_SUCCESS_RATE_MATRIX[rail].smart_retry_optimal_window).toBeGreaterThan(0.5);
      }
    });
  });
});
