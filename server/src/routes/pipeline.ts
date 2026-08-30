import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { RecoveryPipelineOrchestrator } from '../orchestrator/pipeline-orchestrator.js';

export interface PipelineRouteOptions {
  orchestrator?: RecoveryPipelineOrchestrator;
}

export const pipelineRoutes: FastifyPluginAsync<PipelineRouteOptions> = async (
  fastify: FastifyInstance,
  opts,
) => {
  const orchestrator = opts.orchestrator || new RecoveryPipelineOrchestrator();

  // POST /api/pipeline/process/:instrumentId - Run pipeline on single instrument
  fastify.post('/api/pipeline/process/:instrumentId', async (request, reply) => {
    const params = request.params as { instrumentId: string };
    const body = request.body as { referenceTime?: string } | undefined;

    try {
      const result = await orchestrator.processInstrument(
        params.instrumentId,
        body?.referenceTime,
      );

      return reply.send({
        success: true,
        result,
      });
    } catch (err) {
      return reply.status(500).send({
        success: false,
        error: (err as Error).message,
      });
    }
  });

  // POST /api/pipeline/batch - Run pipeline across entire batch
  fastify.post('/api/pipeline/batch', async (request, reply) => {
    const body = request.body as { referenceTime?: string } | undefined;

    try {
      const summary = await orchestrator.processBatch(body?.referenceTime);

      return reply.send({
        success: true,
        summary,
      });
    } catch (err) {
      return reply.status(500).send({
        success: false,
        error: (err as Error).message,
      });
    }
  });
};
