import 'server-only';

import Redis from 'ioredis';
import { getConfig } from '@/lib/config';
import type { QuotaResult } from '@/lib/quota/types';
import { markRedisCacheUpdated } from '@/lib/redis-cache-meta';

const memoryStore = new Map<number, QuotaResult>();
let redisClient: Redis | null = null;
let redisDisabledUntil = 0;

function keyFor(endpointId: number): string {
  return `quota-monitor:provider:${endpointId}`;
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

function parseQuotaResult(value: string | null): QuotaResult | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as QuotaResult;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function getCachedResult(endpointId: number): Promise<QuotaResult | null> {
  if (!Number.isInteger(endpointId) || endpointId <= 0) {
    return null;
  }

  const redisValue = await withRedis((redis) => redis.get(keyFor(endpointId)));
  if (redisValue !== null) {
    return parseQuotaResult(redisValue);
  }

  return memoryStore.get(endpointId) ?? null;
}

export async function getCachedResults(endpointIds: number[]): Promise<Map<number, QuotaResult>> {
  const resultMap = new Map<number, QuotaResult>();
  const validIds = endpointIds.filter((id) => Number.isInteger(id) && id > 0);

  if (validIds.length === 0) {
    return resultMap;
  }

  const redisValues = await withRedis((redis) => redis.mget(validIds.map((id) => keyFor(id))));
  if (redisValues !== null) {
    for (let index = 0; index < validIds.length; index += 1) {
      const parsed = parseQuotaResult(redisValues[index]);
      if (parsed) {
        resultMap.set(validIds[index], parsed);
      }
    }

    if (resultMap.size > 0) {
      return resultMap;
    }
  }

  for (const endpointId of validIds) {
    const cached = memoryStore.get(endpointId);
    if (cached) {
      resultMap.set(endpointId, cached);
    }
  }

  return resultMap;
}

export async function setCachedResult(endpointId: number, result: QuotaResult): Promise<void> {
  if (!Number.isInteger(endpointId) || endpointId <= 0) {
    return;
  }

  const serialized = JSON.stringify(result);
  const ttl = getConfig().resultCacheTtlSec;

  const redisSaved = await withRedis(async (redis) => {
    await redis.set(keyFor(endpointId), serialized, 'EX', ttl);
    await markRedisCacheUpdated(redis).catch(() => {});
    return true;
  });

  if (redisSaved === null) {
    memoryStore.set(endpointId, result);
    return;
  }

  memoryStore.set(endpointId, result);
}

export async function clearCachedResult(endpointId: number): Promise<void> {
  memoryStore.delete(endpointId);
  await withRedis(async (redis) => {
    await redis.del(keyFor(endpointId));
    return true;
  });
}

export async function clearCachedResults(endpointIds: number[]): Promise<void> {
  for (const endpointId of endpointIds) {
    await clearCachedResult(endpointId);
  }
}
