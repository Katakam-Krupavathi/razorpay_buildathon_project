import { PRNG } from './prng.js';
import type { SyntheticSubscriptionSpec, HealthProfile, LtvTier, AfaCategory } from './types.js';
import type { InstrumentRail, MandateStatusEnum, SubscriptionStatusEnum } from '@recovery/shared';

const COMPANY_NAMES = [
  'Acme Corp',
  'Starlight Labs',
  'Nexus Fintech',
  'Quantum Soft',
  'Apex Analytics',
  'CloudScale Systems',
  'Vanguard Media',
  'Pulse Healthtech',
  'Zenith Logistics',
  'Aura Retail',
  'Hyperion AI',
  'BlueShift Data',
  'Solaris Energy',
  'Horizon Gaming',
  'Summit Mobility',
];

const MCC_CATEGORIES: Array<{
  category: AfaCategory;
  mcc: string;
  thresholdPaise: number;
  weight: number;
}> = [
  { category: 'standard_retail', mcc: '5818', thresholdPaise: 1500000, weight: 60 }, // ₹15,000
  { category: 'mutual_funds', mcc: '6211', thresholdPaise: 10000000, weight: 12 }, // ₹1,00,000
  { category: 'insurance', mcc: '6300', thresholdPaise: 10000000, weight: 12 }, // ₹1,00,000
  { category: 'education', mcc: '8220', thresholdPaise: 10000000, weight: 8 }, // ₹1,00,000
  { category: 'credit_card', mcc: '6012', thresholdPaise: 10000000, weight: 8 }, // ₹1,00,000
];

export interface GeneratorOptions {
  count?: number;
  seed?: number;
  baseTimestamp?: number;
}

export class SyntheticDataGenerator {
  private prng: PRNG;
  private seed: number;
  private baseTimestamp: number;

  constructor(options?: GeneratorOptions) {
    this.seed = options?.seed ?? 42;
    this.baseTimestamp = options?.baseTimestamp ?? 1770000000000;
    this.prng = new PRNG(this.seed);
  }

  public getSeed(): number {
    return this.seed;
  }

  public generate(count = 100): SyntheticSubscriptionSpec[] {
    const specs: SyntheticSubscriptionSpec[] = [];

    for (let i = 1; i <= count; i++) {
      specs.push(this.generateSingle(i));
    }

    return specs;
  }

  private generateSingle(index: number): SyntheticSubscriptionSpec {
    // 1. Pick Rail (~45% UPI, ~40% Card, ~15% E-NACH)
    const rail: InstrumentRail = this.prng.weightedPick([
      { item: 'upi_autopay', weight: 45 },
      { item: 'card', weight: 40 },
      { item: 'enach', weight: 15 },
    ]);

    // 2. Pick Health Profile (~60% Healthy, ~25% Degrading, ~15% Terminal)
    const healthProfile: HealthProfile = this.prng.weightedPick([
      { item: 'HEALTHY', weight: 60 },
      { item: 'DEGRADING', weight: 25 },
      { item: 'TERMINAL', weight: 15 },
    ]);

    // 3. Pick LTV Tier and compute Monthly Amount / Annualized Value
    const ltvTier: LtvTier = this.prng.weightedPick([
      { item: 'low', weight: 35 },
      { item: 'medium', weight: 40 },
      { item: 'high', weight: 18 },
      { item: 'critical', weight: 7 },
    ]);

    let monthlyAmount: number; // in paise
    switch (ltvTier) {
      case 'low':
        monthlyAmount = this.prng.nextInt(49900, 149900); // ₹499 - ₹1,499
        break;
      case 'medium':
        monthlyAmount = this.prng.nextInt(199900, 499900); // ₹1,999 - ₹4,999
        break;
      case 'high':
        monthlyAmount = this.prng.nextInt(750000, 1999900); // ₹7,500 - ₹19,999
        break;
      case 'critical':
        monthlyAmount = this.prng.nextInt(2500000, 10000000); // ₹25,000 - ₹1,00,000
        break;
    }

    const annualizedValue = monthlyAmount * 12;

    // 4. MCC Category & AFA Thresholds (for UPI & E-NACH)
    const mccConfig = this.prng.weightedPick(
      MCC_CATEGORIES.map((c) => ({ item: c, weight: c.weight })),
    );
    const upiAfaThreshold = mccConfig.thresholdPaise;
    const isOverAfaThreshold = monthlyAmount > upiAfaThreshold;

    // 5. Card Expiry Days & Date (for Cards)
    let cardDaysToExpiry: number | null = null;
    let cardExpiryDate: string | null = null;
    let isNearCardExpiry = false;

    if (rail === 'card') {
      // Pick days to expiry: ~25% within 0-20 days, ~35% within 21-90 days, ~40% within 91-720 days
      const bucket = this.prng.weightedPick([
        { item: 'near', weight: 25 },
        { item: 'medium', weight: 35 },
        { item: 'far', weight: 40 },
      ]);

      if (bucket === 'near') {
        cardDaysToExpiry = this.prng.nextInt(0, 20);
        isNearCardExpiry = true;
      } else if (bucket === 'medium') {
        cardDaysToExpiry = this.prng.nextInt(21, 90);
      } else {
        cardDaysToExpiry = this.prng.nextInt(91, 720);
      }

      const expiry = new Date(this.baseTimestamp + cardDaysToExpiry * 86400 * 1000);
      cardExpiryDate = expiry.toISOString();
    }

    // 6. Stale Cache Candidate Selection (~6% chance, regardless of rail)
    // Seeded with active mandate in DB, but flagged for verification gateway to detect revocation
    const isStaleCacheCandidate = this.prng.chance(0.06);

    // 7. Determine Final Status & Failure Reason
    let initialStatus: SubscriptionStatusEnum = 'active';
    let finalStatus: SubscriptionStatusEnum = 'active';
    let mandateStatus: MandateStatusEnum = 'active';
    let failureReason: string | undefined;
    let declineCode: string | undefined;

    if (healthProfile === 'HEALTHY') {
      initialStatus = 'active';
      finalStatus = 'active';
      mandateStatus = 'active';
    } else if (healthProfile === 'DEGRADING') {
      initialStatus = 'active';
      finalStatus = 'pending';
      mandateStatus = 'active';

      if (isOverAfaThreshold && rail === 'upi_autopay') {
        declineCode = 'MANDATE_LIMIT_EXCEEDED';
        failureReason = `Transaction amount ₹${monthlyAmount / 100} exceeds RBI AFA limit of ₹${upiAfaThreshold / 100}`;
      } else if (
        isNearCardExpiry &&
        rail === 'card' &&
        cardDaysToExpiry !== null &&
        cardDaysToExpiry <= 5
      ) {
        declineCode = 'EXPIRED_CARD';
        failureReason = 'Card instrument expired or expiring during debit window';
      } else {
        declineCode = this.prng.pick([
          'INSUFFICIENT_FUNDS',
          'TEMPORARY_BANK_DOWNTIME',
          'NETWORK_TIMEOUT',
        ]);
        failureReason =
          'Customer account balance below required debit amount or bank switch timeout';
      }
    } else {
      // TERMINAL
      initialStatus = 'active';
      finalStatus = 'halted';
      mandateStatus = this.prng.pick(['revoked', 'expired', 'paused']);

      declineCode = this.prng.pick([
        'USER_CANCELLED_MANDATE',
        'HARD_DECLINE_FRAUD_BLOCK',
        'ACCOUNT_BLOCKED',
        'MAX_RETRIES_EXCEEDED',
      ]);
      failureReason =
        'Mandate revoked by user at bank/UPI app or permanent payment instrument invalidation';
    }

    // 8. Event history count
    const historyEventCount =
      healthProfile === 'HEALTHY'
        ? this.prng.nextInt(3, 8)
        : healthProfile === 'DEGRADING'
          ? this.prng.nextInt(4, 9)
          : this.prng.nextInt(5, 12);

    const paddedId = String(index).padStart(4, '0');
    const company = COMPANY_NAMES[(index - 1) % COMPANY_NAMES.length];

    return {
      index,
      subscriptionId: `sub_synth_${paddedId}`,
      customerId: `cust_synth_${paddedId}`,
      customerName: `${company} (${index})`,
      customerEmail: `billing-${paddedId}@${company.toLowerCase().replace(/[^a-z0-9]/g, '')}.test`,
      customerPhone: `+9198${this.prng.nextInt(10000000, 99999999)}`,
      planId: `plan_tier_${ltvTier}_${(index % 4) + 1}`,
      planName: `${ltvTier.toUpperCase()} Pro Plan (${mccConfig.category})`,
      instrumentId: `inst_${rail.slice(0, 4)}_${paddedId}`,
      rail,
      mandateStatus,
      healthProfile,
      ltvTier,
      monthlyAmount,
      annualizedValue,
      cardDaysToExpiry,
      cardExpiryDate,
      isNearCardExpiry,
      upiAfaThreshold,
      isOverAfaThreshold,
      mccCategory: mccConfig.category,
      mccCode: mccConfig.mcc,
      isStaleCacheCandidate,
      initialStatus,
      finalStatus,
      historyEventCount,
      createdAt: new Date(
        this.baseTimestamp - this.prng.nextInt(30, 365) * 86400 * 1000,
      ).toISOString(),
      failureReason,
      declineCode,
    };
  }
}
