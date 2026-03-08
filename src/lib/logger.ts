import 'server-only';

import { getConfig, type MonitorLogLevel } from '@/lib/config';
import type { QuotaDebugProbe } from '@/lib/quota/types';

type LogFields = Record<string, unknown>;

const LEVEL_WEIGHT: Record<MonitorLogLevel, number> = {
  info: 1,
  debug: 2,
};

function shouldLog(level: MonitorLogLevel): boolean {
  return LEVEL_WEIGHT[getConfig().logLevel] >= LEVEL_WEIGHT[level];
}

function formatValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (value === undefined) {
    return 'undefined';
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (typeof value === 'string') {
    if (!value) {
      return '""';
    }
    if (/^[A-Za-z0-9_.:/#@%+\-=]+$/.test(value)) {
      return value;
    }
    return JSON.stringify(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify(String(value));
  }
}

function buildLine(scope: string, fields: LogFields): string {
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
  const parts = entries.map(([key, value]) => `${key}=${formatValue(value)}`);
  return `[${scope}]${parts.length > 0 ? ` ${parts.join(' ')}` : ''}`;
}

function write(level: MonitorLogLevel, scope: string, fields: LogFields): void {
  if (!shouldLog(level)) {
    return;
  }

  const line = buildLine(scope, fields);
  if (level === 'debug') {
    // eslint-disable-next-line no-console
    console.debug(line);
    return;
  }

  // eslint-disable-next-line no-console
  console.info(line);
}

export function logInfo(scope: string, fields: LogFields): void {
  write('info', scope, fields);
}

export function logDebug(scope: string, fields: LogFields): void {
  write('debug', scope, fields);
}

export function summarizeQuotaResult(result: {
  status: string;
  totalUsd?: number | null;
  usedUsd?: number | null;
  remainingUsd?: number | null;
  message?: string | null;
  latencyMs?: number | null;
  checkedAt?: string | null;
}): LogFields {
  return {
    status: result.status,
    totalUsd: result.totalUsd ?? null,
    usedUsd: result.usedUsd ?? null,
    remainingUsd: result.remainingUsd ?? null,
    latencyMs: result.latencyMs ?? null,
    checkedAt: result.checkedAt ?? null,
    message: result.message ?? null,
  };
}

export function logQuotaDebugProbes(
  scope: string,
  context: LogFields,
  probes: QuotaDebugProbe[] | null | undefined,
): void {
  if (!shouldLog('debug') || !Array.isArray(probes) || probes.length === 0) {
    return;
  }

  probes.forEach((probe, probeIndex) => {
    if (!probe.attempts || probe.attempts.length === 0) {
      logDebug(scope, {
        ...context,
        event: 'probe',
        probeIndex,
        strategy: probe.strategy,
        purpose: probe.purpose ?? 'other',
        path: probe.path,
        status: probe.status,
        latencyMs: probe.latencyMs,
        contentType: probe.contentType,
        note: probe.note ?? null,
        responseBody: probe.preview || null,
      });
      return;
    }

    probe.attempts.forEach((attempt, attemptIndex) => {
      logDebug(scope, {
        ...context,
        event: 'attempt',
        probeIndex,
        attemptIndex,
        strategy: probe.strategy,
        purpose: probe.purpose ?? 'other',
        path: probe.path,
        method: attempt.method ?? null,
        url: attempt.url,
        status: attempt.status,
        latencyMs: attempt.latencyMs,
        contentType: attempt.contentType,
        requestHeaders: attempt.requestHeaders,
        requestBody: attempt.requestBodyPreview ?? null,
        responseBody: attempt.bodyPreview ?? probe.preview ?? null,
        error: attempt.error ?? null,
        note: probe.note ?? null,
      });
    });
  });
}
