import 'server-only';

import Redis from 'ioredis';
import { getConfig } from '@/lib/config';
import type { QuotaResult } from '@/lib/quota/types';

const memoryStore = new Map<number, QuotaResult>();
let redisClient: Redis | null = null;
let redisDisabledUntil = 0;

function keyFor(vendorId: number): string {
  return `quota-monitor:endpoint:${vendorId}`;
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

export async function getCachedVendorResult(vendorId: number): Promise<QuotaResult | null> {
  if (!Number.isInteger(vendorId) || vendorId <= 0) {
    return null;
  }

  const redisValue = await withRedis((redis) => redis.get(keyFor(vendorId)));
  if (redisValue !== null) {
    return parseQuotaResult(redisValue);
  }

  return memoryStore.get(vendorId) ?? null;
}

export async function getCachedVendorResults(vendorIds: number[]): Promise<Map<number, QuotaResult>> {
  const resultMap = new Map<number, QuotaResult>();
  const validIds = vendorIds.filter((id) => Number.isInteger(id) && id > 0);

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

  for (const vendorId of validIds) {
    const cached = memoryStore.get(vendorId);
    if (cached) {
      resultMap.set(vendorId, cached);
    }
  }

  return resultMap;
}

export async function setCachedVendorResult(vendorId: number, result: QuotaResult): Promise<void> {
  if (!Number.isInteger(vendorId) || vendorId <= 0) {
    return;
  }

  const serialized = JSON.stringify(result);
  const ttl = getConfig().resultCacheTtlSec;

  const redisSaved = await withRedis(async (redis) => {
    await redis.set(keyFor(vendorId), serialized, 'EX', ttl);
    return true;
  });

  if (redisSaved === null) {
    memoryStore.set(vendorId, result);
    return;
  }

  memoryStore.set(vendorId, result);
}

export async function deleteCachedVendorResult(vendorId: number): Promise<void> {
  if (!Number.isInteger(vendorId) || vendorId <= 0) {
    return;
  }

  await withRedis(async (redis) => {
    await redis.del(keyFor(vendorId));
    return true;
  });

  memoryStore.delete(vendorId);
}
