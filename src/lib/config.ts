import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getSystemSettings } from '@/lib/system-settings';

export type MonitorLogLevel = 'info' | 'debug';

type MonitorConfig = {
  dsn: string;
  schema: string;
  table: string;
  includeDisabled: boolean;
  requestTimeoutMs: number;
  cacheTtlMs: number;
  concurrency: number;
  redisUrl: string | null;
  redisTlsRejectUnauthorized: boolean;
  resultCacheTtlSec: number;
  logLevel: MonitorLogLevel;
  debugHttp: boolean;
};

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

function parseString(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function parseLogLevel(value: string | undefined): MonitorLogLevel {
  const normalized = (value || '').trim().toLowerCase();
  return normalized === 'debug' ? 'debug' : 'info';
}

function readHubEnvValue(keys: string[]): string | null {
  try {
    const envPath = resolve(process.cwd(), '../claude-code-hub/.env');
    const raw = readFileSync(envPath, 'utf-8');
    const lines = raw.split(/\r?\n/);

    for (const key of keys) {
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
          continue;
        }

        const unprefixed = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
        const index = unprefixed.indexOf('=');
        if (index <= 0) {
          continue;
        }

        const envKey = unprefixed.slice(0, index).trim();
        if (envKey !== key) {
          continue;
        }

        const envValue = unprefixed.slice(index + 1).trim();
        if (!envValue) {
          return null;
        }

        const quoteChar = envValue[0];
        if ((quoteChar === '"' || quoteChar === "'") && envValue.endsWith(quoteChar)) {
          return envValue.slice(1, -1).trim() || null;
        }

        return envValue.replace(/\s+#.*$/, '').trim() || null;
      }
    }

    return null;
  } catch {
    return null;
  }
}

function readDsnFromHubEnv(): string | null {
  return readHubEnvValue(['DSN', 'DATABASE_URL']);
}

function readRedisUrlFromHubEnv(): string | null {
  return readHubEnvValue(['REDIS_URL']);
}

function readRedisTlsRejectUnauthorizedFromHubEnv(): string | null {
  return readHubEnvValue(['REDIS_TLS_REJECT_UNAUTHORIZED']);
}

function resolveDsn(): string {
  const dsn =
    process.env.MONITOR_DSN || process.env.DSN || process.env.DATABASE_URL || readDsnFromHubEnv();

  if (!dsn) {
    throw new Error(
      '数据库连接串未配置，请设置 MONITOR_DSN（或 DSN / DATABASE_URL），也可确保 ../claude-code-hub/.env 含 DSN。',
    );
  }

  return dsn;
}

function resolveRedisUrl(): string | null {
  return parseString(process.env.MONITOR_REDIS_URL) ?? parseString(process.env.REDIS_URL) ?? readRedisUrlFromHubEnv();
}

function resolveRedisTlsRejectUnauthorized(): boolean {
  const envValue =
    process.env.MONITOR_REDIS_TLS_REJECT_UNAUTHORIZED ??
    process.env.REDIS_TLS_REJECT_UNAUTHORIZED ??
    readRedisTlsRejectUnauthorizedFromHubEnv() ??
    undefined;

  return parseBoolean(envValue, true);
}

export function getConfig(): MonitorConfig {
  const sys = getSystemSettings();
  const logLevel = parseLogLevel(process.env.MONITOR_LOG_LEVEL);
  return {
    dsn: resolveDsn(),
    schema: process.env.MONITOR_PROVIDER_SCHEMA || 'public',
    table: process.env.MONITOR_PROVIDER_TABLE || 'providers',
    includeDisabled: sys.includeDisabled,
    requestTimeoutMs: sys.requestTimeoutMs,
    cacheTtlMs: parseNumber(process.env.MONITOR_CACHE_TTL_MS, 60000),
    concurrency: sys.concurrency,
    redisUrl: resolveRedisUrl(),
    redisTlsRejectUnauthorized: resolveRedisTlsRejectUnauthorized(),
    resultCacheTtlSec: Math.max(60, parseNumber(process.env.MONITOR_RESULT_CACHE_TTL_SEC, 604800)),
    logLevel,
    debugHttp: parseBoolean(process.env.MONITOR_DEBUG_HTTP, false) || logLevel === 'debug',
  };
}
