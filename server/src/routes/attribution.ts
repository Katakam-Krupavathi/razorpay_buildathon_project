import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { AttributionService } from '../attribution/attribution-service.js';

export interface AttributionRouteOptions {
  attributionService?: AttributionService;
}

export const attributionRoutes: FastifyPluginAsync<AttributionRouteOptions> = async (
  fastify: FastifyInstance,
  options: AttributionRouteOptions,
) => {
  const attributionService = options.attributionService || new AttributionService();

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
      offset?: string;
    };

    const outcomes = await attributionService.listOutcomes({
      recoveryType: query.recoveryType,
      status: query.status,
      limit: query.limit ? parseInt(query.limit, 10) : 100,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
    });

    return reply.send({
      success: true,
      count: outcomes.length,
      data: outcomes,
    });
  });
};
