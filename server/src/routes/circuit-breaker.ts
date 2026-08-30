import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { CohortCircuitBreaker } from '../circuit-breaker/circuit-breaker.js';

export interface CircuitBreakerRouteOptions {
  circuitBreaker: CohortCircuitBreaker;
}

export const circuitBreakerRoutes: FastifyPluginAsync<CircuitBreakerRouteOptions> = async (
  fastify: FastifyInstance,
  options: CircuitBreakerRouteOptions,
) => {
  const { circuitBreaker } = options;

  // GET /api/circuit-breaker/status - List all cohort circuit breaker statuses
  fastify.get('/api/circuit-breaker/status', async (_request, reply) => {
    const statuses = circuitBreaker.getAllStatuses();
    return reply.send({
      success: true,
      cohorts: statuses,
    });
  });

  // POST /api/circuit-breaker/reset - Manually reset a tripped circuit breaker (human operator)
  fastify.post('/api/circuit-breaker/reset', async (request, reply) => {
    const body = request.body as {
      cohortKey: string;
      resetBy?: string;
      reason?: string;
    };

    if (!body || !body.cohortKey) {
      return reply.status(400).send({
        success: false,
        error: 'Missing required parameter: cohortKey',
      });
    }

    const resetBy = body.resetBy || 'human_operator';
    const reason = body.reason || 'Manual operator circuit breaker override';

    const updatedStatus = await circuitBreaker.manualReset(body.cohortKey, resetBy, reason);

    return reply.send({
      success: true,
      message: `Circuit breaker for cohort '${body.cohortKey}' reset successfully by ${resetBy}.`,
      status: updatedStatus,
    });
  });

  // POST /api/circuit-breaker/outcome - Record an action outcome (used in testing/simulation)
  fastify.post('/api/circuit-breaker/outcome', async (request, reply) => {
    const body = request.body as {
      cohortKey: string;
      success: boolean;
      timestamp?: string;
      metadata?: Record<string, unknown>;
    };

    if (!body || !body.cohortKey || typeof body.success !== 'boolean') {
      return reply.status(400).send({
        success: false,
        error: 'Missing required parameters: cohortKey, success (boolean)',
      });
    }

    const result = await circuitBreaker.recordOutcome(body.cohortKey, body.success, {
      timestamp: body.timestamp,
      metadata: body.metadata,
    });

    return reply.send({
      success: true,
      result,
    });
  });
};
