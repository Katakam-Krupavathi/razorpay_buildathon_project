import { describe, it, expect } from 'vitest';
import { newDb, DataType } from 'pg-mem';
import pg from 'pg';
import { EventStore } from '@recovery/server';
import { PRNG } from '../src/synthetic/prng.js';
import { SyntheticDataGenerator } from '../src/synthetic/generator.js';
import { SyntheticDataSeeder } from '../src/synthetic/seeder.js';
import { computeSummaryReport } from '../src/synthetic/index.js';

describe('Synthetic Instrument & Subscription Data Generator', () => {
  describe('PRNG Engine Determinism', () => {
    it('1. should produce identical sequence with identical seed', () => {
      const prng1 = new PRNG(1337);
      const prng2 = new PRNG(1337);

      const seq1 = Array.from({ length: 10 }, () => prng1.next());
      const seq2 = Array.from({ length: 10 }, () => prng2.next());

      expect(seq1).toEqual(seq2);
    });

    it('2. should produce distinct sequence with different seeds', () => {
      const prng1 = new PRNG(100);
      const prng2 = new PRNG(200);

      const val1 = prng1.next();
      const val2 = prng2.next();

      expect(val1).not.toEqual(val2);
    });
  });

  describe('Generator Distribution Rules & Metadata', () => {
    it('3. should generate exact requested count with deterministic reproducibility', () => {
      const gen1 = new SyntheticDataGenerator({ seed: 42 });
      const gen2 = new SyntheticDataGenerator({ seed: 42 });

      const specs1 = gen1.generate(50);
      const specs2 = gen2.generate(50);

      expect(specs1).toHaveLength(50);
      expect(specs1).toEqual(specs2);
    });

    it('4. should cover all payment rails (card, upi_autopay, enach)', () => {
      const generator = new SyntheticDataGenerator({ seed: 42 });
      const specs = generator.generate(100);

      const rails = new Set(specs.map((s) => s.rail));
      expect(rails.has('card')).toBe(true);
      expect(rails.has('upi_autopay')).toBe(true);
      expect(rails.has('enach')).toBe(true);
    });

    it('5. should generate cards near expiry (0-20 days)', () => {
      const generator = new SyntheticDataGenerator({ seed: 42 });
      const specs = generator.generate(100);

      const cards = specs.filter((s) => s.rail === 'card');
      expect(cards.length).toBeGreaterThan(20);

      const nearExpiryCards = cards.filter((c) => c.isNearCardExpiry);
      expect(nearExpiryCards.length).toBeGreaterThan(0);

      for (const card of nearExpiryCards) {
        expect(card.cardDaysToExpiry).toBeDefined();
        expect(card.cardDaysToExpiry).toBeGreaterThanOrEqual(0);
        expect(card.cardDaysToExpiry).toBeLessThanOrEqual(20);
      }
    });

    it('6. should identify UPI Autopay amounts near/at/over AFA thresholds', () => {
      const generator = new SyntheticDataGenerator({ seed: 42 });
      const specs = generator.generate(100);

      const upiSubs = specs.filter((s) => s.rail === 'upi_autopay');
      expect(upiSubs.length).toBeGreaterThan(30);

      const overAfaSubs = upiSubs.filter((s) => s.isOverAfaThreshold);
      expect(overAfaSubs.length).toBeGreaterThan(0);

      for (const sub of overAfaSubs) {
        expect(sub.monthlyAmount).toBeGreaterThan(sub.upiAfaThreshold);
      }
    });

    it('7. should spread across HEALTHY, DEGRADING, and TERMINAL profiles', () => {
      const generator = new SyntheticDataGenerator({ seed: 42 });
      const specs = generator.generate(100);

      const healthy = specs.filter((s) => s.healthProfile === 'HEALTHY');
      const degrading = specs.filter((s) => s.healthProfile === 'DEGRADING');
      const terminal = specs.filter((s) => s.healthProfile === 'TERMINAL');

      expect(healthy.length).toBeGreaterThan(40);
      expect(degrading.length).toBeGreaterThan(15);
      expect(terminal.length).toBeGreaterThan(5);

      // Verify status mapping
      for (const h of healthy) expect(h.finalStatus).toBe('active');
      for (const d of degrading) expect(d.finalStatus).toBe('pending');
      for (const t of terminal) expect(t.finalStatus).toBe('halted');
    });

    it('8. should tag stale cache revocation candidates', () => {
      const generator = new SyntheticDataGenerator({ seed: 42 });
      const specs = generator.generate(100);

      const staleCandidates = specs.filter((s) => s.isStaleCacheCandidate);
      expect(staleCandidates.length).toBeGreaterThan(0);
    });

    it('9. should correctly compute batch summary metrics', () => {
      const generator = new SyntheticDataGenerator({ seed: 42 });
      const specs = generator.generate(60);

      const summary = computeSummaryReport(specs, 42, 250);
      expect(summary.totalSubscriptions).toBe(60);
      expect(summary.seedUsed).toBe(42);
      expect(summary.totalEventsSynthesized).toBe(250);
      expect(summary.totalSimulatedARR).toBe(
        Math.round(specs.reduce((sum, s) => sum + s.annualizedValue, 0) / 100),
      );
    });
  });

  describe('Event-Sourced Synthesis & Ledger Integrity', () => {
    it('10. should replay event lifecycles, populate tables, and maintain 100% hash chain integrity', async () => {
      const db = newDb();
      db.public.registerFunction({
        name: 'now',
        returns: DataType.timestamp,
        implementation: () => new Date().toISOString(),
      });

      db.public.none(`
        CREATE TYPE instrument_rail AS ENUM ('card', 'upi_autopay', 'enach');
        CREATE TYPE mandate_status AS ENUM ('active', 'paused', 'revoked', 'expired');
        CREATE TYPE subscription_status AS ENUM ('authenticated', 'activated', 'active', 'pending', 'halted', 'paused', 'resumed', 'completed', 'cancelled');
        CREATE TYPE event_actor AS ENUM ('razorpay_webhook', 'health_scorer', 'recovery_planner', 'policy_engine', 'circuit_breaker', 'verification_gateway', 'execution_engine', 'human');

        CREATE TABLE instruments (
          instrument_id VARCHAR(255) PRIMARY KEY,
          subscription_id VARCHAR(255) NOT NULL,
          rail instrument_rail NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expiry_date TIMESTAMPTZ NULL,
          mandate_status mandate_status NOT NULL DEFAULT 'active',
          last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          ltv_tier VARCHAR(50) NOT NULL DEFAULT 'standard',
          annualized_value BIGINT NOT NULL DEFAULT 0
        );

        CREATE TABLE subscriptions (
          subscription_id VARCHAR(255) PRIMARY KEY,
          customer_id VARCHAR(255) NOT NULL,
          plan_id VARCHAR(255) NOT NULL,
          status subscription_status NOT NULL DEFAULT 'pending',
          current_instrument_id VARCHAR(255) NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE events (
          event_id VARCHAR(255) PRIMARY KEY,
          sequence_number BIGSERIAL UNIQUE NOT NULL,
          prev_hash VARCHAR(64) NOT NULL,
          hash VARCHAR(64) NOT NULL,
          subscription_id VARCHAR(255) NULL,
          instrument_id VARCHAR(255) NULL,
          event_type VARCHAR(100) NOT NULL,
          payload JSONB NOT NULL DEFAULT '{}',
          actor event_actor NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      const adapter = db.adapters.createPg();
      const pool = new adapter.Pool() as unknown as pg.Pool;

      const eventStore = new EventStore(pool);
      const seeder = new SyntheticDataSeeder(eventStore, pool);

      const generator = new SyntheticDataGenerator({ seed: 42 });
      const specs = generator.generate(50);

      const result = await seeder.seedBatch(specs);

      expect(result.subscriptionsSeeded).toBe(50);
      expect(result.eventsAppended).toBeGreaterThan(150);
      expect(result.chainIntegrityValid).toBe(true);

      // Verify database tables
      const subCount = await pool.query('SELECT COUNT(*) FROM subscriptions;');
      expect(Number(subCount.rows[0].count)).toBe(50);

      const instCount = await pool.query('SELECT COUNT(*) FROM instruments;');
      expect(Number(instCount.rows[0].count)).toBe(50);

      // Verify ledger forensic audit
      const integrity = await eventStore.verifyChainIntegrity();
      expect(integrity.valid).toBe(true);
      expect(integrity.verifiedCount).toBe(result.eventsAppended);
      expect(integrity.errors).toHaveLength(0);

      await pool.end();
    });
  });
});
