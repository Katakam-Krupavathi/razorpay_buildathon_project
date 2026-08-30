import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { DecisionTraceService } from '../audit/decision-trace-service.js';
import { ComplianceService } from '../audit/compliance-service.js';

export interface AuditRouteOptions {
  decisionTraceService?: DecisionTraceService;
  complianceService?: ComplianceService;
}

export const auditRoutes: FastifyPluginAsync<AuditRouteOptions> = async (
  fastify: FastifyInstance,
  options: AuditRouteOptions,
) => {
  const decisionTraceService = options.decisionTraceService || new DecisionTraceService();
  const complianceService = options.complianceService || new ComplianceService();

  // GET /api/audit/decision-trace/:id - Assemble full end-to-end Decision Trace
  fastify.get('/api/audit/decision-trace/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const trace = await decisionTraceService.getDecisionTrace(id);
      return reply.send({
        success: true,
        data: trace,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error assembling decision trace';
      return reply.status(404).send({
        success: false,
        error: msg,
      });
    }
  });

  // GET /api/compliance/grace-period-pauses - Compliance Query 1
  fastify.get('/api/compliance/grace-period-pauses', async (_request, reply) => {
    const results = await complianceService.getGracePeriodPausesAudit();
    return reply.send({
      success: true,
      count: results.length,
      data: results,
    });
  });

  // GET /api/compliance/upi-autopay-caps - Compliance Query 2
  fastify.get('/api/compliance/upi-autopay-caps', async (_request, reply) => {
    const results = await complianceService.getUpiAutopayCapsAudit();
    return reply.send({
      success: true,
      count: results.length,
      data: results,
    });
  });

  // GET /api/compliance/stale-state-blocks - Compliance Query 3
  fastify.get('/api/compliance/stale-state-blocks', async (request, reply) => {
    const query = request.query as { days?: string };
    const days = query.days ? parseInt(query.days, 10) : 30;
    const results = await complianceService.getStaleStateBlocksAudit(days);
    return reply.send({
      success: true,
      count: results.length,
      data: results,
    });
  });

  // GET /api/compliance/circuit-breaker-trips - Compliance Query 4
  fastify.get('/api/compliance/circuit-breaker-trips', async (_request, reply) => {
    const results = await complianceService.getCircuitBreakerTripsAudit();
    return reply.send({
      success: true,
      count: results.length,
      data: results,
    });
  });

  // GET /api/compliance/report - Full Consolidated Compliance Report
  fastify.get('/api/compliance/report', async (request, reply) => {
    const query = request.query as { days?: string };
    const days = query.days ? parseInt(query.days, 10) : 30;
    const report = await complianceService.getFullComplianceReport(days);
    return reply.send({
      success: true,
      data: report,
    });
  });
};
