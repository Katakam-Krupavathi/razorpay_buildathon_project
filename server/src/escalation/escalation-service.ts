import crypto from 'node:crypto';
import pg from 'pg';
import type { DbEscalationRecord } from '@recovery/shared';
import { EventStore } from '../event-store/event-store.js';
import { getPool } from '../db/connection.js';
import type {
  CreateEscalationParams,
  EscalationFilter,
  ResolveEscalationParams,
} from './types.js';

export class EscalationService {
  private pool: pg.Pool;
  private eventStore: EventStore;

  constructor(pool?: pg.Pool, eventStore?: EventStore) {
    this.pool = pool || getPool();
    this.eventStore = eventStore || new EventStore(this.pool);
  }

  /**
   * Creates a new manual review escalation record in the database and audit log.
   */
  async createEscalation(params: CreateEscalationParams): Promise<DbEscalationRecord> {
    const escalationId = `esc_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    const insertSql = `
      INSERT INTO escalation_queue (
        escalation_id, instrument_id, subscription_id, reason, blocked_reason,
        status, proposed_action, payload, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `;

    const values = [
      escalationId,
      params.instrumentId,
      params.subscriptionId || null,
      params.reason,
      params.blockedReason || null,
      'pending',
      params.proposedAction || null,
      JSON.stringify(params.payload || {}),
      now,
    ];

    const result = await this.pool.query<DbEscalationRecord>(insertSql, values);
    const escalation = result.rows[0];

    // Log escalation_created event to EventStore (actor = 'execution_engine')
    await this.eventStore.appendEvent({
      subscriptionId: params.subscriptionId || null,
      instrumentId: params.instrumentId,
      eventType: 'escalation_created',
      actor: 'execution_engine',
      payload: {
        escalationId,
        instrumentId: params.instrumentId,
        subscriptionId: params.subscriptionId || null,
        reason: params.reason,
        blockedReason: params.blockedReason || null,
        proposedAction: params.proposedAction || null,
        status: 'pending',
      },
      createdAt: now,
    });

    return escalation;
  }

  /**
   * Lists escalation records with optional filters.
   */
  async listEscalations(filter?: EscalationFilter): Promise<DbEscalationRecord[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (filter?.status) {
      conditions.push(`status = $${paramIndex++}`);
      values.push(filter.status);
    }

    if (filter?.instrumentId) {
      conditions.push(`instrument_id = $${paramIndex++}`);
      values.push(filter.instrumentId);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter?.limit || 100;
    const offset = filter?.offset || 0;

    const sql = `
      SELECT * FROM escalation_queue
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++};
    `;

    values.push(limit, offset);
    const result = await this.pool.query<DbEscalationRecord>(sql, values);
    return result.rows;
  }

  /**
   * Gets an escalation by ID.
   */
  async getEscalation(escalationId: string): Promise<DbEscalationRecord | null> {
    const result = await this.pool.query<DbEscalationRecord>(
      'SELECT * FROM escalation_queue WHERE escalation_id = $1;',
      [escalationId],
    );
    return result.rows[0] || null;
  }

  /**
   * Resolves a pending escalation.
   */
  async resolveEscalation(params: ResolveEscalationParams): Promise<DbEscalationRecord> {
    const now = new Date().toISOString();
    const status = params.status || 'resolved';

    const updateSql = `
      UPDATE escalation_queue
      SET status = $1, resolved_at = $2, resolved_by = $3, resolution_notes = $4
      WHERE escalation_id = $5
      RETURNING *;
    `;

    const values = [
      status,
      now,
      params.resolvedBy,
      params.resolutionNotes,
      params.escalationId,
    ];

    const result = await this.pool.query<DbEscalationRecord>(updateSql, values);
    if (result.rows.length === 0) {
      throw new Error(`Escalation with ID '${params.escalationId}' not found.`);
    }

    const updated = result.rows[0];

    // Log escalation_resolved event to EventStore (actor = 'human')
    await this.eventStore.appendEvent({
      subscriptionId: updated.subscription_id,
      instrumentId: updated.instrument_id,
      eventType: 'escalation_resolved',
      actor: 'human',
      payload: {
        escalationId: updated.escalation_id,
        instrumentId: updated.instrument_id,
        subscriptionId: updated.subscription_id,
        resolvedBy: params.resolvedBy,
        resolutionNotes: params.resolutionNotes,
        status,
        resolvedAt: now,
      },
      createdAt: now,
    });

    return updated;
  }
}
