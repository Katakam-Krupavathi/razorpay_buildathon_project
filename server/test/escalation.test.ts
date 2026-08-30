import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EscalationService } from '../src/escalation/escalation-service.js';
import { EventStore } from '../src/event-store/event-store.js';
import { buildApp } from '../src/index.js';
import { createTestDatabase, type TestPool } from './test-db.js';

describe('Escalation Queue & Human Workflow Tests', () => {
  let pool: TestPool;
  let cleanup: () => Promise<void>;
  let eventStore: EventStore;
  let service: EscalationService;

  beforeEach(async () => {
    const testDb = await createTestDatabase();
    pool = testDb.pool;
    cleanup = testDb.cleanup;
    eventStore = new EventStore(pool);
    service = new EscalationService(pool, eventStore);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('1. should create and list pending escalations', async () => {
    const esc = await service.createEscalation({
      instrumentId: 'inst_esc_001',
      subscriptionId: 'sub_esc_001',
      reason: 'Mandate limit exceeded cap and requires manual customer outreach',
      blockedReason: 'MANDATE_LIMIT_REACHED',
      proposedAction: 'escalate',
    });

    expect(esc.escalation_id).toContain('esc_');
    expect(esc.status).toBe('pending');

    const pending = await service.listEscalations({ status: 'pending' });
    expect(pending).toHaveLength(1);
    expect(pending[0].instrument_id).toBe('inst_esc_001');

    // Verify EventStore event
    const events = await eventStore.getAllEvents();
    const createdEvent = events.find((e) => e.eventType === 'escalation_created');
    expect(createdEvent).toBeDefined();
    expect(createdEvent?.actor).toBe('execution_engine');
  });

  it('2. should resolve an escalation with reviewer identity and resolution notes', async () => {
    const esc = await service.createEscalation({
      instrumentId: 'inst_esc_002',
      reason: 'Card expiry risk escalation',
    });

    const resolved = await service.resolveEscalation({
      escalationId: esc.escalation_id,
      resolvedBy: 'ops_specialist_jane',
      resolutionNotes: 'Customer contacted via telephone; updated payment details provided',
      status: 'resolved',
    });

    expect(resolved.status).toBe('resolved');
    expect(resolved.resolved_by).toBe('ops_specialist_jane');
    expect(resolved.resolution_notes).toContain('Customer contacted');

    // Verify EventStore audit trail with actor = 'human'
    const events = await eventStore.getAllEvents();
    const resolveEvent = events.find((e) => e.eventType === 'escalation_resolved');
    expect(resolveEvent).toBeDefined();
    expect(resolveEvent?.actor).toBe('human');
  });

  it('3. should handle REST API endpoints GET /api/escalations and POST /api/escalations/:id/resolve', async () => {
    const esc = await service.createEscalation({
      instrumentId: 'inst_esc_api_003',
      reason: 'Circuit breaker outage blocked payment',
    });

    const app = await buildApp({
      escalationOptions: { escalationService: service },
    });

    // 1. List escalations via API
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/escalations',
    });
    expect(listRes.statusCode).toBe(200);
    const listBody = JSON.parse(listRes.body);
    expect(listBody.success).toBe(true);
    expect(listBody.count).toBe(1);

    // 2. Resolve escalation via API
    const resolveRes = await app.inject({
      method: 'POST',
      url: `/api/escalations/${esc.escalation_id}/resolve`,
      payload: {
        resolvedBy: 'lead_sre_operator',
        resolutionNotes: 'Bank network cleared; re-queued for execution',
        status: 'resolved',
      },
    });

    expect(resolveRes.statusCode).toBe(200);
    const resolveBody = JSON.parse(resolveRes.body);
    expect(resolveBody.success).toBe(true);
    expect(resolveBody.data.status).toBe('resolved');

    await app.close();
  });
});
