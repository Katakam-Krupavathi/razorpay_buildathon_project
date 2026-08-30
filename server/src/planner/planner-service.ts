import pg from 'pg';
import type { ProposedActionRecord, StoredEvent } from '@recovery/shared';
import { EventStore } from '../event-store/event-store.js';
import { getPool } from '../db/connection.js';
import { HealthService } from '../risk/health-service.js';
import { formulateRecoveryPlan } from './planner.js';
import type { PlannerOptions } from './types.js';

export interface PlannerServiceResult {
  proposal: ProposedActionRecord;
  storedEvent: StoredEvent<ProposedActionRecord>;
}

/**
 * Service orchestrating recovery planning and immutable event store audit logging.
 *
 * ZERO EXECUTION AUTHORITY GUARANTEE:
 * This service only computes and records proposals in the audit ledger.
 * It never triggers payments or sends notifications.
 */
export class RecoveryPlannerService {
  private pool: pg.Pool;
  private eventStore: EventStore;
  private healthService: HealthService;

  constructor(eventStore?: EventStore, pool?: pg.Pool) {
    this.pool = pool || getPool();
    this.eventStore = eventStore || new EventStore(this.pool);
    this.healthService = new HealthService(this.eventStore, this.pool);
  }

  /**
   * Evaluates an instrument, formulates a recovery proposal, and logs it to EventStore.
   */
  async planAndLog(instrumentId: string, options?: PlannerOptions): Promise<PlannerServiceResult> {
    const instrument = await this.healthService.getInstrument(instrumentId);
    if (!instrument) {
      throw new Error(`Instrument not found: ${instrumentId}`);
    }

    // 1. Evaluate health & ERV
    const healthResult = await this.healthService.evaluateAndPersist(instrumentId, {
      referenceTime: options?.referenceTime,
    });

    // 2. Pure plan formulation (advisory only)
    const proposal = formulateRecoveryPlan(
      {
        instrument,
        health: healthResult.health,
        erv: healthResult.erv,
        ltvTier: instrument.ltv_tier,
      },
      options,
    );

    // 3. Log advisory proposed_action event into EventStore (actor = 'recovery_planner')
    const storedEvent = await this.eventStore.appendEvent<ProposedActionRecord>({
      subscriptionId: instrument.subscription_id,
      instrumentId: instrument.instrument_id,
      eventType: 'proposed_action',
      actor: 'recovery_planner',
      payload: proposal,
      createdAt: proposal.evaluatedAt,
    });

    return {
      proposal,
      storedEvent,
    };
  }
}
