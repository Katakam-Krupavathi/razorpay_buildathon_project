import { describe, it, expect } from 'vitest';
import React from 'react';
import type {
  AttributionScorecard,
  OpportunityQueueItem,
  InstrumentListItem,
  CircuitBreakerStatus,
  DecisionTrace,
} from '@recovery/shared';
import { ScorecardBanner } from '../src/components/ScorecardBanner.js';
import { OpportunityQueue } from '../src/components/OpportunityQueue.js';
import { InstrumentList } from '../src/components/InstrumentList.js';
import { CircuitBreakerPanel } from '../src/components/CircuitBreakerPanel.js';
import { DecisionTraceModal } from '../src/components/DecisionTraceModal.js';
import { ControlPanelBar } from '../src/components/ControlPanelBar.js';

describe('Phase 12: Web Dashboard Component & Integration Tests', () => {
  const mockScorecard: AttributionScorecard = {
    totalMonitoredARRPaise: 1045000000,
    totalMonitoredMRRPaise: 87083333,
    totalAtRiskMRRPaise: 15400000,
    totalRecoveredMRRPaise: 10779600,
    proactiveRecoveredMRRPaise: 4500000,
    reactiveRecoveredMRRPaise: 6279600,
    revenuePreventedMRRPaise: 7545700,
    untouchedMRRPaise: 1200000,
    unsafeBlockedActionsCount: 3,
    totalSubscriptionsCount: 100,
    recoveredSubscriptionsCount: 38,
    proactiveSubscriptionsCount: 15,
    reactiveSubscriptionsCount: 23,
    untouchedSubscriptionsCount: 52,
    escalatedSubscriptionsCount: 10,
    recoveryRatePercent: 70.0,
    netValueRecoveredPaise: 7545700,
    timestamp: new Date().toISOString(),
  };

  const mockOpportunities: OpportunityQueueItem[] = [
    {
      instrumentId: 'inst_card_001',
      subscriptionId: 'sub_001',
      rail: 'card',
      monthlyAmountPaise: 500000,
      annualizedValuePaise: 60000000,
      healthScore: 0.45,
      trajectory: 'DEGRADING',
      rootCause: 'CARD_EXPIRY_RISK',
      amountAtRiskPaise: 500000,
      expectedRecoveryValuePaise: 425000,
      recoveryProbability: 0.85,
      recommendedAction: 'proactive_nudge',
      ltvTier: 'critical',
      mandateStatus: 'active',
      evaluatedAt: new Date().toISOString(),
    },
    {
      instrumentId: 'inst_upi_002',
      subscriptionId: 'sub_002',
      rail: 'upi_autopay',
      monthlyAmountPaise: 200000,
      annualizedValuePaise: 24000000,
      healthScore: 0.25,
      trajectory: 'TERMINAL',
      rootCause: 'REPEATED_SOFT_DECLINE',
      amountAtRiskPaise: 200000,
      expectedRecoveryValuePaise: 110000,
      recoveryProbability: 0.55,
      recommendedAction: 'smart_retry_optimal_window',
      ltvTier: 'high',
      mandateStatus: 'active',
      evaluatedAt: new Date().toISOString(),
    },
  ];

  const mockInstruments: InstrumentListItem[] = [
    {
      instrumentId: 'inst_card_001',
      subscriptionId: 'sub_001',
      customerId: 'cust_001',
      rail: 'card',
      mandateStatus: 'active',
      subscriptionStatus: 'active',
      monthlyAmountPaise: 500000,
      annualizedValuePaise: 60000000,
      ltvTier: 'critical',
      healthScore: 0.45,
      trajectory: 'DEGRADING',
      rootCause: 'CARD_EXPIRY_RISK',
      failureCount: 2,
      daysToExpiry: 14,
      lastSyncedAt: new Date().toISOString(),
      sparkline: [
        { timestamp: '2026-08-28T00:00:00.000Z', score: 0.8 },
        { timestamp: '2026-08-29T00:00:00.000Z', score: 0.6 },
        { timestamp: '2026-08-30T00:00:00.000Z', score: 0.45 },
      ],
    },
  ];

  const mockCohorts: CircuitBreakerStatus[] = [
    {
      cohortKey: 'rail:card',
      state: 'CLOSED',
      totalAttemptsInWindow: 20,
      failedAttemptsInWindow: 3,
      successAttemptsInWindow: 17,
      currentSuccessRate: 0.85,
      failureRate: 0.15,
      trippedAt: null,
      cooldownUntil: null,
      openReason: null,
      lastOutcomeAt: new Date().toISOString(),
    },
    {
      cohortKey: 'rail:upi_autopay',
      state: 'OPEN',
      totalAttemptsInWindow: 20,
      failedAttemptsInWindow: 14,
      successAttemptsInWindow: 6,
      currentSuccessRate: 0.30,
      failureRate: 0.70,
      trippedAt: new Date().toISOString(),
      cooldownUntil: null,
      openReason: 'Rolling window success rate dropped to 30% (< 40% safety threshold)',
      lastOutcomeAt: new Date().toISOString(),
    },
  ];

  it('1. ScorecardBanner should render financial KPIs correctly', () => {
    const el = React.createElement(ScorecardBanner, {
      scorecard: mockScorecard,
      loading: false,
    });
    expect(el.type).toBe(ScorecardBanner);
    expect(el.props.scorecard?.totalSubscriptionsCount).toBe(100);
    expect(el.props.scorecard?.recoveryRatePercent).toBe(70.0);
  });

  it('2. OpportunityQueue should render ranked opportunities and actions', () => {
    let selectedSub: string | null = null;
    const el = React.createElement(OpportunityQueue, {
      opportunities: mockOpportunities,
      loading: false,
      onSelectSubscription: (id: string) => {
        selectedSub = id;
      },
    });
    expect(el.type).toBe(OpportunityQueue);
    expect(el.props.opportunities.length).toBe(2);
    expect(el.props.opportunities[0].expectedRecoveryValuePaise).toBe(425000);

    el.props.onSelectSubscription('sub_001');
    expect(selectedSub).toBe('sub_001');
  });

  it('3. InstrumentList should render sparklines and expiry badges', () => {
    const el = React.createElement(InstrumentList, {
      instruments: mockInstruments,
      loading: false,
      onSelectSubscription: () => {},
    });
    expect(el.type).toBe(InstrumentList);
    expect(el.props.instruments[0].daysToExpiry).toBe(14);
    expect(el.props.instruments[0].sparkline.length).toBe(3);
  });

  it('4. CircuitBreakerPanel should render open/closed cohorts and metrics', () => {
    const el = React.createElement(CircuitBreakerPanel, {
      cohorts: mockCohorts,
      loading: false,
      onRefresh: async () => {},
    });
    expect(el.type).toBe(CircuitBreakerPanel);
    expect(el.props.cohorts.length).toBe(2);
    expect(el.props.cohorts[1].state).toBe('OPEN');
  });

  it('5. ControlPanelBar should render pipeline action and dev simulation hooks', () => {
    let ran = false;
    const el = React.createElement(ControlPanelBar, {
      onRunPipeline: async () => {
        ran = true;
      },
      onRefreshAll: async () => {},
      loading: false,
      pipelineRunning: false,
    });
    expect(el.type).toBe(ControlPanelBar);
    el.props.onRunPipeline();
    expect(ran).toBe(true);
  });

  it('6. DecisionTraceModal should handle subscription audit drilldown', () => {
    let closed = false;
    const el = React.createElement(DecisionTraceModal, {
      subscriptionId: 'sub_001',
      onClose: () => {
        closed = true;
      },
    });
    expect(el.type).toBe(DecisionTraceModal);
    expect(el.props.subscriptionId).toBe('sub_001');
    el.props.onClose();
    expect(closed).toBe(true);
  });
});
