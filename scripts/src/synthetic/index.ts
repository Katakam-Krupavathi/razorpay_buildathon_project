import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { closePool } from '@recovery/server';
import { SyntheticDataGenerator } from './generator.js';
import { SyntheticDataSeeder } from './seeder.js';
import type { BatchSummaryReport, SyntheticSubscriptionSpec } from './types.js';

dotenv.config();

export function computeSummaryReport(
  specs: SyntheticSubscriptionSpec[],
  seedUsed: number,
  totalEvents: number,
): BatchSummaryReport {
  const countsByRail = { card: 0, upi_autopay: 0, enach: 0 };
  const countsByProfile = { HEALTHY: 0, DEGRADING: 0, TERMINAL: 0 };
  const countsByLtvTier = { low: 0, medium: 0, high: 0, critical: 0 };

  let cardsNearExpiryCount = 0;
  let upiOverAfaCount = 0;
  let staleCacheCandidatesCount = 0;
  let totalMrrPaise = 0;
  let totalArrPaise = 0;

  for (const s of specs) {
    countsByRail[s.rail]++;
    countsByProfile[s.healthProfile]++;
    countsByLtvTier[s.ltvTier]++;

    if (s.isNearCardExpiry) cardsNearExpiryCount++;
    if (s.isOverAfaThreshold && s.rail === 'upi_autopay') upiOverAfaCount++;
    if (s.isStaleCacheCandidate) staleCacheCandidatesCount++;

    totalMrrPaise += s.monthlyAmount;
    totalArrPaise += s.annualizedValue;
  }

  return {
    timestamp: new Date().toISOString(),
    seedUsed,
    totalSubscriptions: specs.length,
    countsByRail,
    countsByProfile,
    countsByLtvTier,
    cardsNearExpiryCount,
    upiOverAfaCount,
    staleCacheCandidatesCount,
    totalSimulatedMRR: Math.round(totalMrrPaise / 100),
    totalSimulatedARR: Math.round(totalArrPaise / 100),
    totalEventsSynthesized: totalEvents,
  };
}

export function formatMarkdownSummary(report: BatchSummaryReport): string {
  return `# Synthetic Dataset Generation Summary Report

**Generated At:** \`${report.timestamp}\`  
**Random Seed Used:** \`${report.seedUsed}\`  
**Total Subscriptions Created:** \`${report.totalSubscriptions}\`  
**Total Events Synthesized & Chained:** \`${report.totalEventsSynthesized}\`  
**Total Simulated MRR:** \`₹${report.totalSimulatedMRR.toLocaleString('en-IN')}\`  
**Total Simulated ARR:** \`₹${report.totalSimulatedARR.toLocaleString('en-IN')}\`  

---

## 1. Instrument Rail Distribution

| Payment Rail | Count | Percentage | Description |
| :--- | :--- | :--- | :--- |
| **UPI AutoPay** | \`${report.countsByRail.upi_autopay}\` | \`${((report.countsByRail.upi_autopay / report.totalSubscriptions) * 100).toFixed(1)}%\` | Recurring UPI mandates via VPA / apps |
| **Recurring Cards** | \`${report.countsByRail.card}\` | \`${((report.countsByRail.card / report.totalSubscriptions) * 100).toFixed(1)}%\` | Credit & debit card tokenized mandates |
| **E-NACH / NetBanking** | \`${report.countsByRail.enach}\` | \`${((report.countsByRail.enach / report.totalSubscriptions) * 100).toFixed(1)}%\` | High-value direct bank recurring debits |

---

## 2. Subscription Health Trajectory Profiles

| Health Profile | Count | Percentage | Operational Behaviour |
| :--- | :--- | :--- | :--- |
| **HEALTHY** | \`${report.countsByProfile.HEALTHY}\` | \`${((report.countsByProfile.HEALTHY / report.totalSubscriptions) * 100).toFixed(1)}%\` | Consistent success history; status: \`active\` |
| **DEGRADING** | \`${report.countsByProfile.DEGRADING}\` | \`${((report.countsByProfile.DEGRADING / report.totalSubscriptions) * 100).toFixed(1)}%\` | Recent soft declines (insufficient funds / bank downtime); status: \`pending\` |
| **TERMINAL** | \`${report.countsByProfile.TERMINAL}\` | \`${((report.countsByProfile.TERMINAL / report.totalSubscriptions) * 100).toFixed(1)}%\` | Max retries exhausted / mandate revoked; status: \`halted\` |

---

## 3. LTV Tier Distribution

| LTV Tier | Count | Percentage | Typical Monthly Range |
| :--- | :--- | :--- | :--- |
| **Low** | \`${report.countsByLtvTier.low}\` | \`${((report.countsByLtvTier.low / report.totalSubscriptions) * 100).toFixed(1)}%\` | ₹499 – ₹1,499 |
| **Medium** | \`${report.countsByLtvTier.medium}\` | \`${((report.countsByLtvTier.medium / report.totalSubscriptions) * 100).toFixed(1)}%\` | ₹1,999 – ₹4,999 |
| **High** | \`${report.countsByLtvTier.high}\` | \`${((report.countsByLtvTier.high / report.totalSubscriptions) * 100).toFixed(1)}%\` | ₹7,500 – ₹19,999 |
| **Critical** | \`${report.countsByLtvTier.critical}\` | \`${((report.countsByLtvTier.critical / report.totalSubscriptions) * 100).toFixed(1)}%\` | ₹25,000 – ₹1,00,000 |

---

## 4. Key Simulation Features & Failure Invariant Seeds

- **Cards Near Expiry (0–20 Days):** \`${report.cardsNearExpiryCount}\` instruments  
  *Triggers proactive card update dunning flows in Risk Engine (Phase 4–6).*
- **UPI Autopay Exceeding AFA Threshold:** \`${report.upiOverAfaCount}\` subscriptions  
  *Amounts exceeding RBI limit (₹15,000 standard or ₹1,00,000 MCC category) requiring step-up auth.*
- **Stale Cache Revocation Candidates:** \`${report.staleCacheCandidatesCount}\` instruments  
  *Seeded as \`active\` in DB to demonstrate live mandate verification & cache invalidation in Phase 8/13.*
`;
}

export async function runGeneratorCli(
  args: string[] = process.argv.slice(2),
): Promise<BatchSummaryReport> {
  let count = 100;
  let seed = 42;
  let outputPath = path.resolve(process.cwd(), 'docs/SAMPLE_BATCH_SUMMARY.md');

  for (const arg of args) {
    if (arg.startsWith('--count=')) {
      count = parseInt(arg.split('=')[1], 10) || 100;
    } else if (arg.startsWith('--seed=')) {
      seed = parseInt(arg.split('=')[1], 10) || 42;
    } else if (arg === '--random') {
      seed = Math.floor(Date.now() % 1000000);
    } else if (arg.startsWith('--output=')) {
      outputPath = path.resolve(process.cwd(), arg.split('=')[1]);
    }
  }

  console.log(
    `[Synthetic Generator] Generating ${count} synthetic subscriptions with seed ${seed}...`,
  );

  const generator = new SyntheticDataGenerator({ seed });
  const specs = generator.generate(count);

  console.log(
    `[Synthetic Generator] Replaying and event-sourcing ${specs.length} subscriptions into EventStore...`,
  );
  const seeder = new SyntheticDataSeeder();
  const seedResult = await seeder.seedBatch(specs);

  console.log(
    `[Synthetic Generator] Successfully seeded ${seedResult.subscriptionsSeeded} subscriptions with ${seedResult.eventsAppended} chained events.`,
  );
  console.log(
    `[Synthetic Generator] Ledger Chain Integrity: ${seedResult.chainIntegrityValid ? 'VALID (100% Verified)' : 'FAILED'}`,
  );

  const report = computeSummaryReport(specs, seed, seedResult.eventsAppended);

  // Write markdown report
  const markdown = formatMarkdownSummary(report);
  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  fs.writeFileSync(outputPath, markdown, 'utf8');
  console.log(`[Synthetic Generator] Summary report saved to: ${outputPath}`);

  console.log('\n================ BATCH GENERATION SUMMARY ================');
  console.log(`Total Subscriptions : ${report.totalSubscriptions}`);
  console.log(`Total Events Chained: ${report.totalEventsSynthesized}`);
  console.log(`Total Simulated MRR : ₹${report.totalSimulatedMRR.toLocaleString('en-IN')}`);
  console.log(`Total Simulated ARR : ₹${report.totalSimulatedARR.toLocaleString('en-IN')}`);
  console.log(
    `UPI AutoPay / Cards / E-NACH: ${report.countsByRail.upi_autopay} / ${report.countsByRail.card} / ${report.countsByRail.enach}`,
  );
  console.log(
    `Healthy / Degrading / Terminal: ${report.countsByProfile.HEALTHY} / ${report.countsByProfile.DEGRADING} / ${report.countsByProfile.TERMINAL}`,
  );
  console.log(`Cards Near Expiry (0-20d): ${report.cardsNearExpiryCount}`);
  console.log(`UPI Over AFA Limit   : ${report.upiOverAfaCount}`);
  console.log(`Stale Cache Candidates: ${report.staleCacheCandidatesCount}`);
  console.log('==========================================================\n');

  return report;
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  runGeneratorCli()
    .then(() => closePool())
    .catch((err) => {
      console.error('[Synthetic Generator] Fatal error:', err);
      process.exit(1);
    });
}
