import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GENESIS_PREV_HASH, type CreateEventInput } from '@recovery/shared';
import { EventStore } from '../src/event-store/event-store.js';
import { computeEventHash } from '../src/event-store/hasher.js';
import { createTestDatabase, type TestPool } from './test-db.js';

describe('Hash-Chained Append-Only EventStore', () => {
  let pool: TestPool;
  let cleanup: () => Promise<void>;
  let eventStore: EventStore;

  beforeEach(async () => {
    const testDb = await createTestDatabase();
    pool = testDb.pool;
    cleanup = testDb.cleanup;
    eventStore = new EventStore(pool);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('1. should start from GENESIS_PREV_HASH and calculate deterministic hashes', async () => {
    const input: CreateEventInput = {
      eventId: 'evt_001',
      subscriptionId: 'sub_alpha',
      instrumentId: 'inst_alpha',
      eventType: 'invoice.payment_failed',
      actor: 'razorpay_webhook',
      payload: { invoiceId: 'inv_100', amount: 150000, reason: 'insufficient_funds' },
      createdAt: '2026-08-30T10:00:00.000Z',
    };

    const event1 = await eventStore.appendEvent(input);

    expect(event1.sequenceNumber).toBe(1);
    expect(event1.prevHash).toBe(GENESIS_PREV_HASH);
    expect(event1.hash).toBe(
      computeEventHash({
        prevHash: GENESIS_PREV_HASH,
        payload: input.payload,
        eventType: input.eventType,
        createdAt: '2026-08-30T10:00:00.000Z',
      }),
    );
  });

  it('2. should chain multiple events sequentially with parent-child hash links', async () => {
    const evt1 = await eventStore.appendEvent({
      eventId: 'evt_001',
      subscriptionId: 'sub_1',
      eventType: 'invoice.payment_failed',
      actor: 'razorpay_webhook',
      payload: { amount: 50000 },
      createdAt: '2026-08-30T10:00:00.000Z',
    });

    const evt2 = await eventStore.appendEvent({
      eventId: 'evt_002',
      subscriptionId: 'sub_1',
      eventType: 'risk.evaluated',
      actor: 'health_scorer',
      payload: { score: 0.35 },
      createdAt: '2026-08-30T10:01:00.000Z',
    });

    const evt3 = await eventStore.appendEvent({
      eventId: 'evt_003',
      subscriptionId: 'sub_2',
      eventType: 'policy.permitted',
      actor: 'policy_engine',
      payload: { decision: 'PERMIT' },
      createdAt: '2026-08-30T10:02:00.000Z',
    });

    expect(evt1.prevHash).toBe(GENESIS_PREV_HASH);
    expect(evt2.prevHash).toBe(evt1.hash);
    expect(evt3.prevHash).toBe(evt2.hash);

    const integrity = await eventStore.verifyChainIntegrity();
    expect(integrity.valid).toBe(true);
    expect(integrity.verifiedCount).toBe(3);
    expect(integrity.errors).toHaveLength(0);
    expect(integrity.tipHash).toBe(evt3.hash);
  });

  it('3. should filter events by subscription and instrument', async () => {
    await eventStore.appendEvent({
      eventId: 'evt_s1_1',
      subscriptionId: 'sub_target',
      instrumentId: 'inst_A',
      eventType: 'invoice.payment_failed',
      actor: 'razorpay_webhook',
      payload: { attempt: 1 },
      createdAt: '2026-08-30T10:00:00.000Z',
    });

    await eventStore.appendEvent({
      eventId: 'evt_s2_1',
      subscriptionId: 'sub_other',
      instrumentId: 'inst_B',
      eventType: 'invoice.payment_failed',
      actor: 'razorpay_webhook',
      payload: { attempt: 1 },
      createdAt: '2026-08-30T10:01:00.000Z',
    });

    await eventStore.appendEvent({
      eventId: 'evt_s1_2',
      subscriptionId: 'sub_target',
      instrumentId: 'inst_A',
      eventType: 'recovery.succeeded',
      actor: 'execution_engine',
      payload: { recovered: true },
      createdAt: '2026-08-30T10:02:00.000Z',
    });

    const subEvents = await eventStore.getEventsForSubscription('sub_target');
    expect(subEvents).toHaveLength(2);
    expect(subEvents[0].eventId).toBe('evt_s1_1');
    expect(subEvents[1].eventId).toBe('evt_s1_2');

    const instEvents = await eventStore.getEventsForInstrument('inst_B');
    expect(instEvents).toHaveLength(1);
    expect(instEvents[0].eventId).toBe('evt_s2_1');
  });

  it('4. should enforce append-only immutability via DB trigger on UPDATE and DELETE', async () => {
    const evt = await eventStore.appendEvent({
      eventId: 'evt_locked',
      subscriptionId: 'sub_1',
      eventType: 'invoice.payment_failed',
      actor: 'razorpay_webhook',
      payload: { amount: 10000 },
      createdAt: '2026-08-30T10:00:00.000Z',
    });

    // Attempting UPDATE must be rejected by trigger
    await expect(
      pool.query(`UPDATE events SET payload = '{"tampered": true}' WHERE event_id = $1`, [
        evt.eventId,
      ]),
    ).rejects.toThrow(/append-only|forbidden/i);

    // Attempting DELETE must be rejected by trigger
    await expect(
      pool.query(`DELETE FROM events WHERE event_id = $1`, [evt.eventId]),
    ).rejects.toThrow(/append-only|forbidden/i);
  });

  it('5. should detect tampering and hash mismatch when row data is altered (Simulated Attack)', async () => {
    // Append 3 legitimate events
    await eventStore.appendEvent({
      eventId: 'evt_atk_1',
      eventType: 'invoice.payment_failed',
      actor: 'razorpay_webhook',
      payload: { amount: 50000 },
      createdAt: '2026-08-30T10:00:00.000Z',
    });

    await eventStore.appendEvent({
      eventId: 'evt_atk_2',
      eventType: 'risk.evaluated',
      actor: 'health_scorer',
      payload: { riskScore: 0.1 },
      createdAt: '2026-08-30T10:01:00.000Z',
    });

    await eventStore.appendEvent({
      eventId: 'evt_atk_3',
      eventType: 'recovery.succeeded',
      actor: 'execution_engine',
      payload: { recovered: true },
      createdAt: '2026-08-30T10:02:00.000Z',
    });

    // Verify initial chain is valid
    const cleanCheck = await eventStore.verifyChainIntegrity();
    expect(cleanCheck.valid).toBe(true);

    // Simulate an attack by bypassing the trigger temporarily and modifying payload of event 2
    pool.__disableImmutabilityTrigger?.();
    await pool.query(
      `UPDATE events SET payload = '{"riskScore": 0.99, "malicious_injection": true}' WHERE event_id = 'evt_atk_2'`,
    );

    // Re-run verifyChainIntegrity - it MUST catch the tampering
    const tamperedCheck = await eventStore.verifyChainIntegrity();
    expect(tamperedCheck.valid).toBe(false);
    expect(tamperedCheck.errors.length).toBeGreaterThan(0);
    expect(tamperedCheck.errors[0]).toContain('Hash mismatch');
    expect(tamperedCheck.errors[0]).toContain('evt_atk_2');
  });

  it('6. should successfully verify chain integrity on a batch of 25 synthetic events', async () => {
    for (let i = 1; i <= 25; i++) {
      await eventStore.appendEvent({
        eventId: `evt_batch_${i}`,
        subscriptionId: `sub_${i % 5}`,
        instrumentId: `inst_${i % 3}`,
        eventType: i % 2 === 0 ? 'invoice.payment_failed' : 'recovery.initiated',
        actor: i % 2 === 0 ? 'razorpay_webhook' : 'execution_engine',
        payload: { index: i, amount: i * 1000 },
        createdAt: new Date(1700000000000 + i * 60000).toISOString(),
      });
    }

    const integrity = await eventStore.verifyChainIntegrity();
    expect(integrity.valid).toBe(true);
    expect(integrity.verifiedCount).toBe(25);
    expect(integrity.errors).toEqual([]);
    expect(integrity.tipSequenceNumber).toBe(25);
  });
});
