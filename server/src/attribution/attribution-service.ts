import crypto from 'node:crypto';
import pg from 'pg';
import type {
  DbRecoveryOutcome,
  AttributionScorecard,
  DbInstrument,
  DbEscalationRecord,
} from '@recovery/shared';
import { EventStore } from '../event-store/event-store.js';
import { getPool } from '../db/connection.js';
import { CounterfactualEngine } from './counterfactual-engine.js';
import type { OutcomeEvaluationInput, RecordOutcomeParams } from './types.js';

export class AttributionService {
  private pool: pg.Pool;
  private eventStore: EventStore;
  private counterfactualEngine: CounterfactualEngine;

  constructor(
    pool?: pg.Pool,
    eventStore?: EventStore,
    counterfactualEngine?: CounterfactualEngine,
  ) {
    this.pool = pool || getPool();
    this.eventStore = eventStore || new EventStore(this.pool);
    this.counterfactualEngine = counterfactualEngine || new CounterfactualEngine();
  }

  /**
   * Persists a recovery outcome row in the database and emits an audit event.
   */
  async recordOutcome(params: RecordOutcomeParams): Promise<DbRecoveryOutcome> {
    const outcomeId = params.outcomeId || `out_${crypto.randomUUID()}`;
    const now = params.closedAt ? new Date(params.closedAt).toISOString() : new Date().toISOString();
    const costIncurred = params.costIncurred ?? 0;
    const netValueRecovered = params.recoveredAmount - costIncurred;

    const sql = `
      INSERT INTO recovery_outcomes (
        outcome_id, invoice_id, subscription_id, instrument_id, at_risk_amount,
        recovered_amount, cost_incurred, net_value_recovered, recovery_type,
        status, estimated_baseline_outcome, baseline_recovered_estimate,
        revenue_saved, counterfactual_details, completed_at, closed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (outcome_id) DO UPDATE SET
        recovered_amount = EXCLUDED.recovered_amount,
        cost_incurred = EXCLUDED.cost_incurred,
        net_value_recovered = EXCLUDED.net_value_recovered,
        recovery_type = EXCLUDED.recovery_type,
        status = EXCLUDED.status,
        revenue_saved = EXCLUDED.revenue_saved,
        counterfactual_details = EXCLUDED.counterfactual_details,
        closed_at = EXCLUDED.closed_at
      RETURNING *;
    `;

    const values = [
      outcomeId,
      params.invoiceId || null,
      params.subscriptionId,
      params.instrumentId || null,
      params.atRiskAmount,
      params.recoveredAmount,
      costIncurred,
      netValueRecovered,
      params.recoveryType,
      params.status,
      params.estimatedBaselineOutcome,
      params.baselineRecoveredEstimate,
      params.revenueSaved,
      JSON.stringify(params.counterfactualDetails || {}),
      now,
      now,
    ];

    const res = await this.pool.query<DbRecoveryOutcome>(sql, values);
    const outcome = res.rows[0];

    // Log recovery_recorded event to EventStore (actor = 'execution_engine')
    await this.eventStore.appendEvent({
      subscriptionId: params.subscriptionId,
      instrumentId: params.instrumentId,
      eventType: 'recovery_recorded',
      actor: 'execution_engine',
      payload: {
        outcomeId,
        subscriptionId: params.subscriptionId,
        instrumentId: params.instrumentId,
        recoveryType: params.recoveryType,
        status: params.status,
        atRiskAmountPaise: params.atRiskAmount,
        recoveredAmountPaise: params.recoveredAmount,
        costIncurredPaise: costIncurred,
        netValueRecoveredPaise: netValueRecovered,
        revenueSavedPaise: params.revenueSaved,
        estimatedBaselineOutcome: params.estimatedBaselineOutcome,
        baselineRecoveredEstimatePaise: params.baselineRecoveredEstimate,
        details: params.counterfactualDetails || {},
      },
      createdAt: now,
    });

    return outcome;
  }

  /**
   * Lists recovery outcome records with optional filters.
   */
  async listOutcomes(filter?: {
    recoveryType?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<DbRecoveryOutcome[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (filter?.recoveryType) {
      conditions.push(`recovery_type = $${paramIndex++}`);
      values.push(filter.recoveryType);
    }

    if (filter?.status) {
      conditions.push(`status = $${paramIndex++}`);
      values.push(filter.status);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter?.limit || 100;
    const offset = filter?.offset || 0;

    const sql = `
      SELECT * FROM recovery_outcomes
      ${whereClause}
      ORDER BY closed_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++};
    `;

    values.push(limit, offset);
    const res = await this.pool.query<DbRecoveryOutcome>(sql, values);
    return res.rows;
  }

  /**
   * Evaluates counterfactuals and records recovery outcome in a single step.
   */
  async evaluateAndRecord(input: OutcomeEvaluationInput): Promise<DbRecoveryOutcome> {
    const cf = this.counterfactualEngine.evaluate(input);

    // Compute standard transaction cost (e.g. 50 paise payment API cost, 25 paise notification cost)
    let costIncurredPaise = input.costIncurredPaise || 0;
    if (cf.recoveryType === 'proactive') costIncurredPaise = 25; // ₹0.25 notification cost
    else if (cf.recoveryType === 'reactive') costIncurredPaise = 50; // ₹0.50 charge trigger cost

    const status = cf.recoveredAmountPaise > 0 ? 'recovered' : (input.execution?.status === 'escalated' ? 'in_progress' : (input.execution?.action === 'NO_ACTION' ? 'untouched' : 'halted'));

    return this.recordOutcome({
      subscriptionId: input.instrument.subscription_id || `sub_${input.instrument.instrument_id}`,
      instrumentId: input.instrument.instrument_id,
      atRiskAmount: cf.atRiskAmountPaise,
      recoveredAmount: cf.recoveredAmountPaise,
      costIncurred: costIncurredPaise,
      recoveryType: cf.recoveryType,
      status,
      estimatedBaselineOutcome: cf.estimatedBaselineOutcome,
      baselineRecoveredEstimate: cf.baselineRecoveredEstimatePaise,
      revenueSaved: cf.revenueSavedPaise,
      counterfactualDetails: {
        ...cf.details,
        method: cf.method,
        confidence: cf.confidence,
      },
      closedAt: input.referenceTime,
    });
  }

  /**
   * Computes the complete aggregate Financial Attribution Scorecard.
   */
  async getScorecard(): Promise<AttributionScorecard> {
    // 1. Fetch all instruments
    const instRes = await this.pool.query<DbInstrument>('SELECT * FROM instruments;');
    const instruments = instRes.rows;

    let totalMonitoredMRRPaise = 0;
    let totalMonitoredARRPaise = 0;
    for (const inst of instruments) {
      const arr = Number(inst.annualized_value);
      totalMonitoredARRPaise += arr;
      totalMonitoredMRRPaise += Math.round(arr / 12);
    }

    // 2. Fetch all recorded outcomes
    const outRes = await this.pool.query<DbRecoveryOutcome>('SELECT * FROM recovery_outcomes;');
    const outcomes = outRes.rows;

    // 3. Fetch escalations count
    const escRes = await this.pool.query<DbEscalationRecord>('SELECT * FROM escalation_queue;');
    const escalations = escRes.rows;

    // 4. Fetch blocked decisions count
    let unsafeBlockedActionsCount = 0;
    try {
      const events = await this.eventStore.getAllEvents({ limit: 5000 });
      unsafeBlockedActionsCount = events.filter(
        (e) =>
          e.eventType === 'circuit_breaker.tripped' ||
          e.eventType === 'stale_state_detected' ||
          (e.eventType === 'action_blocked'),
      ).length;
    } catch {
      unsafeBlockedActionsCount = 0;
    }

    let totalAtRiskMRRPaise = 0;
    let totalRecoveredMRRPaise = 0;
    let proactiveRecoveredMRRPaise = 0;
    let reactiveRecoveredMRRPaise = 0;
    let revenuePreventedMRRPaise = 0;
    let untouchedMRRPaise = 0;
    let recoveredSubscriptionsCount = 0;
    let proactiveSubscriptionsCount = 0;
    let reactiveSubscriptionsCount = 0;
    let untouchedSubscriptionsCount = 0;
    let netValueRecoveredPaise = 0;

    for (const out of outcomes) {
      totalAtRiskMRRPaise += Number(out.at_risk_amount);
      totalRecoveredMRRPaise += Number(out.recovered_amount);
      revenuePreventedMRRPaise += Number(out.revenue_saved);
      netValueRecoveredPaise += Number(out.net_value_recovered);

      if (out.recovery_type === 'proactive') {
        proactiveRecoveredMRRPaise += Number(out.recovered_amount);
        proactiveSubscriptionsCount++;
        recoveredSubscriptionsCount++;
      } else if (out.recovery_type === 'reactive' && out.status === 'recovered') {
        reactiveRecoveredMRRPaise += Number(out.recovered_amount);
        reactiveSubscriptionsCount++;
        recoveredSubscriptionsCount++;
      } else if (out.status === 'untouched' || out.recovery_type === 'none') {
        const monthly = Math.round(
          Number(
            instruments.find((i: { instrument_id?: string; annualized_value?: number | string }) => i.instrument_id === out.instrument_id)?.annualized_value || 0,
          ) / 12,
        );
        untouchedMRRPaise += monthly;
        untouchedSubscriptionsCount++;
      }
    }

    const recoveryRatePercent =
      totalAtRiskMRRPaise > 0
        ? Math.min(100, Math.round((totalRecoveredMRRPaise / totalAtRiskMRRPaise) * 100))
        : 100;

    return {
      totalMonitoredMRRPaise,
      totalMonitoredARRPaise,
      totalAtRiskMRRPaise,
      totalRecoveredMRRPaise,
      proactiveRecoveredMRRPaise,
      reactiveRecoveredMRRPaise,
      revenuePreventedMRRPaise,
      untouchedMRRPaise,
      unsafeBlockedActionsCount,
      totalSubscriptionsCount: instruments.length,
      recoveredSubscriptionsCount,
      proactiveSubscriptionsCount,
      reactiveSubscriptionsCount,
      untouchedSubscriptionsCount,
      escalatedSubscriptionsCount: escalations.length,
      recoveryRatePercent,
      netValueRecoveredPaise,
      timestamp: new Date().toISOString(),
    };
  }

  getCounterfactualEngine(): CounterfactualEngine {
    return this.counterfactualEngine;
  }
}
