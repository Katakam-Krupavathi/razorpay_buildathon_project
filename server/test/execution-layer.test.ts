import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DbInstrument, PolicyDecisionRecord, PreActionVerificationRecord } from '@recovery/shared';
import { ExecutionEngine } from '../src/execution/execution-engine.js';
import { MockNotificationProvider } from '../src/execution/notification-provider.js';
import { EscalationService } from '../src/escalation/escalation-service.js';
import { VerificationGateway } from '../src/verification/gateway.js';
import { RazorpayClient } from '../src/razorpay/client.js';
import { EventStore } from '../src/event-store/event-store.js';
import { createTestDatabase, type TestPool } from './test-db.js';

describe('Execution Layer & Escalation Workflow Tests', () => {
  let pool: TestPool;
  let cleanup: () => Promise<void>;
  let eventStore: EventStore;
  let razorpayClient: RazorpayClient;
  let mockNotifier: MockNotificationProvider;
  let verificationGateway: VerificationGateway;
  let escalationService: EscalationService;
  let executionEngine: ExecutionEngine;

  beforeEach(async () => {
    const testDb = await createTestDatabase();
    pool = testDb.pool;
    cleanup = testDb.cleanup;
    eventStore = new EventStore(pool);
    razorpayClient = new RazorpayClient();
    mockNotifier = new MockNotificationProvider();
    verificationGateway = new VerificationGateway(razorpayClient);
    escalationService = new EscalationService(pool, eventStore);
    executionEngine = new ExecutionEngine(
      razorpayClient,
      mockNotifier,
      eventStore,
      verificationGateway,
      escalationService,
    );
    RazorpayClient.clearSimulatedLiveOverrides();
  });

  afterEach(async () => {
    RazorpayClient.clearSimulatedLiveOverrides();
    await cleanup();
  });

  function createMockInstrument(overrides?: Partial<DbInstrument>): DbInstrument {
    return {
      instrument_id: 'inst_exec_001',
      subscription_id: 'sub_exec_001',
      rail: 'card',
      created_at: '2026-01-01T00:00:00.000Z',
      expiry_date: '2027-01-01T00:00:00.000Z',
      mandate_status: 'active',
      last_synced_at: '2026-08-30T00:00:00.000Z',
      ltv_tier: 'high',
      annualized_value: 12000000,
      ...overrides,
    };
  }

  function createMockDecision(overrides?: Partial<PolicyDecisionRecord>): PolicyDecisionRecord {
    return {
      decisionId: 'dec_exec_001',
      instrumentId: 'inst_exec_001',
      subscriptionId: 'sub_exec_001',
      result: 'ALLOW',
      proposedAction: 'schedule_retry',
      finalAction: 'schedule_retry',
      ruleIdMatched: 'PASS-THROUGH-PERMIT-001',
      reason: 'Policy allowed retry',
      evaluatedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  function createMockVerification(overrides?: Partial<PreActionVerificationRecord>): PreActionVerificationRecord {
    return {
      verificationId: 'ver_exec_001',
      decisionId: 'dec_exec_001',
      instrumentId: 'inst_exec_001',
      subscriptionId: 'sub_exec_001',
      status: 'VERIFIED_SAFE',
      checks: [
        { check: 'LIVE_STATE_CHECK', passed: true },
        { check: 'IDEMPOTENCY_CHECK', passed: true },
        { check: 'CIRCUIT_BREAKER_CHECK', passed: true },
        { check: 'POLICY_FRESHNESS_CHECK', passed: true },
      ],
      cachedMandateStatus: 'active',
      liveMandateStatus: 'active',
      verifiedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  describe('Action Handlers Execution', () => {
    it('1. retry_now handler: should trigger charge, register idempotency key, and log action_executed', async () => {
      const instrument = createMockInstrument();
      const decision = createMockDecision({ finalAction: 'retry_now' });
      const verification = createMockVerification();
      const idempotencyKey = 'idem_retry_now_001';

      const result = await executionEngine.execute({
        instrument,
        decision,
        verification,
        idempotencyKey,
      });

      expect(result.status).toBe('SUCCESS');
      expect(result.action).toBe('retry_now');
      expect(result.details.mode).toBe('immediate_charge');

      // Verify action_executed event in EventStore
      const events = await eventStore.getAllEvents();
      const execEvent = events.find((e) => e.eventType === 'action_executed');
      expect(execEvent).toBeDefined();
      expect(execEvent?.actor).toBe('execution_engine');
    });

    it('2. schedule_retry handler: should calculate offset and schedule retry', async () => {
      const instrument = createMockInstrument({ rail: 'upi_autopay' });
      const decision = createMockDecision({ finalAction: 'schedule_retry' });
      const verification = createMockVerification();
      const idempotencyKey = 'idem_sched_002';

      const result = await executionEngine.execute({
        instrument,
        decision,
        verification,
        idempotencyKey,
      });

      expect(result.status).toBe('SUCCESS');
      expect(result.action).toBe('schedule_retry');
      expect(result.details.scheduledAt).toBeDefined();
    });

    it('3. proactive_nudge handler: should dispatch customer communication via notification provider', async () => {
      const instrument = createMockInstrument({ rail: 'upi_autopay' });
      const decision = createMockDecision({ finalAction: 'proactive_nudge' });
      const verification = createMockVerification();
      const idempotencyKey = 'idem_nudge_003';

      const result = await executionEngine.execute({
        instrument,
        decision,
        verification,
        idempotencyKey,
      });

      expect(result.status).toBe('SUCCESS');
      expect(result.action).toBe('proactive_nudge');

      // Verify mock notification provider received communication
      const sent = mockNotifier.getSentNotifications();
      expect(sent).toHaveLength(1);
      expect(sent[0].payload.channel).toBe('whatsapp');
    });

    it('4. pause / grace_period handler: should pause subscription with grace period', async () => {
      const instrument = createMockInstrument();
      const decision = createMockDecision({ finalAction: 'pause' });
      const verification = createMockVerification();
      const idempotencyKey = 'idem_pause_004';

      const result = await executionEngine.execute({
        instrument,
        decision,
        verification,
        idempotencyKey,
      });

      expect(result.status).toBe('SUCCESS');
      expect(result.action).toBe('pause');
      expect(result.details.gracePeriodDays).toBe(7);
    });

    it('5. NO_ACTION handler: should perform legitimate no-op and log NO_OP execution', async () => {
      const instrument = createMockInstrument();
      const decision = createMockDecision({ finalAction: 'NO_ACTION' });
      const verification = createMockVerification();
      const idempotencyKey = 'idem_no_action_005';

      const result = await executionEngine.execute({
        instrument,
        decision,
        verification,
        idempotencyKey,
      });

      expect(result.status).toBe('NO_OP');
      expect(result.action).toBe('NO_ACTION');
    });

    it('6. escalate handler: should write to escalations queue table and log ESCALATED status', async () => {
      const instrument = createMockInstrument();
      const decision = createMockDecision({ finalAction: 'escalate' });
      const verification = createMockVerification();
      const idempotencyKey = 'idem_escalate_006';

      const result = await executionEngine.execute({
        instrument,
        decision,
        verification,
        idempotencyKey,
      });

      expect(result.status).toBe('ESCALATED');
      expect(result.action).toBe('escalate');
      expect(result.details.escalationId).toBeDefined();

      // Verify escalation in DB
      const escalations = await escalationService.listEscalations({
        instrumentId: instrument.instrument_id,
      });
      expect(escalations).toHaveLength(1);
      expect(escalations[0].status).toBe('pending');
    });

    it('7. Force escalate on BLOCKED verification: should automatically route blocked actions to escalation queue', async () => {
      const instrument = createMockInstrument();
      const decision = createMockDecision({ finalAction: 'schedule_retry' }); // Policy said retry
      const verification = createMockVerification({
        status: 'BLOCKED',
        blockedReason: 'STALE_STATE_DISAGREEMENT',
      });
      const idempotencyKey = 'idem_stale_blocked_007';

      const result = await executionEngine.execute({
        instrument,
        decision,
        verification,
        idempotencyKey,
      });

      expect(result.status).toBe('ESCALATED');
      expect(result.action).toBe('escalate');
      expect(result.details.triggerReason).toBe('STALE_STATE_DISAGREEMENT');
    });
  });

  describe('Escalation Queue Workflow (Create, List, Resolve, Dismiss)', () => {
    it('8. should create escalation, list pending escalations, and resolve with notes', async () => {
      // 1. Create escalation
      const created = await escalationService.createEscalation({
        instrumentId: 'inst_esc_test_1',
        subscriptionId: 'sub_esc_test_1',
        triggerReason: 'CIRCUIT_BREAKER_OPEN',
        metadata: { cohort: 'rail:upi_autopay' },
      });

      expect(created.escalationId).toBeDefined();
      expect(created.status).toBe('pending');

      // 2. List pending
      const pendingList = await escalationService.listEscalations({ status: 'pending' });
      expect(pendingList.some((e) => e.escalationId === created.escalationId)).toBe(true);

      // 3. Resolve escalation
      const resolved = await escalationService.resolveEscalation(
        created.escalationId,
        'ops_reviewer_42',
        'Customer contacted via phone and updated debit card',
      );

      expect(resolved.status).toBe('resolved');
      expect(resolved.resolvedBy).toBe('ops_reviewer_42');
      expect(resolved.resolutionNotes).toContain('updated debit card');

      // Verify escalation_resolved event logged to EventStore
      const events = await eventStore.getAllEvents();
      const resolveEvent = events.find((e) => e.eventType === 'escalation_resolved');
      expect(resolveEvent).toBeDefined();
      expect(resolveEvent?.actor).toBe('human');
    });
  });
});
