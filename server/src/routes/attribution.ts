import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { AttributionService } from '../attribution/attribution-service.js';
import type { DbRecoveryOutcome } from '@recovery/shared';
import { getPool } from '../db/connection.js';

export interface AttributionRouteOptions {
  attributionService?: AttributionService;
}

export const attributionRoutes: FastifyPluginAsync<AttributionRouteOptions> = async (
  fastify: FastifyInstance,
  options: AttributionRouteOptions,
) => {
  const attributionService = options.attributionService || new AttributionService();
  const pool = getPool();

  // GET /api/attribution/scorecard - Financial Impact Scorecard
  fastify.get('/api/attribution/scorecard', async (_request, reply) => {
    const scorecard = await attributionService.getScorecard();
    return reply.send({
      success: true,
      data: scorecard,
    });
  });

  // GET /api/attribution/outcomes - List recorded recovery outcomes
  fastify.get('/api/attribution/outcomes', async (request, reply) => {
    const query = request.query as {
      recoveryType?: string;
      status?: string;
      limit?: string;
    };

    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (query.recoveryType) {
      conditions.push(`recovery_type = $${paramIndex++}`);
      values.push(query.recoveryType);
    }

    if (query.status) {
      conditions.push(`status = $${paramIndex++}`);
      values.push(query.status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = query.limit ? parseInt(query.limit, 10) : 100;
    values.push(limit);

    const sql = `
      SELECT * FROM recovery_outcomes
      ${whereClause}
      ORDER BY closed_at DESC
      LIMIT $${paramIndex++};
    `;

    const res = await pool.query<DbRecoveryOutcome>(sql, values);

    return reply.send({
      success: true,
      count: res.rows.length,
      data: res.rows,
    });
  });
};
