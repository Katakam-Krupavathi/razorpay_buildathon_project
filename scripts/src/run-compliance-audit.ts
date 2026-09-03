import pg from 'pg';
import { DataType, newDb } from 'pg-mem';
import {
  EventStore,
  DecisionTraceService,
  ComplianceService,
  RecoveryPipelineOrchestrator,
} from '@recovery/server';
import { SyntheticDataGenerator } from './synthetic/generator.js';
import { SyntheticDataSeeder } from './synthetic/seeder.js';
import type { SyntheticSubscriptionSpec } from './synthetic/types.js';

interface MemoryDatabaseSetup {
  pool: pg.Pool;
  eventStore: EventStore;
}

function createInMemoryDatabase(): MemoryDatabaseSetup {
  const db = newDb({ autoCreateForeignKeyIndices: true });

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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      razorpay_event_id VARCHAR(255) NULL
    );

    CREATE TABLE health_snapshots (
      snapshot_id VARCHAR(255) PRIMARY KEY,
      instrument_id VARCHAR(255) NULL,
      subscription_id VARCHAR(255) NULL,
      health_score NUMERIC(5, 4) NOT NULL DEFAULT 1.0000,
      trajectory VARCHAR(50) NOT NULL DEFAULT 'HEALTHY',
      root_cause VARCHAR(100) NOT NULL DEFAULT 'NONE',
      recovery_probability NUMERIC(5, 4) NOT NULL DEFAULT 1.0000,
      features JSONB NOT NULL DEFAULT '{}',
      computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE policy_decisions (
      decision_id VARCHAR(255) PRIMARY KEY,
      subscription_id VARCHAR(255) NOT NULL,
      decision VARCHAR(50) NOT NULL,
      target_action VARCHAR(100) NOT NULL,
      evaluated_rules JSONB NOT NULL DEFAULT '[]',
      evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE recovery_outcomes (
      outcome_id VARCHAR(255) PRIMARY KEY,
      invoice_id VARCHAR(255) NULL,
      subscription_id VARCHAR(255) NOT NULL,
      instrument_id VARCHAR(255) NULL,
      at_risk_amount BIGINT NOT NULL DEFAULT 0,
      recovered_amount BIGINT NOT NULL DEFAULT 0,
      cost_incurred BIGINT NOT NULL DEFAULT 0,
      net_value_recovered BIGINT NOT NULL DEFAULT 0,
      recovery_type VARCHAR(50) NOT NULL DEFAULT 'none',
      status VARCHAR(50) NOT NULL,
      estimated_baseline_outcome VARCHAR(100) NOT NULL DEFAULT 'total_loss',
      baseline_recovered_estimate BIGINT NOT NULL DEFAULT 0,
      revenue_saved BIGINT NOT NULL DEFAULT 0,
      counterfactual_details JSONB NOT NULL DEFAULT '{}',
      completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE escalation_queue (
      escalation_id VARCHAR(255) PRIMARY KEY,
      instrument_id VARCHAR(255) NOT NULL,
      subscription_id VARCHAR(255) NULL,
      reason TEXT NOT NULL,
      blocked_reason VARCHAR(100) NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      proposed_action VARCHAR(100) NULL,
      payload JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ NULL,
      resolved_by VARCHAR(255) NULL,
      resolution_notes TEXT NULL
    );
  `);

  const memAdapter = db.adapters.createPg();
  const pool = new memAdapter.Pool() as unknown as pg.Pool;
  const eventStore = new EventStore(pool);

  return { pool, eventStore };
}

export async function runComplianceAuditCli() {
  console.log('================================================================');
  console.log(' AUTONOMOUS CONTROL PLANE: COMPLIANCE AUDIT & DECISION TRACE');
  console.log('================================================================\n');

  const { pool, eventStore } = createInMemoryDatabase();

  // 1. Seed synthetic dataset & run full pipeline batch
  console.log('[Audit] Seeding 100 synthetic instruments with seed=42...');
  const generator = new SyntheticDataGenerator({ seed: 42 });
  const specs = generator.generate(100);
  const seeder = new SyntheticDataSeeder(eventStore, pool);
  await seeder.seedBatch(specs);

  console.log('[Audit] Executing full recovery pipeline over batch...');
  const orchestrator = new RecoveryPipelineOrchestrator({ pool, eventStore });
  await orchestrator.processBatch();

  // 2. Initialize Audit & Compliance Services
  const complianceService = new ComplianceService(pool, eventStore);
  const traceService = new DecisionTraceService(pool, eventStore);

  console.log('\n--- COMPLIANCE QUERY 1: GRACE-PERIOD PAUSES ---');
  const pauses = await complianceService.getGracePeriodPausesAudit();
  console.log(`Total Grace-Period Pauses Found: ${pauses.length}`);
  for (const p of pauses.slice(0, 3)) {
    console.log(`  - Sub: ${p.subscriptionId} | Rail: ${p.rail.padEnd(12)} | Rule: ${p.matchedRuleId} | Grace: ${p.gracePeriodDays} days`);
    console.log(`    Root Cause : ${p.rootCause}`);
    console.log(`    Reasoning  : ${p.reasoning}`);
  }

  console.log('\n--- COMPLIANCE QUERY 2: UPI AUTOPAY ATTEMPT CAP (1+3 NPCI CAP) ---');
  const upiCaps = await complianceService.getUpiAutopayCapsAudit();
  const compliantCount = upiCaps.filter((u) => u.compliant).length;
  const maxAttemptsObserved = Math.max(...upiCaps.map((u) => u.totalAttempts), 0);
  console.log(`Total UPI Autopay Instruments Audited: ${upiCaps.length}`);
  console.log(`Compliant Instruments (<= 4 attempts): ${compliantCount} / ${upiCaps.length} (${((compliantCount / upiCaps.length) * 100).toFixed(0)}%)`);
  console.log(`Max Attempts Observed on Any UPI Sub : ${maxAttemptsObserved} (Hard Limit: 4)`);
  for (const u of upiCaps.slice(0, 3)) {
    console.log(`  - Sub: ${u.subscriptionId} | Attempts: ${u.totalAttempts}/4 | Status: ${u.compliant ? 'COMPLIANT (PASS)' : 'VIOLATION (FAIL)'} | Mandate: ${u.currentMandateStatus}`);
  }

  console.log('\n--- COMPLIANCE QUERY 3: STALE-STATE BLOCKED ACTIONS (LAST 30 DAYS) ---');
  const staleBlocks = await complianceService.getStaleStateBlocksAudit(30);
  console.log(`Total Stale-State Pre-Action Blocks: ${staleBlocks.length}`);
  if (staleBlocks.length === 0) {
    console.log('  (Zero stale-state divergences during current synthetic batch run)');
  } else {
    for (const s of staleBlocks) {
      console.log(`  - Sub: ${s.subscriptionId} | Attempted Action: ${s.attemptedAction} | DB: ${s.cachedMandateStatus} vs Live: ${s.liveMandateStatus}`);
    }
  }

  console.log('\n--- COMPLIANCE QUERY 4: CIRCUIT BREAKER TRIPS & COHORTS ---');
  const trips = await complianceService.getCircuitBreakerTripsAudit();
  console.log(`Total Circuit Breaker Trip Events: ${trips.length}`);
  if (trips.length === 0) {
    console.log('  (Zero cohort failures tripped safety breaker during normal run; normal operating window maintained)');
  } else {
    for (const t of trips) {
      console.log(`  - Cohort: ${t.cohortKey} | Failure Rate: ${(t.failureRate * 100).toFixed(1)}% | Threshold: ${(t.threshold * 100).toFixed(0)}% | State: ${t.currentState}`);
    }
  }

  // 3. Select One Subscription and Print Full End-to-End Decision Trace
  const targetSubId =
    specs.find((s: SyntheticSubscriptionSpec) => s.healthProfile === 'DEGRADING' || s.healthProfile === 'TERMINAL')
      ?.subscriptionId || specs[0].subscriptionId;

  console.log('\n================================================================');
  console.log(` END-TO-END DECISION TRACE AUDIT: Subscription ${targetSubId}`);
  console.log('================================================================');

  const trace = await traceService.getDecisionTrace(targetSubId);

  console.log(`Entity ID          : ${trace.entityId}`);
  console.log(`Payment Instrument : ${trace.instrumentId} (Rail: ${trace.rail.toUpperCase()})`);
  console.log(`Annualized Value   : ₹${Math.round(trace.annualizedValuePaise / 100).toLocaleString('en-IN')}`);
  console.log(`Event Chain Status : ${trace.chainValid ? 'VALID (100% Cryptographic Ledger Intact)' : 'INVALID'}`);
  console.log(`Total Events in Log: ${trace.totalEventsCount}`);
  console.log('\n--- DECISION NARRATIVE (Natural Language Explanation) ---');
  console.log(trace.narrative);

  console.log('\n--- CHRONOLOGICAL DECISION LIFECYCLE STEPS ---');
  trace.steps.forEach((step, idx) => {
    console.log(`[Step ${idx + 1}] [${step.stage.toUpperCase().padEnd(14)}] ${step.title}`);
    console.log(`         Actor    : ${step.actor}`);
    console.log(`         Summary  : ${step.summary}`);
    console.log(`         Timestamp: ${step.timestamp}`);
  });
  console.log('================================================================\n');

  await pool.end();
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  runComplianceAuditCli()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Audit CLI] Fatal error:', err);
      process.exit(1);
    });
}
