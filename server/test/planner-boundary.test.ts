import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Architectural Boundary Guard: Zero Execution Authority in Planner', () => {
  const plannerDir = path.resolve(process.cwd(), 'src/planner');

  // Note: This is a regex-based static architectural guard, not a full AST/dependency-graph tool.
  // Dynamic runtime imports could theoretically bypass static text analysis; production builds enforce strict ESM static module graphs.
  // Forbidden patterns that violate the zero-execution boundary
  const FORBIDDEN_IMPORT_PATTERNS = [
    /from\s+['"].*\/razorpay\/client(\.js)?['"]/,
    /from\s+['"].*\/execution\/.*['"]/,
    /from\s+['"].*\/routes\/.*['"]/,
    /import\s+.*RazorpayClient.*/,
    /\b(fetch|axios|https?\.request)\b/,
  ];

  it('1. should verify that all files in server/src/planner/ strictly respect zero execution authority', () => {
    expect(fs.existsSync(plannerDir)).toBe(true);

    const files = fs.readdirSync(plannerDir).filter((f) => f.endsWith('.ts') || f.endsWith('.js'));
    expect(files.length).toBeGreaterThan(0);

    const violations: Array<{ file: string; pattern: string }> = [];

    for (const file of files) {
      const filePath = path.join(plannerDir, file);
      const content = fs.readFileSync(filePath, 'utf8');

      for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
        if (pattern.test(content)) {
          violations.push({
            file,
            pattern: pattern.toString(),
          });
        }
      }
    }

    expect(
      violations,
      `Architectural boundary violated! Planner must have ZERO execution authority. Violations found: ${JSON.stringify(violations)}`,
    ).toHaveLength(0);
  });

  it('2. should verify that pure planner engine (planner.ts) has zero network or side-effect capabilities', () => {
    const plannerFile = path.join(plannerDir, 'planner.ts');
    const content = fs.readFileSync(plannerFile, 'utf8');

    // Pure planner must only import types and pure helpers
    expect(content).not.toContain('RazorpayClient');
    expect(content).not.toContain('fetch(');
    expect(content).not.toContain('http');
  });

  it('3. should confirm that boundary detector catches simulated forbidden imports', () => {
    const testForbiddenCode = `
      import { RazorpayClient } from '../razorpay/client.js';
      const client = new RazorpayClient();
      await fetch('https://api.razorpay.com');
    `;

    const foundViolation = FORBIDDEN_IMPORT_PATTERNS.some((p) => p.test(testForbiddenCode));
    expect(foundViolation).toBe(true);
  });
});
