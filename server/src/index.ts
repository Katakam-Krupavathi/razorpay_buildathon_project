import Fastify, { FastifyServerOptions, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { ControlPlaneHealth } from '@recovery/shared';
import { webhookRoutes, WebhookRouteOptions } from './routes/webhook.js';

export * from './db/connection.js';
export * from './db/migrator.js';
export * from './event-store/hasher.js';
export * from './event-store/event-store.js';
export * from './razorpay/client.js';
export * from './razorpay/webhook-verifier.js';
export * from './razorpay/webhook-processor.js';
export * from './routes/webhook.js';
export * from './risk/scorer.js';
export * from './risk/erv-config.js';
export * from './risk/erv-engine.js';
export * from './risk/health-service.js';
export * from './risk/batch-runner.js';
export * from './planner/types.js';
export * from './planner/planner.js';
export * from './planner/planner-service.js';
export * from './policy/types.js';
export * from './policy/engine.js';
export * from './policy/policy-service.js';
export * from './circuit-breaker/types.js';
export * from './circuit-breaker/circuit-breaker.js';
export * from './circuit-breaker/circuit-breaker-guard.js';
export * from './routes/circuit-breaker.js';
export * from './verification/types.js';
export * from './verification/gateway.js';
export * from './verification/verification-service.js';
export * from './routes/dev-hooks.js';
export * from './notifications/types.js';
export * from './notifications/notification-service.js';
export * from './escalation/types.js';
export * from './escalation/escalation-service.js';
export * from './execution/types.js';
export * from './execution/execution-service.js';
export * from './pipeline/types.js';
export * from './pipeline/orchestrator.js';
export * from './attribution/types.js';
export * from './attribution/counterfactual-engine.js';
export * from './attribution/attribution-service.js';
export * from './routes/attribution.js';
export * from './audit/types.js';
export * from './audit/decision-trace-service.js';
export * from './audit/compliance-service.js';
export * from './routes/audit.js';
export * from './routes/dashboard.js';
export * from './redis/client.js';

import { circuitBreakerRoutes, CircuitBreakerRouteOptions } from './routes/circuit-breaker.js';
import { devHookRoutes } from './routes/dev-hooks.js';
import { escalationRoutes, EscalationRouteOptions } from './routes/escalations.js';
import { attributionRoutes, AttributionRouteOptions } from './routes/attribution.js';
import { auditRoutes, AuditRouteOptions } from './routes/audit.js';
import { dashboardRoutes, DashboardRouteOptions } from './routes/dashboard.js';
import { CohortCircuitBreaker } from './circuit-breaker/circuit-breaker.js';
import { EscalationService } from './escalation/escalation-service.js';
import { AttributionService } from './attribution/attribution-service.js';
import { DecisionTraceService } from './audit/decision-trace-service.js';
import { ComplianceService } from './audit/compliance-service.js';
import { getPool } from './db/connection.js';
import { checkRedisHealth, getRedisClient } from './redis/client.js';
import type { Redis } from 'ioredis';
import type pg from 'pg';

export interface AppOptions extends FastifyServerOptions {
  pool?: pg.Pool;
  redis?: Redis;
  webhookOptions?: WebhookRouteOptions;
  circuitBreakerOptions?: CircuitBreakerRouteOptions;
  escalationOptions?: EscalationRouteOptions;
  attributionOptions?: AttributionRouteOptions;
  auditOptions?: AuditRouteOptions;
  dashboardOptions?: DashboardRouteOptions;
}

export async function buildApp(opts?: AppOptions) {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
    },
    ...opts,
  });

  const pool = opts?.pool || getPool();
  const redis = opts?.redis || getRedisClient();

  // Helmet with sensible CSP
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'http://localhost:*', 'ws://localhost:*'],
      },
    },
  });

  // CORS configured with explicit allowed origins list (env var driven)
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4000', 'http://127.0.0.1:4000'];

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        cb(null, true);
        return;
      }
      cb(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
  });

  // Initialize shared Circuit Breaker, Escalation Service, and Attribution Service
  const circuitBreaker =
    opts?.circuitBreakerOptions?.circuitBreaker ||
    new CohortCircuitBreaker(undefined, undefined, redis);
  const escalationService =
    opts?.escalationOptions?.escalationService || new EscalationService(pool);
  const attributionService =
    opts?.attributionOptions?.attributionService || new AttributionService(pool);
  const decisionTraceService =
    opts?.auditOptions?.decisionTraceService || new DecisionTraceService(pool);
  const complianceService =
    opts?.auditOptions?.complianceService || new ComplianceService(pool);

  // Register Webhook Ingestion Routes
  await app.register(webhookRoutes, opts?.webhookOptions || {});

  // Register Circuit Breaker Routes
  await app.register(circuitBreakerRoutes, { circuitBreaker });

  // Register Dev Simulation Hooks Routes (only in non-production environments)
  if (process.env.NODE_ENV !== 'production') {
    await app.register(devHookRoutes);
  }

  // Register Escalation Workflow Routes
  await app.register(escalationRoutes, { escalationService });

  // Register Attribution & Scorecard Routes
  await app.register(attributionRoutes, { attributionService });

  // Register Decision Trace & Compliance Audit Routes
  await app.register(auditRoutes, { decisionTraceService, complianceService });

  // Register Dashboard & Opportunity Queue Routes
  await app.register(dashboardRoutes, opts?.dashboardOptions || {});

  // Root & Health Check Endpoints
  app.get('/', async () => {
    return {
      service: 'Autonomous Revenue Recovery Control Plane',
      version: '0.1.0',
      status: 'operational',
      docs: '/api/docs',
    };
  });

  const runHealthCheck = async (reply: FastifyReply) => {
    let dbStatus: 'connected' | 'disconnected' = 'disconnected';
    let redisStatus: 'connected' | 'disconnected' = 'disconnected';

    try {
      await pool.query('SELECT 1');
      dbStatus = 'connected';
    } catch {
      dbStatus = 'disconnected';
    }

    try {
      const isRedisHealthy = await checkRedisHealth(redis);
      redisStatus = isRedisHealthy ? 'connected' : 'disconnected';
    } catch {
      redisStatus = 'disconnected';
    }

    const isHealthy = dbStatus === 'connected' && redisStatus === 'connected';
    const isDegraded = dbStatus === 'connected' && redisStatus === 'disconnected';
    const status: 'healthy' | 'degraded' | 'unhealthy' = isHealthy
      ? 'healthy'
      : isDegraded
        ? 'degraded'
        : 'unhealthy';

    const statusCode = isHealthy ? 200 : 503;

    const healthData: ControlPlaneHealth = {
      status,
      uptimeSeconds: Math.floor(process.uptime()),
      database: dbStatus,
      redis: redisStatus,
      circuitBreaker: circuitBreaker.getStatus('rail:card')?.state || 'CLOSED',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    };

    return reply.status(statusCode).send(healthData);
  };

  app.get('/health', async (_req, reply) => {
    return runHealthCheck(reply);
  });

  app.get('/api/health', async (_req, reply) => {
    return runHealthCheck(reply);
  });

  return app;
}
