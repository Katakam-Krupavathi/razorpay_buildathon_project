import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { EscalationService } from '../escalation/escalation-service.js';
import type { EscalationStatus } from '@recovery/shared';

export interface EscalationRouteOptions {
  escalationService?: EscalationService;
}

export const escalationRoutes: FastifyPluginAsync<EscalationRouteOptions> = async (
  fastify: FastifyInstance,
  options: EscalationRouteOptions,
) => {
  const escalationService = options.escalationService || new EscalationService();

  // GET /api/escalations - List all escalations (filter by status)
  fastify.get('/api/escalations', async (request, reply) => {
    const query = request.query as {
      status?: EscalationStatus;
      instrumentId?: string;
      limit?: string;
      offset?: string;
    };

    const escalations = await escalationService.listEscalations({
      status: query.status,
      instrumentId: query.instrumentId,
      limit: query.limit ? parseInt(query.limit, 10) : 50,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
    });

    return reply.send({
      success: true,
      count: escalations.length,
      data: escalations,
    });
  });

  // GET /api/escalations/:id - Get escalation by ID
  fastify.get('/api/escalations/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const escalation = await escalationService.getEscalation(id);

    if (!escalation) {
      return reply.status(404).send({
        success: false,
        error: `Escalation '${id}' not found.`,
      });
    }

    return reply.send({
      success: true,
      data: escalation,
    });
  });

  // POST /api/escalations/:id/resolve - Mark escalation resolved
  fastify.post('/api/escalations/:id/resolve', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      resolvedBy: string;
      resolutionNotes: string;
      status?: 'resolved' | 'dismissed';
    };

    if (!body || !body.resolvedBy || !body.resolutionNotes) {
      return reply.status(400).send({
        success: false,
        error: 'Missing required parameters: resolvedBy and resolutionNotes are required.',
      });
    }

    try {
      const updated = await escalationService.resolveEscalation({
        escalationId: id,
        resolvedBy: body.resolvedBy,
        resolutionNotes: body.resolutionNotes,
        status: body.status || 'resolved',
      });

      return reply.send({
        success: true,
        message: `Escalation '${id}' marked as ${updated.status}.`,
        data: updated,
      });
    } catch (err) {
      return reply.status(404).send({
        success: false,
        error: (err as Error).message,
      });
    }
  });
};
