import dotenv from 'dotenv';
import { newDb, DataType } from 'pg-mem';
import pg from 'pg';
import {
  RecoveryPipelineOrchestrator,
  getPool,
  closePool,
  EventStore,
  RazorpayClient,
  type PipelineBatchSummary,
} from '@recovery/server';
import { SyntheticDataGenerator } from './synthetic/generator.js';
import { SyntheticDataSeeder } from './synthetic/seeder.js';

dotenv.config();

function createInMemoryDatabase(): { pool: pg.Pool; eventStore: EventStore } {
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

  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool() as unknown as pg.Pool;
  const eventStore = new EventStore(pool);

  return { pool, eventStore };
}

export async function runPipelineBatchCli(): Promise<PipelineBatchSummary> {
  console.log('================================================================');
  console.log(' AUTONOMOUS RECOVERY CONTROL PLANE: FULL PIPELINE BATCH EXECUTION');
  console.log('================================================================\n');

  let pool: pg.Pool;
  let eventStore: EventStore;
  let isInMemory = false;

  try {
    pool = getPool();
    const testRes = await pool.query<{ count: string }>('SELECT count(*) FROM instruments;');
    if (parseInt(testRes.rows[0].count, 10) === 0) {
      throw new Error('Instruments table empty');
    }
    eventStore = new EventStore(pool);
  } catch {
    isInMemory = true;
    console.log('[Pipeline Batch] Local PostgreSQL unreachable or empty; seeding in-memory synthetic environment...');
    const memDb = createInMemoryDatabase();
    pool = memDb.pool;
    eventStore = memDb.eventStore;

    // Seed 100 synthetic instruments with seed 42
    const generator = new SyntheticDataGenerator({ seed: 42 });
    const specs = generator.generate(100);
    const seeder = new SyntheticDataSeeder(eventStore, pool);
    await seeder.seedBatch(specs);
    console.log(`[Pipeline Batch] In-memory database seeded with ${specs.length} subscriptions.\n`);
  }

  // Register simulated live token overrides for synthetic batch run
  const generator = new SyntheticDataGenerator({ seed: 42 });
  const specs = generator.generate(100);
  for (const spec of specs) {
    RazorpayClient.setSimulatedLiveOverride(spec.instrumentId, {
      mandateStatus: spec.isStaleCacheCandidate ? 'revoked' : spec.mandateStatus,
    });
    RazorpayClient.setSimulatedLiveOverride(spec.subscriptionId, {
      subscriptionStatus: spec.isStaleCacheCandidate ? 'halted' : spec.finalStatus,
    });
  }

  const orchestrator = new RecoveryPipelineOrchestrator({ pool, eventStore });

  console.log('[Pipeline Batch] Executing end-to-end recovery pipeline...');
  console.log('  Layers: Risk Scorer -> Planner -> Policy Engine -> Circuit Breaker -> Verification Gateway -> Execution / Escalation\n');

  const startTime = Date.now();
  const summary = await orchestrator.processBatch();
  const wallClockMs = Date.now() - startTime;

  console.log('================ BATCH EXECUTION SUMMARY REPORT ================');
  console.log(`Total Instruments Processed : ${summary.totalProcessed}`);
  console.log(`Autonomous Actions Executed : ${summary.executedCount}`);
  console.log(`Total Escalated to Ops Queue: ${summary.escalatedCount}`);
  console.log(`  - Blocked by Verification : ${summary.blockedByVerificationCount}`);
  console.log(`  - Blocked by Circuit Brkr : ${summary.blockedByCircuitBreakerCount}`);
  console.log(`  - Blocked by Policy Engine: ${summary.blockedByPolicyCount}`);
  console.log(`No-Op (Healthy / Terminal)  : ${summary.noOpCount}`);
  console.log(`Observed Wall-Clock Timing  : ${wallClockMs} ms (${(wallClockMs / 1000).toFixed(2)}s)`);

  console.log('\n--- Breakdown by Executed / Proposed Action Type ---');
  for (const [action, count] of Object.entries(summary.byActionType)) {
    if (count > 0) {
      console.log(`  - ${action.padEnd(20)}: ${count}`);
    }
  }

  if (summary.scorecard) {
    const sc = summary.scorecard;
    console.log('\n================ FINANCIAL ATTRIBUTION & NVR SCORECARD ================');
    console.log(`Total Monitored MRR          : ₹${Math.round(sc.totalMonitoredMRRPaise / 100).toLocaleString('en-IN')}`);
    console.log(`Total Monitored ARR          : ₹${Math.round(sc.totalMonitoredARRPaise / 100).toLocaleString('en-IN')}`);
    console.log(`Total At-Risk MRR            : ₹${Math.round(sc.totalAtRiskMRRPaise / 100).toLocaleString('en-IN')}`);
    console.log(`Total Recovered MRR          : ₹${Math.round(sc.totalRecoveredMRRPaise / 100).toLocaleString('en-IN')}`);
    console.log(`  - Proactive Recovered MRR  : ₹${Math.round(sc.proactiveRecoveredMRRPaise / 100).toLocaleString('en-IN')} (${sc.proactiveSubscriptionsCount} subs)`);
    console.log(`  - Reactive Recovered MRR   : ₹${Math.round(sc.reactiveRecoveredMRRPaise / 100).toLocaleString('en-IN')} (${sc.reactiveSubscriptionsCount} subs)`);
    console.log(`Revenue Prevented (Net Saved): ₹${Math.round(sc.revenuePreventedMRRPaise / 100).toLocaleString('en-IN')}`);
    console.log(`Intentionally Untouched MRR  : ₹${Math.round(sc.untouchedMRRPaise / 100).toLocaleString('en-IN')} (${sc.untouchedSubscriptionsCount} healthy subs)`);
    console.log(`Unsafe/Blocked Actions Count : ${sc.unsafeBlockedActionsCount}`);
    console.log(`Net Value Recovered (NVR)    : ₹${Math.round(sc.netValueRecoveredPaise / 100).toLocaleString('en-IN')}`);
    console.log(`Autonomous Recovery Rate     : ${sc.recoveryRatePercent}%`);
    console.log('========================================================================');
  }

  // Audit trail verification
  const events = await eventStore.getAllEvents({ limit: 5000 });
  const execEvents = events.filter(
    (e) =>
      e.eventType === 'action_executed' ||
      e.eventType === 'action_escalated' ||
      e.eventType === 'action_noop' ||
      e.eventType === 'recovery_recorded',
  );

  console.log(`\nExecution & Attribution Events: ${execEvents.length}`);
  const integrity = await eventStore.verifyChainIntegrity();
  console.log(`Event Store Chain Integrity   : ${integrity.valid ? 'VALID (100% Intact Chain)' : 'INVALID'}`);
  console.log('================================================================\n');

  if (!isInMemory) {
    await closePool();
  } else {
    await pool.end();
  }

  return summary;
}

async function main() {
  try {
    await runPipelineBatchCli();
    process.exit(0);
  } catch (error) {
    console.error('[Pipeline Batch] Fatal execution error:', error);
    try {
      await closePool();
    } catch {
      // Ignore secondary close error
    }
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  main();
}
