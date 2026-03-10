import 'server-only';

import Redis from 'ioredis';
import { getConfig } from '@/lib/config';
import type { QuotaDebugSnapshot } from '@/lib/quota/types';
import { markRedisCacheUpdated } from '@/lib/redis-cache-meta';

const memoryStore = new Map<number, QuotaDebugSnapshot>();
let redisClient: Redis | null = null;
let redisDisabledUntil = 0;

function keyFor(endpointId: number): string {
  return `quota-monitor:debug:provider:${endpointId}`;
}

function shouldDisableRedis(): boolean {
  return Date.now() < redisDisabledUntil;
}

function markRedisTemporarilyDisabled(): void {
  redisDisabledUntil = Date.now() + 30_000;
}

function getRedisClient(): Redis | null {
  if (shouldDisableRedis()) {
    return null;
  }

  const redisUrl = getConfig().redisUrl;
  if (!redisUrl) {
    return null;
  }

  if (redisClient) {
    return redisClient;
  }

  try {
    const redisUrlLower = redisUrl.toLowerCase();
    const useTls = redisUrlLower.startsWith('rediss://');

    redisClient = new Redis(redisUrl, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      ...(useTls
        ? {
            tls: {
              rejectUnauthorized: getConfig().redisTlsRejectUnauthorized,
            },
          }
        : {}),
      retryStrategy(times) {
        if (times > 3) {
          return null;
        }
        return Math.min(times * 200, 1000);
      },
    });

    redisClient.on('error', () => {
      markRedisTemporarilyDisabled();
    });

    return redisClient;
  } catch {
    markRedisTemporarilyDisabled();
    return null;
  }
}

async function withRedis<T>(worker: (redis: Redis) => Promise<T>): Promise<T | null> {
  const client = getRedisClient();
  if (!client) {
    return null;
  }

  try {
    if (client.status !== 'ready') {
      await client.connect();
    }
    return await worker(client);
  } catch {
    markRedisTemporarilyDisabled();
    return null;
  }
}

function parseDebugSnapshot(value: string | null): QuotaDebugSnapshot | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as QuotaDebugSnapshot;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    if (!Number.isInteger(parsed.endpointId) || parsed.endpointId <= 0) {
      return null;
    }
    if (!Array.isArray(parsed.probes)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function getCachedDebugSnapshot(endpointId: number): Promise<QuotaDebugSnapshot | null> {
  if (!Number.isInteger(endpointId) || endpointId <= 0) {
    return null;
  }

  const redisValue = await withRedis((redis) => redis.get(keyFor(endpointId)));
  if (redisValue !== null) {
    return parseDebugSnapshot(redisValue);
  }

  return memoryStore.get(endpointId) ?? null;
}

export async function setCachedDebugSnapshot(snapshot: QuotaDebugSnapshot): Promise<void> {
  if (!Number.isInteger(snapshot.endpointId) || snapshot.endpointId <= 0) {
    return;
  }

  const serialized = JSON.stringify(snapshot);
  const ttl = getConfig().resultCacheTtlSec;

  const redisSaved = await withRedis(async (redis) => {
    await redis.set(keyFor(snapshot.endpointId), serialized, 'EX', ttl);
    await markRedisCacheUpdated(redis).catch(() => {});
    return true;
  });

  if (redisSaved === null) {
    memoryStore.set(snapshot.endpointId, snapshot);
    return;
  }

  memoryStore.set(snapshot.endpointId, snapshot);
}
