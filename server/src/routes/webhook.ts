import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { RazorpayWebhookPayload } from '@recovery/shared';
import { WebhookProcessor } from '../razorpay/webhook-processor.js';
import { verifyWebhookSignature } from '../razorpay/webhook-verifier.js';
import { RazorpayClient } from '../razorpay/client.js';

export interface WebhookRouteOptions {
  processor?: WebhookProcessor;
  webhookSecret?: string;
}

export const webhookRoutes: FastifyPluginAsync<WebhookRouteOptions> = async (fastify, options) => {
  const razorpayClient = new RazorpayClient();
  const webhookSecret = options.webhookSecret || razorpayClient.getWebhookSecret();
  const processor = options.processor || new WebhookProcessor();

  // POST /api/webhooks/razorpay
  fastify.post(
    '/api/webhooks/razorpay',
    async (request: FastifyRequest<{ Body: RazorpayWebhookPayload }>, reply: FastifyReply) => {
      const signature = request.headers['x-razorpay-signature'] as string | undefined;

      // Extract raw body or serialize body to string if rawBody not attached
      const rawBody =
        (request as unknown as { rawBody?: string }).rawBody || JSON.stringify(request.body);

      // 1. Verify HMAC-SHA256 signature
      const isValid = verifyWebhookSignature(rawBody, signature, webhookSecret);

      if (!isValid) {
        request.log.warn(
          {
            signatureProvided: !!signature,
            header: signature,
          },
          'Razorpay webhook signature verification failed — request rejected',
        );
        return reply.status(400).send({
          error: 'Invalid webhook signature',
          message: 'HMAC signature verification failed against configured webhook secret',
        });
      }

      // 2. Ingest and project webhook
      try {
        const result = await processor.processWebhook(request.body);
        request.log.info(
          {
            event: request.body.event,
            subscriptionId: result.subscriptionId,
            status: result.status,
            sequenceNumber: result.event.sequenceNumber,
          },
          'Razorpay webhook successfully ingested and projected to event store',
        );

        return reply.status(200).send({
          success: true,
          eventId: result.event.eventId,
          sequenceNumber: result.event.sequenceNumber,
          subscriptionId: result.subscriptionId,
          status: result.status,
        });
      } catch (error) {
        request.log.error(error, 'Error processing Razorpay webhook payload');
        return reply.status(500).send({
          error: 'Internal server error',
          message: 'Failed to ingest webhook event',
        });
      }
    },
  );
};
