import crypto from 'node:crypto';
import pg from 'pg';
import type { DbInstrument, HealthEvaluationResult, ERVCalculationResult } from '@recovery/shared';
import { EventStore } from '../event-store/event-store.js';
import { getPool } from '../db/connection.js';
import { evaluateInstrumentHealth, type ScorerOptions } from './scorer.js';
import { calculateERV, type ERVOptions } from './erv-engine.js';

export interface HealthServiceResult {
  snapshotId: string;
  health: HealthEvaluationResult;
  erv: ERVCalculationResult;
  eventId: string;
  sequenceNumber: number;
}

export class HealthService {
  private pool: pg.Pool;
  private eventStore: EventStore;

  constructor(eventStore?: EventStore, pool?: pg.Pool) {
    this.pool = pool || getPool();
    this.eventStore = eventStore || new EventStore(this.pool);
  }

  /**
   * Fetches an instrument by ID.
   */
  async getInstrument(instrumentId: string): Promise<DbInstrument | null> {
    const res = await this.pool.query<DbInstrument>(
      'SELECT * FROM instruments WHERE instrument_id = $1;',
      [instrumentId],
    );
    return res.rows[0] || null;
  }

  /**
   * Evaluates an instrument's risk & ERV, persists an immutable row to health_snapshots,
   * and appends a health_recomputed audit event into the Event Store.
   */
  async evaluateAndPersist(
    instrumentId: string,
    options?: ScorerOptions & ERVOptions,
  ): Promise<HealthServiceResult> {
    const instrument = await this.getInstrument(instrumentId);
    if (!instrument) {
      throw new Error(`Instrument not found: ${instrumentId}`);
    }

    // 1. Fetch historical events for this instrument and its subscription
    const [instEvents, subEvents] = await Promise.all([
      this.eventStore.getEventsForInstrument(instrumentId),
      instrument.subscription_id
        ? this.eventStore.getEventsForSubscription(instrument.subscription_id)
        : Promise.resolve([]),
    ]);

    // Merge and deduplicate by eventId
    const eventMap = new Map();
    for (const e of [...instEvents, ...subEvents]) {
      eventMap.set(e.eventId, e);
    }
    const combinedEvents = Array.from(eventMap.values());

    // 2. Pure Health & ERV computation
    const health = evaluateInstrumentHealth(instrument, combinedEvents, options);
    const erv = calculateERV(instrument, health, options);

    const snapshotId = `snap_${crypto.randomUUID()}`;
    health.snapshotId = snapshotId;

    // 3. Persist immutable record in health_snapshots
    await this.pool.query(
      `INSERT INTO health_snapshots (
        snapshot_id,
        instrument_id,
        health_score,
        trajectory,
        root_cause,
        recovery_probability,
        features,
        computed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`,
      [
        snapshotId,
        instrument.instrument_id,
        health.healthScore,
        health.trajectory,
        health.rootCause,
        health.recoveryProbability,
        JSON.stringify(health.featureVector),
        health.computedAt,
      ],
    );

    // 4. Log audit event into hash-chained Event Store (actor = 'health_scorer')
    const storedEvent = await this.eventStore.appendEvent({
      subscriptionId: instrument.subscription_id,
      instrumentId: instrument.instrument_id,
      eventType: 'health_recomputed',
      actor: 'health_scorer',
      payload: {
        snapshotId,
        healthScore: health.healthScore,
        trajectory: health.trajectory,
        rootCause: health.rootCause,
        recoveryProbability: health.recoveryProbability,
        amountAtRiskPaise: erv.amountAtRisk,
        expectedRecoveryValuePaise: erv.expectedRecoveryValue,
        recommendedAction: erv.recommendedAction,
        featureVector: health.featureVector,
      },
      createdAt: health.computedAt,
    });

    return {
      snapshotId,
      health,
      erv,
      eventId: storedEvent.eventId,
      sequenceNumber: storedEvent.sequenceNumber,
    };
  }
}
