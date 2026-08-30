import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { EscalationService } from '../escalation/escalation-service.js';
import type { EscalationStatus } from '@recovery/shared';

export interface EscalationRouteOptions {
  escalationService?: EscalationService;
}

export const escalationRoutes: FastifyPluginAsync<EscalationRouteOptions> = async (
  fastify: FastifyInstance,
  opts,
) => {
  const escalationService = opts.escalationService || new EscalationService();

  // GET /api/escalations - List escalations with filters
  fastify.get('/api/escalations', async (request, reply) => {
    const query = request.query as {
      status?: EscalationStatus;
      instrumentId?: string;
      subscriptionId?: string;
      limit?: string;
      offset?: string;
    };

    const escalations = await escalationService.listEscalations({
      status: query.status,
      instrumentId: query.instrumentId,
      subscriptionId: query.subscriptionId,
      limit: query.limit ? parseInt(query.limit, 10) : 50,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
    });

    return reply.send({
      success: true,
      count: escalations.length,
      escalations,
    });
  });

  // GET /api/escalations/:id - Get single escalation
  fastify.get('/api/escalations/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const escalation = await escalationService.getEscalationById(params.id);

    if (!escalation) {
      return reply.status(404).send({
        success: false,
        error: `Escalation with ID '${params.id}' not found.`,
      });
    }

    return reply.send({
      success: true,
      escalation,
    });
  });

  // POST /api/escalations/:id/resolve - Resolve escalation
  fastify.post('/api/escalations/:id/resolve', async (request, reply) => {
    const params = request.params as { id: string };
    const body = request.body as {
      resolvedBy?: string;
      resolutionNotes?: string;
    };

    if (!body || !body.resolvedBy || !body.resolutionNotes) {
      return reply.status(400).send({
        success: false,
        error: 'resolvedBy and resolutionNotes are required to resolve an escalation.',
      });
    }

    try {
      const resolved = await escalationService.resolveEscalation(
        params.id,
        body.resolvedBy,
        body.resolutionNotes,
      );

      return reply.send({
        success: true,
        message: 'Escalation resolved successfully.',
        escalation: resolved,
      });
    } catch (err) {
      return reply.status(404).send({
        success: false,
        error: (err as Error).message,
      });
    }
  });

  // POST /api/escalations/:id/dismiss - Dismiss escalation
  fastify.post('/api/escalations/:id/dismiss', async (request, reply) => {
    const params = request.params as { id: string };
    const body = request.body as {
      resolvedBy?: string;
      resolutionNotes?: string;
    };

    if (!body || !body.resolvedBy || !body.resolutionNotes) {
      return reply.status(400).send({
        success: false,
        error: 'resolvedBy and resolutionNotes are required to dismiss an escalation.',
      });
    }

    try {
      const dismissed = await escalationService.dismissEscalation(
        params.id,
        body.resolvedBy,
        body.resolutionNotes,
      );

      return reply.send({
        success: true,
        message: 'Escalation dismissed successfully.',
        escalation: dismissed,
      });
    } catch (err) {
      return reply.status(404).send({
        success: false,
        error: (err as Error).message,
      });
    }
  });
};
