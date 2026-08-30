import type { InstrumentRail, MandateStatusEnum, SubscriptionStatusEnum } from '@recovery/shared';

export type HealthProfile = 'HEALTHY' | 'DEGRADING' | 'TERMINAL';
export type LtvTier = 'low' | 'medium' | 'high' | 'critical';

export type AfaCategory =
  'standard_retail' | 'mutual_funds' | 'insurance' | 'education' | 'credit_card';

export interface SyntheticSubscriptionSpec {
  index: number;
  subscriptionId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  planId: string;
  planName: string;
  instrumentId: string;
  rail: InstrumentRail;
  mandateStatus: MandateStatusEnum;
  healthProfile: HealthProfile;
  ltvTier: LtvTier;
  monthlyAmount: number; // in paise
  annualizedValue: number; // in paise
  cardDaysToExpiry: number | null;
  cardExpiryDate: string | null;
  isNearCardExpiry: boolean;
  upiAfaThreshold: number; // in paise (₹15,000 or ₹1,00,000)
  isOverAfaThreshold: boolean;
  mccCategory: AfaCategory;
  mccCode: string;
  isStaleCacheCandidate: boolean;
  initialStatus: SubscriptionStatusEnum;
  finalStatus: SubscriptionStatusEnum;
  historyEventCount: number;
  createdAt: string;
  failureReason?: string;
  declineCode?: string;
}

export interface BatchSummaryReport {
  timestamp: string;
  seedUsed: number;
  totalSubscriptions: number;
  countsByRail: Record<InstrumentRail, number>;
  countsByProfile: Record<HealthProfile, number>;
  countsByLtvTier: Record<LtvTier, number>;
  cardsNearExpiryCount: number; // within 0-20 days
  upiOverAfaCount: number;
  staleCacheCandidatesCount: number;
  totalSimulatedMRR: number; // in Rupees
  totalSimulatedARR: number; // in Rupees
  totalEventsSynthesized: number;
}
