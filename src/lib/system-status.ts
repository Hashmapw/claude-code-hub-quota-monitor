import 'server-only';

import Redis from 'ioredis';
import { getConfig } from '@/lib/config';
import { getDatabasePath } from '@/lib/db-path';
import { getEndpointSourceStatus, type EndpointSourceStatus } from '@/lib/db';
import { REDIS_CACHE_LAST_UPDATED_AT_KEY } from '@/lib/redis-cache-meta';
import { getSqliteConnection } from '@/lib/sqlite-connection';

export type MonitorSqliteTableStatus = {
  name: string;
  rowCount: number;
};

export type MonitorSqliteStatus = {
  path: string;
  tableCount: number;
  tables: MonitorSqliteTableStatus[];
};

export type HubSourceConnectionStatus = EndpointSourceStatus & {
  connectionDisplay: string;
};

export type RedisStatus = {
  enabled: boolean;
  connected: boolean;
  lastUpdatedAt: string | null;
  errorMessage: string | null;
  connectionDisplay: string | null;
};

export type SystemStatusSnapshot = {
  generatedAt: string;
  hubSource: HubSourceConnectionStatus;
  monitorDatabase: MonitorSqliteStatus;
  redis: RedisStatus;
};

type SqliteTableRow = {
  name: string;
};

function parseCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.trunc(parsed);
}

function maskConnectionString(value: string): string {
  try {
    const parsed = new URL(value);
    const username = decodeURIComponent(parsed.username || '');
    const auth =
      username || parsed.password
        ? `${username || 'user'}${parsed.password ? ':[REDACTED_SECRET]' : ''}@`
        : '';
    const pathname = parsed.pathname.replace(/^\/+/, '');
    const query = parsed.search || '';
    return `${parsed.protocol}//${auth}${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}/${pathname}${query}`;
  } catch {
    return value.replace(/:\/\/([^@/]+)@/, '://[REDACTED_SECRET]@');
  }
}

function buildRedisClient(redisUrl: string): Redis {
  const useTls = redisUrl.toLowerCase().startsWith('rediss://');

  return new Redis(redisUrl, {
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
}

function getMonitorDatabaseStatus(): MonitorSqliteStatus {
  const connection = getSqliteConnection();
  const dbPath = getDatabasePath();
  const tableRows = connection
    .prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name COLLATE NOCASE ASC
    `)
    .all() as SqliteTableRow[];

  const tables = tableRows.map((row) => {
    const countRow = connection
      .prepare(`SELECT COUNT(*) AS count FROM "${row.name.replace(/"/g, '""')}"`)
      .get() as { count?: unknown } | undefined;

    return {
      name: row.name,
      rowCount: parseCount(countRow?.count ?? 0),
    };
  });

  return {
    path: dbPath,
    tableCount: tables.length,
    tables,
  };
}

async function getRedisStatus(): Promise<RedisStatus> {
  const redisUrl = getConfig().redisUrl;
  if (!redisUrl) {
    return {
      enabled: false,
      connected: false,
      lastUpdatedAt: null,
      errorMessage: null,
      connectionDisplay: null,
    };
  }

  const client = buildRedisClient(redisUrl);
  try {
    if (client.status !== 'ready') {
      await client.connect();
    }

    const [pingReply, lastUpdatedAt] = await Promise.all([
      client.ping(),
      client.get(REDIS_CACHE_LAST_UPDATED_AT_KEY),
    ]);

    return {
      enabled: true,
      connected: pingReply === 'PONG',
      lastUpdatedAt: typeof lastUpdatedAt === 'string' && lastUpdatedAt.trim() ? lastUpdatedAt : null,
      errorMessage: null,
      connectionDisplay: maskConnectionString(redisUrl),
    };
  } catch (error) {
    return {
      enabled: true,
      connected: false,
      lastUpdatedAt: null,
      errorMessage: error instanceof Error ? error.message : String(error),
      connectionDisplay: maskConnectionString(redisUrl),
    };
  } finally {
    client.disconnect();
  }
}

export async function getSystemStatusSnapshot(): Promise<SystemStatusSnapshot> {
  const [hubSource, redis] = await Promise.all([
    getEndpointSourceStatus(),
    getRedisStatus(),
  ]);
  const config = getConfig();

  return {
    generatedAt: new Date().toISOString(),
    hubSource: {
      ...hubSource,
      connectionDisplay: maskConnectionString(config.dsn),
    },
    monitorDatabase: getMonitorDatabaseStatus(),
    redis,
  };
}
