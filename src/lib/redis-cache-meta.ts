import 'server-only';

import type Redis from 'ioredis';

export const REDIS_CACHE_LAST_UPDATED_AT_KEY = 'quota-monitor:meta:last-updated-at';

export async function markRedisCacheUpdated(redis: Redis): Promise<void> {
  await redis.set(REDIS_CACHE_LAST_UPDATED_AT_KEY, new Date().toISOString());
}
