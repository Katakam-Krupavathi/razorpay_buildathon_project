import dotenv from 'dotenv';
import {
  resetDatabase,
  closePool,
  getPool,
  EventStore,
  RecoveryPipelineOrchestrator,
} from '@recovery/server';
import { SyntheticDataGenerator } from './synthetic/generator.js';
import { SyntheticDataSeeder } from './synthetic/seeder.js';

dotenv.config();

export async function bootstrapDemoEnvironment() {
  console.log('\n' + '='.repeat(80));
  console.log('  ⚡ AUTONOMOUS REVENUE RECOVERY CONTROL PLANE — ONE-COMMAND DEMO BOOTSTRAP');
  console.log('='.repeat(80));

  const pool = getPool();
  const eventStore = new EventStore(pool);

  try {
    // 1. Reset database tables cleanly
    console.log('\n[1/4] 🧹 Resetting database tables & applying schema...');
    await resetDatabase();
    console.log('      ✅ Database reset successfully.');

    // 2. Generate deterministic synthetic dataset (seed=42)
    console.log('\n[2/4] 🧬 Generating deterministic synthetic dataset (seed=42)...');
    const generator = new SyntheticDataGenerator({ seed: 42 });
    const specs = generator.generate(100);
    console.log(`      ✅ Generated ${specs.length} realistic subscription lifecycles across Card, UPI, and eNACH.`);

    // 3. Seed hash-chained events and materialize relational tables
    console.log('\n[3/4] 🔗 Seeding ledger events & materializing subscription state...');
    const seeder = new SyntheticDataSeeder(eventStore, pool);
    const seedResult = await seeder.seedBatch(specs);
    console.log(`      ✅ Appended ${seedResult.eventsAppended} events across ${seedResult.subscriptionsSeeded} subscriptions.`);
    console.log(`      🔒 SHA-256 Ledger Integrity: ${seedResult.chainIntegrityValid ? '100% VALID & VERIFIED' : 'FAILED'}`);

    // 4. Run recovery pipeline batch orchestrator once to populate live decision traces & scorecard
    console.log('\n[4/4] 🤖 Orchestrating Autonomous Recovery Agent Batch (Phases 4–11)...');
    const orchestrator = new RecoveryPipelineOrchestrator({ pool, eventStore });
    const batchResult = await orchestrator.processBatch();

    const scorecard = batchResult.scorecard;
    const arr = scorecard ? Math.round(scorecard.totalMonitoredARRPaise / 100).toLocaleString('en-IN') : '0';
    const atRisk = scorecard ? Math.round(scorecard.totalAtRiskMRRPaise / 100).toLocaleString('en-IN') : '0';
    const recovered = scorecard ? Math.round(scorecard.totalRecoveredMRRPaise / 100).toLocaleString('en-IN') : '0';
    const rate = scorecard ? scorecard.recoveryRatePercent.toFixed(1) : '0.0';
    const proactive = scorecard ? Math.round(scorecard.proactiveRecoveredMRRPaise / 100).toLocaleString('en-IN') : '0';
    const reactive = scorecard ? Math.round(scorecard.reactiveRecoveredMRRPaise / 100).toLocaleString('en-IN') : '0';
    const netSaved = scorecard ? Math.round(scorecard.netValueRecoveredPaise / 100).toLocaleString('en-IN') : '0';
    const unsafeBlocked = scorecard ? scorecard.unsafeBlockedActionsCount : 0;

    console.log('\n' + '-'.repeat(80));
    console.log('  📊 INITIALIZED LIVE BATCH SCORECARD');
    console.log('-'.repeat(80));
    console.log(`  • Total Subscriptions Monitored: ${batchResult.totalProcessed}`);
    console.log(`  • Monitored ARR:                ₹${arr}`);
    console.log(`  • Monthly Revenue at Risk:      ₹${atRisk}`);
    console.log(`  • Gross Recovered MRR:          ₹${recovered} (${rate}% recovery rate)`);
    console.log(`  • Proactive Pre-Expiry Saves:   ₹${proactive}`);
    console.log(`  • Reactive Smart Retries:       ₹${reactive}`);
    console.log(`  • Counterfactual Net Saved:     ₹${netSaved}`);
    console.log(`  • Unsafe Actions Blocked:       ${unsafeBlocked} (Stale states & Circuit breakers)`);
    console.log('-'.repeat(80));

    console.log('\n🚀 Demo Environment is ready!');
    console.log('   • API Server:  http://localhost:4000');
    console.log('   • UI Dashboard: http://localhost:5173\n');

    return {
      success: true,
      batchResult,
      seedResult,
    };
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string };
    if (err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
      console.error('\n❌ Database connection failed (ECONNREFUSED at localhost:5432).');
      console.error('   💡 Please start the PostgreSQL stack with: docker compose up -d');
    } else {
      console.error('\n❌ Bootstrap failed:', error);
    }
    throw error;
  }
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  bootstrapDemoEnvironment()
    .then(async () => {
      await closePool();
      process.exit(0);
    })
    .catch(async () => {
      await closePool();
      process.exit(1);
    });
}
