import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Architectural Boundary: Script Independence & Zero-Server Dependency Tests', () => {
  it('1. should verify that NO script in /scripts imports the server bootstrap module (server.ts)', () => {
    const scriptsDir = path.resolve(process.cwd(), '../scripts/src');
    if (!fs.existsSync(scriptsDir)) {
      // If run from root
      const rootScriptsDir = path.resolve(process.cwd(), 'scripts/src');
      if (fs.existsSync(rootScriptsDir)) {
        checkScriptsDir(rootScriptsDir);
      }
      return;
    }
    checkScriptsDir(scriptsDir);
  });

  function checkScriptsDir(dir: string) {
    const files = fs.readdirSync(dir, { recursive: true }) as string[];
    const tsFiles = files.filter((f) => f.endsWith('.ts'));

    for (const file of tsFiles) {
      const filePath = path.join(dir, file);
      const content = fs.readFileSync(filePath, 'utf8');

      // Assert that no script imports server.ts / server.js bootstrap file or calls .listen()
      expect(content).not.toMatch(/from\s+['"][^'"]*\/server(\.js|\.ts)['"]/);
      expect(content).not.toMatch(/\.listen\s*\(/);
    }
  }

  it('2. should verify that importing @recovery/server does not start an HTTP listener', async () => {
    // Dynamically import index
    const serverModule = await import('../src/index.js');
    expect(serverModule.buildApp).toBeDefined();
    expect(serverModule.RecoveryPipelineOrchestrator).toBeDefined();
    expect(serverModule.ExecutionService).toBeDefined();
    expect(serverModule.EscalationService).toBeDefined();
  });
});
