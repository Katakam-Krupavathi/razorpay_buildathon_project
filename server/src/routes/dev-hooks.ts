import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { RazorpayClient } from '../razorpay/client.js';

export const devHookRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // POST /api/dev/simulate-mandate-revocation - Dev hook for signature 2 AM stale-state demo
  fastify.post('/api/dev/simulate-mandate-revocation', async (request, reply) => {
    const body = request.body as {
      instrumentId: string;
      mandateStatus?: string;
      subscriptionStatus?: string;
    };

    if (!body || !body.instrumentId) {
      return reply.status(400).send({
        success: false,
        error: 'Missing required parameter: instrumentId',
      });
    }

    const mandateStatus = body.mandateStatus || 'revoked';
    RazorpayClient.setSimulatedLiveOverride(body.instrumentId, {
      mandateStatus,
      subscriptionStatus: body.subscriptionStatus,
    });

    return reply.send({
      success: true,
      message: `Live simulated override set for instrument '${body.instrumentId}': mandateStatus = '${mandateStatus}'.`,
      instrumentId: body.instrumentId,
      simulatedState: {
        mandateStatus,
        subscriptionStatus: body.subscriptionStatus,
      },
    });
  });

  // POST /api/dev/clear-overrides - Clear all simulated live overrides
  fastify.post('/api/dev/clear-overrides', async (_request, reply) => {
    RazorpayClient.clearSimulatedLiveOverrides();
    return reply.send({
      success: true,
      message: 'All simulated live overrides cleared.',
    });
  });
};
