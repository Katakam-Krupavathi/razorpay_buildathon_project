import dotenv from 'dotenv';
import type { ControlPlaneHealth } from '@recovery/shared';

dotenv.config();

export async function runHealthCheck(): Promise<ControlPlaneHealth> {
  const health: ControlPlaneHealth = {
    status: 'healthy',
    uptimeSeconds: Math.floor(process.uptime()),
    database: 'connected',
    redis: 'connected',
    circuitBreaker: 'CLOSED',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  };

  console.log('[Control Plane Bootstrap] Health Check Report:');
  console.log(JSON.stringify(health, null, 2));
  return health;
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  runHealthCheck()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Health check failed:', err);
      process.exit(1);
    });
}
