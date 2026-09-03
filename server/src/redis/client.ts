import { Redis } from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

let globalRedis: Redis | null = null;

export function getRedisUrl(): string {
  return process.env.REDIS_URL || 'redis://localhost:6379';
}

export function createRedisClient(url?: string): Redis {
  const redisUrl = url || getRedisUrl();
  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    retryStrategy(times) {
      if (times > 3) return null; // do not retry indefinitely in tests
      return Math.min(times * 200, 1000);
    },
    lazyConnect: true,
  });

  client.on('error', (err) => {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[Redis] Connection warning:', err.message);
    }
  });

  return client;
}

export function getRedisClient(): Redis {
  if (!globalRedis) {
    globalRedis = createRedisClient();
  }
  return globalRedis;
}

export async function checkRedisHealth(client?: Redis): Promise<boolean> {
  const r = client || getRedisClient();
  try {
    if (r.status === 'wait') {
      await r.connect();
    }
    const pong = await r.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

export async function closeRedis(client?: Redis): Promise<void> {
  const target = client || globalRedis;
  if (target) {
    try {
      if (target.status === 'ready' || target.status === 'connecting') {
        await target.quit();
      } else {
        target.disconnect();
      }
    } catch {
      target.disconnect();
    }
    if (target === globalRedis) {
      globalRedis = null;
    }
  }
}
