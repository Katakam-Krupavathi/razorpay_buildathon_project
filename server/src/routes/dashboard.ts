import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import pg from 'pg';
import type {
  OpportunityQueueItem,
  InstrumentListItem,
  PipelineRunResponse,
  DbInstrument,
  TrajectoryType,
  RootCauseType,
  InstrumentRail,
  MandateStatusEnum,
  SubscriptionStatusEnum,
  SparklineDataPoint,
} from '@recovery/shared';
import { getPool } from '../db/connection.js';
import { EventStore } from '../event-store/event-store.js';
import { RecoveryPipelineOrchestrator } from '../pipeline/orchestrator.js';
import { HealthService } from '../risk/health-service.js';

export interface DashboardRouteOptions {
  pool?: pg.Pool;
  eventStore?: EventStore;
  orchestrator?: RecoveryPipelineOrchestrator;
  healthService?: HealthService;
}

export const dashboardRoutes: FastifyPluginAsync<DashboardRouteOptions> = async (
  fastify: FastifyInstance,
  options: DashboardRouteOptions,
) => {
  const pool = options.pool || getPool();
  const eventStore = options.eventStore || new EventStore(pool);
  const orchestrator = options.orchestrator || new RecoveryPipelineOrchestrator({ pool, eventStore });
  const healthService = options.healthService || new HealthService(eventStore, pool);

  // 1. GET /api/opportunities - Ranked Opportunity Queue (Phase 4 ERV Engine)
  fastify.get('/api/opportunities', async (request, reply) => {
    try {
      const query = request.query as { limit?: string; rail?: string; trajectory?: string };
      const limit = query.limit ? parseInt(query.limit, 10) : 50;

      const instRes = await pool.query<DbInstrument>(
        'SELECT * FROM instruments ORDER BY annualized_value DESC;',
      );
      const instruments = instRes.rows;

      const items: OpportunityQueueItem[] = [];

      for (const inst of instruments) {
        if (query.rail && inst.rail !== query.rail) continue;

        const healthRes = await healthService.evaluateAndPersist(inst.instrument_id);
        const health = healthRes.health;
        const erv = healthRes.erv;

        if (query.trajectory && health.trajectory !== query.trajectory) continue;

        items.push({
          instrumentId: inst.instrument_id,
          subscriptionId: inst.subscription_id,
          rail: inst.rail,
          monthlyAmountPaise: Math.round(Number(inst.annualized_value) / 12),
          annualizedValuePaise: Number(inst.annualized_value),
          healthScore: health.healthScore,
          trajectory: health.trajectory,
          rootCause: health.rootCause,
          amountAtRiskPaise: erv.amountAtRisk,
          expectedRecoveryValuePaise: erv.expectedRecoveryValue,
          recoveryProbability: health.recoveryProbability,
          recommendedAction: erv.recommendedAction,
          ltvTier: inst.ltv_tier,
          mandateStatus: inst.mandate_status,
          evaluatedAt: health.computedAt,
        });
      }

      // Sort primarily by Expected Recovery Value descending
      items.sort((a, b) => b.expectedRecoveryValuePaise - a.expectedRecoveryValuePaise);

      return reply.send({
        success: true,
        count: items.slice(0, limit).length,
        totalOpportunities: items.length,
        data: items.slice(0, limit),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error fetching opportunity queue';
      return reply.status(500).send({ success: false, error: msg });
    }
  });

  // 2. GET /api/instruments - Instrument Directory with Health Sparklines
  fastify.get('/api/instruments', async (request, reply) => {
    try {
      const query = request.query as { rail?: string; status?: string; limit?: string };
      const limit = query.limit ? parseInt(query.limit, 10) : 100;

      const instSql = `
        SELECT 
          i.instrument_id,
          i.subscription_id,
          s.customer_id,
          i.rail,
          i.mandate_status,
          s.status as subscription_status,
          i.annualized_value,
          i.ltv_tier,
          i.last_synced_at,
          i.expiry_date
        FROM instruments i
        LEFT JOIN subscriptions s ON i.subscription_id = s.subscription_id
        ORDER BY i.annualized_value DESC
        LIMIT $1;
      `;
      const instRes = await pool.query<{
        instrument_id: string;
        subscription_id: string;
        customer_id: string | null;
        rail: string;
        mandate_status: string;
        subscription_status: string | null;
        annualized_value: string | number;
        ltv_tier: string;
        last_synced_at: string;
        expiry_date: string | null;
      }>(instSql, [limit]);

      const instruments = instRes.rows;
      const results: InstrumentListItem[] = [];

      for (const inst of instruments) {
        if (query.rail && inst.rail !== query.rail) continue;
        if (query.status && inst.mandate_status !== query.status) continue;

        // Fetch latest snapshot & historical score points for sparkline
        let healthScore = 0.85;
        let trajectory: TrajectoryType = 'HEALTHY';
        let rootCause: RootCauseType = 'NONE';
        const sparkline: SparklineDataPoint[] = [];

        try {
          const snapRes = await pool.query<{
            health_score: string | number;
            risk_score: string | number;
            trajectory: string;
            root_cause: string;
            failure_category: string;
            computed_at: string;
          }>(
            `SELECT * FROM health_snapshots 
             WHERE instrument_id = $1 
             ORDER BY computed_at ASC 
             LIMIT 10;`,
            [inst.instrument_id],
          );

          if (snapRes.rows.length > 0) {
            const latest = snapRes.rows[snapRes.rows.length - 1];
            healthScore = Number(latest.health_score ?? latest.risk_score ?? 0.85);
            trajectory = (latest.trajectory as TrajectoryType) || 'HEALTHY';
            rootCause = (latest.root_cause as RootCauseType) || (latest.failure_category as RootCauseType) || 'NONE';

            for (const r of snapRes.rows) {
              sparkline.push({
                timestamp: r.computed_at,
                score: Number(r.health_score ?? r.risk_score ?? 0.85),
              });
            }
          } else {
            // Default 3-point synthetic baseline sparkline if no snapshots yet
            sparkline.push({ timestamp: new Date(Date.now() - 86400000 * 2).toISOString(), score: 0.9 });
            sparkline.push({ timestamp: new Date(Date.now() - 86400000).toISOString(), score: 0.85 });
            sparkline.push({ timestamp: new Date().toISOString(), score: healthScore });
          }
        } catch {
          // fallback
        }

        // Calculate days to expiry
        let daysToExpiry: number | null = null;
        if (inst.expiry_date) {
          const diffMs = new Date(inst.expiry_date).getTime() - Date.now();
          daysToExpiry = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
        }

        // Count payment failures
        let failureCount = 0;
        try {
          const failRes = await pool.query(
            "SELECT COUNT(*) as count FROM events WHERE (instrument_id = $1 OR subscription_id = $2) AND event_type = 'invoice.payment_failed';",
            [inst.instrument_id, inst.subscription_id],
          );
          if (failRes.rows.length > 0) {
            failureCount = parseInt(failRes.rows[0].count, 10);
          }
        } catch {
          // ignore
        }

        results.push({
          instrumentId: inst.instrument_id,
          subscriptionId: inst.subscription_id,
          customerId: inst.customer_id || `cust_${inst.instrument_id.slice(-6)}`,
          rail: inst.rail as InstrumentRail,
          mandateStatus: inst.mandate_status as MandateStatusEnum,
          subscriptionStatus: (inst.subscription_status as SubscriptionStatusEnum) || 'active',
          monthlyAmountPaise: Math.round(Number(inst.annualized_value) / 12),
          annualizedValuePaise: Number(inst.annualized_value),
          ltvTier: inst.ltv_tier,
          healthScore,
          trajectory,
          rootCause,
          failureCount,
          daysToExpiry,
          lastSyncedAt: inst.last_synced_at,
          sparkline,
        });
      }

      return reply.send({
        success: true,
        count: results.length,
        data: results,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error fetching instruments';
      return reply.status(500).send({ success: false, error: msg });
    }
  });

  // 3. POST /api/pipeline/run - Trigger Autonomous Recovery Agent Full Batch
  fastify.post('/api/pipeline/run', async (_request, reply) => {
    try {
      const startTime = Date.now();
      const batchResult = await orchestrator.processBatch();
      const duration = Date.now() - startTime;

      const actions = {
        retried: batchResult.byActionType['retry'] || 0,
        scheduledRetry: batchResult.byActionType['schedule_retry'] || 0,
        proactiveNudge: batchResult.byActionType['proactive_nudge'] || 0,
        paused: batchResult.byActionType['pause'] || 0,
        escalated: batchResult.escalatedCount || 0,
        noAction: batchResult.noOpCount || batchResult.byActionType['NO_ACTION'] || 0,
      };

      const responsePayload: PipelineRunResponse = {
        success: true,
        message: `Successfully executed autonomous recovery pipeline across ${batchResult.totalProcessed} instruments.`,
        summary: {
          totalInstruments: batchResult.totalProcessed,
          processedCount: batchResult.totalProcessed,
          actionsTaken: actions,
          blockedByPolicy: batchResult.blockedByPolicyCount,
          blockedByCircuitBreaker: batchResult.blockedByCircuitBreakerCount,
          blockedByStaleState: batchResult.blockedByVerificationCount,
          totalAmountAtRiskPaise: Number(batchResult.scorecard?.totalAtRiskMRRPaise || 0),
          totalExpectedRecoveryValuePaise: Number(batchResult.scorecard?.totalRecoveredMRRPaise || 0),
          executionDurationMs: duration,
        },
      };

      return reply.send(responsePayload);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error running batch pipeline';
      return reply.status(500).send({ success: false, error: msg });
    }
  });
};
