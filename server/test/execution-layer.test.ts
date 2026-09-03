import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DbInstrument, PolicyDecisionRecord } from '@recovery/shared';
import { ExecutionService } from '../src/execution/execution-service.js';
import { EscalationService } from '../src/escalation/escalation-service.js';
import { NotificationService } from '../src/notifications/notification-service.js';
import { VerificationGateway } from '../src/verification/gateway.js';
import { RazorpayClient } from '../src/razorpay/client.js';
import { EventStore } from '../src/event-store/event-store.js';
import { createTestDatabase, type TestPool } from './test-db.js';

describe('Execution Layer & Action Handlers Tests', () => {
  let pool: TestPool;
  let cleanup: () => Promise<void>;
  let eventStore: EventStore;
  let razorpayClient: RazorpayClient;
  let notificationService: NotificationService;
  let escalationService: EscalationService;
  let verificationGateway: VerificationGateway;
  let executionService: ExecutionService;

  beforeEach(async () => {
    const testDb = await createTestDatabase();
    pool = testDb.pool;
    cleanup = testDb.cleanup;
    eventStore = new EventStore(pool);
    razorpayClient = new RazorpayClient();
    notificationService = new NotificationService();
    escalationService = new EscalationService(pool, eventStore);
    verificationGateway = new VerificationGateway(razorpayClient);
    executionService = new ExecutionService(
      razorpayClient,
      notificationService,
      escalationService,
      verificationGateway,
      eventStore,
    );
    RazorpayClient.clearSimulatedLiveOverrides();
    RazorpayClient.setSimulatedLiveOverride('inst_exec_001', { mandateStatus: 'active' });
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
      annualized_value: 12000000, // Rs 1,20,000
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
      reason: 'Policy allows retry',
      evaluatedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it('1. should execute schedule_retry action and log action_executed event to EventStore', async () => {
    const instrument = createMockInstrument();
    const decision = createMockDecision({ finalAction: 'schedule_retry' });

    const result = await executionService.execute({
      instrument,
      decision,
      action: 'schedule_retry',
      idempotencyKey: 'idem_exec_retry_001',
    });

    expect(result.status).toBe('scheduled');
    expect(result.action).toBe('schedule_retry');
    expect(result.externalReferenceId).toBeDefined();

    // Verify EventStore audit trail
    const events = await eventStore.getAllEvents();
    const execEvent = events.find((e) => e.eventType === 'action_executed');
    expect(execEvent).toBeDefined();
    expect(execEvent?.actor).toBe('execution_engine');
  });

  it('2. should execute proactive_nudge action and deliver notification message', async () => {
    const instrument = createMockInstrument({ rail: 'card' });
    const decision = createMockDecision({ finalAction: 'proactive_nudge' });

    const result = await executionService.execute({
      instrument,
      decision,
      action: 'proactive_nudge',
      idempotencyKey: 'idem_exec_nudge_001',
    });

    expect(result.status).toBe('nudged');
    expect(result.action).toBe('proactive_nudge');
    expect(result.externalReferenceId).toContain('msg_');

    // Verify EventStore audit trail
    const events = await eventStore.getAllEvents();
    const execEvent = events.find((e) => e.eventType === 'action_executed');
    expect(execEvent).toBeDefined();
  });

  it('3. should execute pause subscription action with grace period', async () => {
    const instrument = createMockInstrument();
    const decision = createMockDecision({ finalAction: 'pause' });

    const result = await executionService.execute({
      instrument,
      decision,
      action: 'pause',
      idempotencyKey: 'idem_exec_pause_001',
    });

    expect(result.status).toBe('paused');
    expect(result.action).toBe('pause');

    const events = await eventStore.getAllEvents();
    const execEvent = events.find((e) => e.eventType === 'action_executed');
    expect(execEvent).toBeDefined();
  });

  it('4. should handle NO_ACTION as a legitimate no-op and log action_noop event', async () => {
    const instrument = createMockInstrument();
    const decision = createMockDecision({ finalAction: 'NO_ACTION', result: 'NO_ACTION' });

    const result = await executionService.execute({
      instrument,
      decision,
      action: 'NO_ACTION',
      idempotencyKey: 'idem_exec_noop_001',
    });

    expect(result.status).toBe('no_op');
    expect(result.action).toBe('NO_ACTION');

    const events = await eventStore.getAllEvents();
    const noopEvent = events.find((e) => e.eventType === 'action_noop');
    expect(noopEvent).toBeDefined();
    expect(noopEvent?.actor).toBe('execution_engine');
  });

  it('5. should route escalate action to escalation queue and log action_escalated event', async () => {
    const instrument = createMockInstrument();
    const decision = createMockDecision({ finalAction: 'escalate', result: 'BLOCK' });

    const result = await executionService.execute({
      instrument,
      decision,
      action: 'escalate',
      idempotencyKey: 'idem_exec_esc_001',
    });

    expect(result.status).toBe('escalated');
    expect(result.action).toBe('escalate');
    expect(result.externalReferenceId).toContain('esc_');

    // Verify escalation in DB queue
    const escalations = await escalationService.listEscalations();
    expect(escalations).toHaveLength(1);
    expect(escalations[0].instrument_id).toBe(instrument.instrument_id);
    expect(escalations[0].status).toBe('pending');

    // Verify EventStore audit trail
    const events = await eventStore.getAllEvents();
    const escEvent = events.find((e) => e.eventType === 'action_escalated');
    expect(escEvent).toBeDefined();
  });

  it('6. should register idempotency keys in verification gateway to prevent double actions', async () => {
    const instrument = createMockInstrument();
    const decision = createMockDecision();
    const idempotencyKey = 'idem_double_guard_001';

    // Execute first time
    await executionService.execute({
      instrument,
      decision,
      action: 'schedule_retry',
      idempotencyKey,
    });

    // Verification check for same key must now fail with IDEMPOTENCY_CONFLICT
    const verifyResult = await verificationGateway.verify({
      instrument,
      decision,
      idempotencyKey,
    });

    expect(verifyResult.status).toBe('BLOCKED');
    expect(verifyResult.blockedReason).toBe('IDEMPOTENCY_CONFLICT');
  });
});
