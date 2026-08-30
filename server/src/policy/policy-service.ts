import crypto from 'node:crypto';
import pg from 'pg';
import type { PolicyDecisionRecord, StoredEvent } from '@recovery/shared';
import { EventStore } from '../event-store/event-store.js';
import { getPool } from '../db/connection.js';
import { decide } from './engine.js';
import type { PolicyContext, PolicyRulesConfig } from './types.js';

export interface PolicyServiceResult {
  decision: PolicyDecisionRecord;
  storedEvent: StoredEvent<PolicyDecisionRecord>;
}

export class PolicyService {
  private pool: pg.Pool;
  private eventStore: EventStore;

  constructor(eventStore?: EventStore, pool?: pg.Pool) {
    this.pool = pool || getPool();
    this.eventStore = eventStore || new EventStore(this.pool);
  }

  /**
   * Evaluates a policy context against the deterministic Policy Engine,
   * writes the immutable policy_decisions row, and logs a policy_decision event to EventStore.
   */
  async evaluateAndLog(
    context: PolicyContext,
    customConfig?: PolicyRulesConfig,
  ): Promise<PolicyServiceResult> {
    const outcome = decide(context, customConfig);
    const decisionId = `dec_${crypto.randomUUID()}`;

    const decisionRecord: PolicyDecisionRecord = {
      decisionId,
      instrumentId: context.instrumentId || 'inst_unknown',
      subscriptionId: context.subscriptionId || null,
      result: outcome.result,
      proposedAction: context.proposedAction,
      finalAction: outcome.finalAction,
      ruleIdMatched: outcome.ruleIdMatched,
      reason: outcome.reason,
      parameters: outcome.modifiedParameters,
      evaluatedAt: outcome.evaluatedAt,
    };

    // 1. Insert into policy_decisions table
    const subscriptionIdForDb = context.subscriptionId || context.instrumentId || 'sub_unknown';
    await this.pool.query(
      `INSERT INTO policy_decisions (
        decision_id,
        subscription_id,
        decision,
        target_action,
        evaluated_rules,
        evaluated_at
      ) VALUES ($1, $2, $3, $4, $5, $6);`,
      [
        decisionId,
        subscriptionIdForDb,
        outcome.result,
        outcome.finalAction,
        JSON.stringify([
          {
            ruleId: outcome.ruleIdMatched,
            result: outcome.result,
            reason: outcome.reason,
            parameters: outcome.modifiedParameters || {},
          },
        ]),
        outcome.evaluatedAt,
      ],
    );

    // 2. Append event to EventStore (actor = 'policy_engine')
    const storedEvent = await this.eventStore.appendEvent<PolicyDecisionRecord>({
      subscriptionId: context.subscriptionId || null,
      instrumentId: context.instrumentId || null,
      eventType: 'policy_decision',
      actor: 'policy_engine',
      payload: decisionRecord,
      createdAt: outcome.evaluatedAt,
    });

    return {
      decision: decisionRecord,
      storedEvent,
    };
  }
}
