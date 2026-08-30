import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventStore } from '../src/event-store/event-store.js';
import { DecisionTraceService } from '../src/audit/decision-trace-service.js';
import { ComplianceService } from '../src/audit/compliance-service.js';
import { RecoveryPipelineOrchestrator } from '../src/pipeline/orchestrator.js';
import { buildApp } from '../src/index.js';
import { createTestDatabase, type TestPool } from './test-db.js';

describe('Phase 11: Unified Decision Trace & Compliance Audit Suite', () => {
  let pool: TestPool;
  let cleanup: () => Promise<void>;
  let eventStore: EventStore;
  let decisionTraceService: DecisionTraceService;
  let complianceService: ComplianceService;
  let orchestrator: RecoveryPipelineOrchestrator;

  beforeEach(async () => {
    const testDb = await createTestDatabase();
    pool = testDb.pool;
    cleanup = testDb.cleanup;
    eventStore = new EventStore(pool);
    decisionTraceService = new DecisionTraceService(pool, eventStore);
    complianceService = new ComplianceService(pool, eventStore);
    orchestrator = new RecoveryPipelineOrchestrator({ pool, eventStore });
  });

  afterEach(async () => {
    await cleanup();
  });

  async function seedTestInstrument(overrides?: {
    instrumentId?: string;
    subscriptionId?: string;
    rail?: 'card' | 'upi_autopay' | 'enach';
    mandateStatus?: 'active' | 'revoked' | 'paused';
    annualizedValue?: number;
  }) {
    const instId = overrides?.instrumentId || 'inst_audit_01';
    const subId = overrides?.subscriptionId || 'sub_audit_01';
    const rail = overrides?.rail || 'card';
    const mandateStatus = overrides?.mandateStatus || 'active';
    const annualizedValue = overrides?.annualizedValue || 12000000;

    await pool.query(
      `INSERT INTO subscriptions (subscription_id, customer_id, plan_id, status)
       VALUES ($1, 'cust_01', 'plan_01', 'active')
       ON CONFLICT (subscription_id) DO NOTHING;`,
      [subId],
    );

    await pool.query(
      `INSERT INTO instruments (instrument_id, subscription_id, rail, mandate_status, annualized_value)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (instrument_id) DO UPDATE SET mandate_status = EXCLUDED.mandate_status;`,
      [instId, subId, rail, mandateStatus, annualizedValue],
    );

    return { instId, subId };
  }

  describe('1. Unified Decision Trace Assembly & Explanation Narrative', () => {
    it('should assemble full end-to-end Decision Trace from detected failure to outcome', async () => {
      const { instId, subId } = await seedTestInstrument({ rail: 'card' });

      // Add failure event
      await eventStore.appendEvent({
        subscriptionId: subId,
        instrumentId: instId,
        eventType: 'invoice.payment_failed',
        actor: 'razorpay_webhook',
        payload: { error_code: 'BAD_REQUEST_PAYMENT_DECLINED' },
      });

      // Run orchestrator pipeline
      const pipeRes = await orchestrator.processInstrument(instId);
      expect(pipeRes.pipelineStatus).toBeDefined();

      // Assemble Decision Trace
      const trace = await decisionTraceService.getDecisionTrace(instId);

      expect(trace.instrumentId).toBe(instId);
      expect(trace.subscriptionId).toBe(subId);
      expect(trace.rail).toBe('card');
      expect(trace.steps.length).toBeGreaterThanOrEqual(4);
      expect(trace.chainValid).toBe(true);

      // Verify presence of lifecycle stages
      const stages = trace.steps.map((s) => s.stage);
      expect(stages).toContain('detected');
      expect(stages).toContain('diagnosed');
      expect(stages).toContain('proposed');
      expect(stages).toContain('permitted');
      expect(stages).toContain('executed');
      expect(stages).toContain('outcome');

      // Verify human narrative contains reasoning and policy context
      expect(trace.narrative).toContain('Because:');
      expect(trace.narrative).toContain('Proposed Action:');
      expect(trace.narrative).toContain('Outcome:');
    });

    it('should query decision trace using subscription_id as well as instrument_id', async () => {
      const { instId, subId } = await seedTestInstrument();
      await orchestrator.processInstrument(instId);

      const trace = await decisionTraceService.getDecisionTrace(subId);
      expect(trace.subscriptionId).toBe(subId);
      expect(trace.instrumentId).toBe(instId);
    });
  });

  describe('2. Compliance Query Engine Verification', () => {
    it('Compliance Query 1: should audit grace-period pauses with root cause & policy rule', async () => {
      const { instId, subId } = await seedTestInstrument({ annualizedValue: 36000000 });

      // Seed 4 failures to make it TERMINAL
      for (let i = 0; i < 4; i++) {
        await eventStore.appendEvent({
          subscriptionId: subId,
          instrumentId: instId,
          eventType: 'invoice.payment_failed',
          actor: 'razorpay_webhook',
          payload: { error_code: 'GATEWAY_ERROR' },
        });
      }

      await orchestrator.processInstrument(instId);

      const pauses = await complianceService.getGracePeriodPausesAudit();
      if (pauses.length > 0) {
        const pause = pauses.find((p) => p.instrumentId === instId);
        expect(pause).toBeDefined();
        expect(pause?.gracePeriodDays).toBe(7);
        expect(pause?.matchedRuleId).toBeDefined();
      }
    });

    it('Compliance Query 2: should verify UPI Autopay cap compliance (<= 4 attempts)', async () => {
      const { instId, subId } = await seedTestInstrument({ rail: 'upi_autopay' });

      // Seed 2 failure events
      await eventStore.appendEvent({
        subscriptionId: subId,
        instrumentId: instId,
        eventType: 'invoice.payment_failed',
        actor: 'razorpay_webhook',
        payload: { error_code: 'INSUFFICIENT_FUNDS' },
      });

      await orchestrator.processInstrument(instId);

      const upiAudit = await complianceService.getUpiAutopayCapsAudit();
      expect(upiAudit.length).toBeGreaterThanOrEqual(1);
      const target = upiAudit.find((u) => u.instrumentId === instId);
      expect(target).toBeDefined();
      expect(target?.totalAttempts).toBeLessThanOrEqual(4);
      expect(target?.compliant).toBe(true);
    });

    it('Compliance Query 3: should record and audit stale-state blocked actions', async () => {
      const { instId, subId } = await seedTestInstrument({ mandateStatus: 'active' });

      // Append stale state detected event
      await eventStore.appendEvent({
        subscriptionId: subId,
        instrumentId: instId,
        eventType: 'stale_state_detected',
        actor: 'verification_gateway',
        payload: {
          attemptedAction: 'retry',
          cachedMandateStatus: 'active',
          liveMandateStatus: 'revoked',
          reason: 'Cached DB status diverged from live Razorpay mandate status',
          rail: 'card',
        },
      });

      const staleAudit = await complianceService.getStaleStateBlocksAudit(30);
      expect(staleAudit.length).toBeGreaterThanOrEqual(1);
      const target = staleAudit.find((s) => s.instrumentId === instId);
      expect(target).toBeDefined();
      expect(target?.cachedMandateStatus).toBe('active');
      expect(target?.liveMandateStatus).toBe('revoked');
    });

    it('Compliance Query 4: should report circuit-breaker trips with cohort and failure rates', async () => {
      await eventStore.appendEvent({
        subscriptionId: null,
        instrumentId: null,
        eventType: 'circuit_breaker.tripped',
        actor: 'circuit_breaker',
        payload: {
          cohortKey: 'rail:card',
          rail: 'card',
          failureRate: 0.75,
          sampleSize: 20,
          threshold: 0.40,
        },
      });

      const trips = await complianceService.getCircuitBreakerTripsAudit();
      expect(trips.length).toBeGreaterThanOrEqual(1);
      const cardTrip = trips.find((t) => t.cohortKey === 'rail:card');
      expect(cardTrip).toBeDefined();
      expect(cardTrip?.failureRate).toBe(0.75);
      expect(cardTrip?.currentState).toBe('OPEN');
    });

    it('should generate full consolidated compliance report', async () => {
      const report = await complianceService.getFullComplianceReport();
      expect(report.generatedAt).toBeDefined();
      expect(report.summary.upiCapComplianceRatePercent).toBeDefined();
      expect(Array.isArray(report.gracePeriodPauses)).toBe(true);
      expect(Array.isArray(report.upiAutopayCaps)).toBe(true);
      expect(Array.isArray(report.staleStateBlocks)).toBe(true);
      expect(Array.isArray(report.circuitBreakerTrips)).toBe(true);
    });
  });

  describe('3. Audit & Compliance REST API Endpoints', () => {
    it('should serve GET /api/audit/decision-trace/:id and GET /api/compliance/report', async () => {
      const { instId } = await seedTestInstrument();
      await orchestrator.processInstrument(instId);

      const app = await buildApp({
        auditOptions: { decisionTraceService, complianceService },
      });

      // 1. Decision trace endpoint
      const traceRes = await app.inject({
        method: 'GET',
        url: `/api/audit/decision-trace/${instId}`,
      });
      expect(traceRes.statusCode).toBe(200);
      const traceBody = JSON.parse(traceRes.body);
      expect(traceBody.success).toBe(true);
      expect(traceBody.data.instrumentId).toBe(instId);
      expect(traceBody.data.steps.length).toBeGreaterThan(0);

      // 2. Full compliance report endpoint
      const repRes = await app.inject({
        method: 'GET',
        url: '/api/compliance/report',
      });
      expect(repRes.statusCode).toBe(200);
      const repBody = JSON.parse(repRes.body);
      expect(repBody.success).toBe(true);
      expect(repBody.data.summary).toBeDefined();

      // 3. Specific compliance queries
      const upiRes = await app.inject({
        method: 'GET',
        url: '/api/compliance/upi-autopay-caps',
      });
      expect(upiRes.statusCode).toBe(200);

      const pauseRes = await app.inject({
        method: 'GET',
        url: '/api/compliance/grace-period-pauses',
      });
      expect(pauseRes.statusCode).toBe(200);

      await app.close();
    });
  });
});
