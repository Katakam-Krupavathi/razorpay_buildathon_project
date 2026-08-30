import crypto from 'node:crypto';
import pg from 'pg';
import type {
  EscalationRecord,
  EscalationStatus,
} from '@recovery/shared';
import { getPool } from '../db/connection.js';
import { EventStore } from '../event-store/event-store.js';

interface DbEscalationRow {
  escalation_id: string;
  subscription_id: string | null;
  instrument_id: string;
  decision_id: string | null;
  status: EscalationStatus;
  trigger_reason: string;
  metadata: Record<string, unknown>;
  created_at: Date | string;
  resolved_at: Date | string | null;
  resolved_by: string | null;
  resolution_notes: string | null;
}

export interface CreateEscalationParams {
  subscriptionId?: string | null;
  instrumentId: string;
  decisionId?: string | null;
  triggerReason: string;
  metadata?: Record<string, unknown>;
}

export interface ListEscalationsFilter {
  status?: EscalationStatus;
  instrumentId?: string;
  subscriptionId?: string;
  limit?: number;
  offset?: number;
}

/**
 * Human Review Escalation Service.
 *
 * Manages the operations reviewer escalation queue triggered by policy blocks,
 * circuit breaker trips, or pre-action stale state detections.
 */
export class EscalationService {
  private pool: pg.Pool;
  private eventStore?: EventStore;

  constructor(pool?: pg.Pool, eventStore?: EventStore) {
    this.pool = pool || getPool();
    this.eventStore = eventStore;
  }

  private mapRow(row: DbEscalationRow): EscalationRecord {
    return {
      escalationId: row.escalation_id,
      subscriptionId: row.subscription_id,
      instrumentId: row.instrument_id,
      decisionId: row.decision_id,
      status: row.status,
      triggerReason: row.trigger_reason,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {},
      createdAt: new Date(row.created_at).toISOString(),
      resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
      resolvedBy: row.resolved_by,
      resolutionNotes: row.resolution_notes,
    };
  }

  /**
   * Creates a new escalation record and persists it to the database.
   */
  async createEscalation(params: CreateEscalationParams): Promise<EscalationRecord> {
    const escalationId = `esc_${crypto.randomUUID()}`;
    const metadata = params.metadata || {};

    const query = `
      INSERT INTO escalations (
        escalation_id, subscription_id, instrument_id, decision_id,
        status, trigger_reason, metadata, created_at
      ) VALUES ($1, $2, $3, $4, 'pending', $5, $6, NOW())
      RETURNING *;
    `;

    const values = [
      escalationId,
      params.subscriptionId || null,
      params.instrumentId,
      params.decisionId || null,
      params.triggerReason,
      JSON.stringify(metadata),
    ];

    const result = await this.pool.query<DbEscalationRow>(query, values);
    const record = this.mapRow(result.rows[0]);

    if (this.eventStore) {
      await this.eventStore.appendEvent({
        subscriptionId: record.subscriptionId,
        instrumentId: record.instrumentId,
        eventType: 'escalation_created',
        actor: 'execution_engine',
        payload: record,
        createdAt: record.createdAt,
      });
    }

    return record;
  }

  /**
   * Lists escalations with optional status and pagination filters.
   */
  async listEscalations(filter?: ListEscalationsFilter): Promise<EscalationRecord[]> {
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

    if (filter?.subscriptionId) {
      conditions.push(`subscription_id = $${paramIndex++}`);
      values.push(filter.subscriptionId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter?.limit ?? 50;
    const offset = filter?.offset ?? 0;

    const query = `
      SELECT * FROM escalations
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset};
    `;

    const result = await this.pool.query<DbEscalationRow>(query, values);
    return result.rows.map((row) => this.mapRow(row));
  }

  /**
   * Retrieves a single escalation by ID.
   */
  async getEscalationById(escalationId: string): Promise<EscalationRecord | null> {
    const result = await this.pool.query<DbEscalationRow>(
      'SELECT * FROM escalations WHERE escalation_id = $1;',
      [escalationId],
    );

    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }

  /**
   * Resolves a pending escalation.
   */
  async resolveEscalation(
    escalationId: string,
    resolvedBy: string,
    resolutionNotes: string,
  ): Promise<EscalationRecord> {
    const query = `
      UPDATE escalations
      SET status = 'resolved',
          resolved_at = NOW(),
          resolved_by = $2,
          resolution_notes = $3
      WHERE escalation_id = $1
      RETURNING *;
    `;

    const result = await this.pool.query<DbEscalationRow>(query, [
      escalationId,
      resolvedBy,
      resolutionNotes,
    ]);

    if (result.rows.length === 0) {
      throw new Error(`Escalation with ID '${escalationId}' not found.`);
    }

    const record = this.mapRow(result.rows[0]);

    if (this.eventStore) {
      await this.eventStore.appendEvent({
        subscriptionId: record.subscriptionId,
        instrumentId: record.instrumentId,
        eventType: 'escalation_resolved',
        actor: 'human',
        payload: record,
        createdAt: record.resolvedAt || new Date().toISOString(),
      });
    }

    return record;
  }

  /**
   * Dismisses a pending escalation.
   */
  async dismissEscalation(
    escalationId: string,
    resolvedBy: string,
    resolutionNotes: string,
  ): Promise<EscalationRecord> {
    const query = `
      UPDATE escalations
      SET status = 'dismissed',
          resolved_at = NOW(),
          resolved_by = $2,
          resolution_notes = $3
      WHERE escalation_id = $1
      RETURNING *;
    `;

    const result = await this.pool.query<DbEscalationRow>(query, [
      escalationId,
      resolvedBy,
      resolutionNotes,
    ]);

    if (result.rows.length === 0) {
      throw new Error(`Escalation with ID '${escalationId}' not found.`);
    }

    return this.mapRow(result.rows[0]);
  }
}
