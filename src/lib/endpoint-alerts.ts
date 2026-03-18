import 'server-only';

import Redis from 'ioredis';
import { getConfig } from '@/lib/config';
import { getSystemSettingValue, setSystemSettingValue } from '@/lib/system-settings';
import type { QuotaResult, QuotaStatus } from '@/lib/quota/types';

export type EndpointAlertType = 'credential' | 'parse_error' | 'network_error';
export type EndpointAlertMuteScope = 'today' | 'permanent';

export type EndpointAlertItem = {
  endpointId: number;
  endpointName: string;
  alertType: EndpointAlertType;
  alertLabel: string;
  status: QuotaStatus;
  severity: 'critical' | 'warning';
  title: string;
  detail: string;
  fingerprint: string;
  checkedAt: string | null;
  consecutiveNetworkErrorCount: number | null;
};

export type EndpointAlertMuteRule = {
  endpointId: number;
  endpointName: string | null;
  alertType: EndpointAlertType;
  scope: EndpointAlertMuteScope;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type EndpointAlertRuntimeState = {
  acknowledgedFingerprints: Partial<Record<EndpointAlertType, string>>;
  consecutiveNetworkErrorCount: number;
  credentialCycleStartedAt: string | null;
  parseErrorCycleStartedAt: string | null;
  networkErrorCycleStartedAt: string | null;
};

type QuotaRecordLike = {
  endpointId: number;
  endpointName: string;
  isEnabled: boolean;
  vendorId: number | null;
  vendorType: string | null;
  result: QuotaResult;
};

const DEFAULT_RUNTIME_STATE: EndpointAlertRuntimeState = {
  acknowledgedFingerprints: {},
  consecutiveNetworkErrorCount: 0,
  credentialCycleStartedAt: null,
  parseErrorCycleStartedAt: null,
  networkErrorCycleStartedAt: null,
};

const ENDPOINT_ALERT_MUTE_RULES_KEY = 'endpoint_alert_mute_rules';
const RUNTIME_STATE_MEMORY = new Map<number, EndpointAlertRuntimeState>();
let redisClient: Redis | null = null;
let redisDisabledUntil = 0;

function runtimeKeyFor(endpointId: number): string {
  return `quota-monitor:endpoint-alert-state:${endpointId}`;
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
    const useTls = redisUrl.toLowerCase().startsWith('rediss://');
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

function normalizeRuntimeState(value: unknown): EndpointAlertRuntimeState {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_RUNTIME_STATE };
  }

  const raw = value as Record<string, unknown>;
  const acknowledgedFingerprints: Partial<Record<EndpointAlertType, string>> = {};
  const rawAck = raw.acknowledgedFingerprints;
  if (rawAck && typeof rawAck === 'object' && !Array.isArray(rawAck)) {
    for (const alertType of ['credential', 'parse_error', 'network_error'] as const) {
      const next = (rawAck as Record<string, unknown>)[alertType];
      if (typeof next === 'string' && next.trim()) {
        acknowledgedFingerprints[alertType] = next.trim();
      }
    }
  }

  const count = Number(raw.consecutiveNetworkErrorCount);
  return {
    acknowledgedFingerprints,
    consecutiveNetworkErrorCount: Number.isInteger(count) && count > 0 ? count : 0,
    credentialCycleStartedAt:
      typeof raw.credentialCycleStartedAt === 'string' && raw.credentialCycleStartedAt.trim()
        ? raw.credentialCycleStartedAt.trim()
        : null,
    parseErrorCycleStartedAt:
      typeof raw.parseErrorCycleStartedAt === 'string' && raw.parseErrorCycleStartedAt.trim()
        ? raw.parseErrorCycleStartedAt.trim()
        : null,
    networkErrorCycleStartedAt:
      typeof raw.networkErrorCycleStartedAt === 'string' && raw.networkErrorCycleStartedAt.trim()
        ? raw.networkErrorCycleStartedAt.trim()
        : null,
  };
}

function serializeRuntimeState(state: EndpointAlertRuntimeState): string {
  return JSON.stringify(state);
}

async function getRuntimeState(endpointId: number): Promise<EndpointAlertRuntimeState> {
  if (!Number.isInteger(endpointId) || endpointId <= 0) {
    return { ...DEFAULT_RUNTIME_STATE };
  }

  const redisValue = await withRedis((redis) => redis.get(runtimeKeyFor(endpointId)));
  if (typeof redisValue === 'string') {
    try {
      return normalizeRuntimeState(JSON.parse(redisValue));
    } catch {
      return { ...DEFAULT_RUNTIME_STATE };
    }
  }

  return normalizeRuntimeState(RUNTIME_STATE_MEMORY.get(endpointId));
}

async function setRuntimeState(endpointId: number, state: EndpointAlertRuntimeState): Promise<void> {
  if (!Number.isInteger(endpointId) || endpointId <= 0) {
    return;
  }

  const serialized = serializeRuntimeState(state);
  const saved = await withRedis(async (redis) => {
    await redis.set(runtimeKeyFor(endpointId), serialized, 'EX', getConfig().resultCacheTtlSec);
    return true;
  });

  RUNTIME_STATE_MEMORY.set(endpointId, normalizeRuntimeState(state));
  if (saved === null) {
    return;
  }
}

export async function getEndpointAlertRuntimeStates(
  endpointIds: number[],
): Promise<Map<number, EndpointAlertRuntimeState>> {
  const validIds = Array.from(new Set(endpointIds.filter((id) => Number.isInteger(id) && id > 0)));
  const result = new Map<number, EndpointAlertRuntimeState>();
  if (validIds.length === 0) {
    return result;
  }

  const redisValues = await withRedis((redis) => redis.mget(validIds.map((id) => runtimeKeyFor(id))));
  if (Array.isArray(redisValues)) {
    for (let index = 0; index < validIds.length; index += 1) {
      const value = redisValues[index];
      if (typeof value !== 'string' || !value.trim()) {
        continue;
      }
      try {
        result.set(validIds[index], normalizeRuntimeState(JSON.parse(value)));
      } catch {
        result.set(validIds[index], { ...DEFAULT_RUNTIME_STATE });
      }
    }
  }

  for (const endpointId of validIds) {
    if (result.has(endpointId)) {
      continue;
    }
    result.set(endpointId, normalizeRuntimeState(RUNTIME_STATE_MEMORY.get(endpointId)));
  }

  return result;
}

function clearAcknowledgedFingerprint(
  acknowledgedFingerprints: Partial<Record<EndpointAlertType, string>>,
  alertType: EndpointAlertType,
): Partial<Record<EndpointAlertType, string>> {
  if (!acknowledgedFingerprints[alertType]) {
    return acknowledgedFingerprints;
  }
  const next = { ...acknowledgedFingerprints };
  delete next[alertType];
  return next;
}

export async function recordEndpointAlertRefresh(
  endpointId: number,
  previousResult: QuotaResult | null,
  currentResult: QuotaResult,
): Promise<void> {
  if (!Number.isInteger(endpointId) || endpointId <= 0) {
    return;
  }

  const previousStatus = previousResult?.status ?? null;
  const currentStatus = currentResult.status;
  const previousState = await getRuntimeState(endpointId);
  const nowIso = new Date().toISOString();

  let acknowledgedFingerprints = { ...previousState.acknowledgedFingerprints };

  const credentialCycleStartedAt =
    currentStatus === 'unauthorized'
      ? previousStatus === 'unauthorized'
        ? previousState.credentialCycleStartedAt ?? currentResult.checkedAt ?? nowIso
        : currentResult.checkedAt ?? nowIso
      : null;
  if (currentStatus !== 'unauthorized') {
    acknowledgedFingerprints = clearAcknowledgedFingerprint(acknowledgedFingerprints, 'credential');
  }

  const parseErrorCycleStartedAt =
    currentStatus === 'parse_error'
      ? previousStatus === 'parse_error'
        ? previousState.parseErrorCycleStartedAt ?? currentResult.checkedAt ?? nowIso
        : currentResult.checkedAt ?? nowIso
      : null;
  if (currentStatus !== 'parse_error') {
    acknowledgedFingerprints = clearAcknowledgedFingerprint(acknowledgedFingerprints, 'parse_error');
  }

  const consecutiveNetworkErrorCount =
    currentStatus === 'network_error'
      ? previousStatus === 'network_error'
        ? Math.max(1, previousState.consecutiveNetworkErrorCount + 1)
        : 1
      : 0;
  const networkErrorCycleStartedAt =
    currentStatus === 'network_error'
      ? previousStatus === 'network_error'
        ? previousState.networkErrorCycleStartedAt ?? currentResult.checkedAt ?? nowIso
        : currentResult.checkedAt ?? nowIso
      : null;
  if (currentStatus !== 'network_error') {
    acknowledgedFingerprints = clearAcknowledgedFingerprint(acknowledgedFingerprints, 'network_error');
  }

  await setRuntimeState(endpointId, {
    acknowledgedFingerprints,
    consecutiveNetworkErrorCount,
    credentialCycleStartedAt,
    parseErrorCycleStartedAt,
    networkErrorCycleStartedAt,
  });
}

function normalizeMuteRule(value: unknown): EndpointAlertMuteRule | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const endpointId = Number(raw.endpointId);
  const alertType = raw.alertType;
  const scope = raw.scope;
  const createdAt = typeof raw.createdAt === 'string' && raw.createdAt.trim() ? raw.createdAt.trim() : null;
  const updatedAt = typeof raw.updatedAt === 'string' && raw.updatedAt.trim() ? raw.updatedAt.trim() : createdAt;
  const endpointName = typeof raw.endpointName === 'string' && raw.endpointName.trim() ? raw.endpointName.trim() : null;
  const expiresAt = typeof raw.expiresAt === 'string' && raw.expiresAt.trim() ? raw.expiresAt.trim() : null;

  if (!Number.isInteger(endpointId) || endpointId <= 0) {
    return null;
  }
  if (alertType !== 'credential' && alertType !== 'parse_error' && alertType !== 'network_error') {
    return null;
  }
  if (scope !== 'today' && scope !== 'permanent') {
    return null;
  }
  if (!createdAt || !updatedAt) {
    return null;
  }
  if (scope === 'today' && !expiresAt) {
    return null;
  }

  return {
    endpointId,
    endpointName,
    alertType,
    scope,
    expiresAt,
    createdAt,
    updatedAt,
  };
}

function isMuteRuleExpired(rule: EndpointAlertMuteRule, now = Date.now()): boolean {
  if (rule.scope !== 'today' || !rule.expiresAt) {
    return false;
  }
  const expiresAtMs = Date.parse(rule.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return true;
  }
  return expiresAtMs <= now;
}

function saveMuteRules(rules: EndpointAlertMuteRule[]): void {
  setSystemSettingValue(ENDPOINT_ALERT_MUTE_RULES_KEY, JSON.stringify(rules));
}

export function listEndpointAlertMuteRules(): EndpointAlertMuteRule[] {
  const raw = getSystemSettingValue(ENDPOINT_ALERT_MUTE_RULES_KEY).value;
  if (!raw) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    saveMuteRules([]);
    return [];
  }

  if (!Array.isArray(parsed)) {
    saveMuteRules([]);
    return [];
  }

  const now = Date.now();
  const deduped = new Map<string, EndpointAlertMuteRule>();
  for (const item of parsed) {
    const normalized = normalizeMuteRule(item);
    if (!normalized || isMuteRuleExpired(normalized, now)) {
      continue;
    }
    deduped.set(`${normalized.endpointId}:${normalized.alertType}`, normalized);
  }

  const rules = Array.from(deduped.values()).sort((left, right) => {
    const endpointCompare = left.endpointId - right.endpointId;
    if (endpointCompare !== 0) {
      return endpointCompare;
    }
    return left.alertType.localeCompare(right.alertType);
  });

  if (rules.length !== parsed.length) {
    saveMuteRules(rules);
  }

  return rules;
}

function endOfTodayLocalIso(): string {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return end.toISOString();
}

export function muteEndpointAlert(
  endpointId: number,
  endpointName: string | null | undefined,
  alertType: EndpointAlertType,
  scope: EndpointAlertMuteScope,
): EndpointAlertMuteRule[] {
  const normalizedEndpointId = Number(endpointId);
  if (!Number.isInteger(normalizedEndpointId) || normalizedEndpointId <= 0) {
    throw new Error('endpointId 非法');
  }

  const nowIso = new Date().toISOString();
  const nextRule: EndpointAlertMuteRule = {
    endpointId: normalizedEndpointId,
    endpointName: typeof endpointName === 'string' && endpointName.trim() ? endpointName.trim() : null,
    alertType,
    scope,
    expiresAt: scope === 'today' ? endOfTodayLocalIso() : null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const rules = listEndpointAlertMuteRules().filter(
    (rule) => !(rule.endpointId === normalizedEndpointId && rule.alertType === alertType),
  );
  rules.push(nextRule);
  saveMuteRules(rules);
  return listEndpointAlertMuteRules();
}

export function unmuteEndpointAlert(
  endpointId: number,
  alertType: EndpointAlertType,
): EndpointAlertMuteRule[] {
  const normalizedEndpointId = Number(endpointId);
  if (!Number.isInteger(normalizedEndpointId) || normalizedEndpointId <= 0) {
    throw new Error('endpointId 非法');
  }

  const rules = listEndpointAlertMuteRules().filter(
    (rule) => !(rule.endpointId === normalizedEndpointId && rule.alertType === alertType),
  );
  saveMuteRules(rules);
  return listEndpointAlertMuteRules();
}

export async function acknowledgeEndpointAlert(
  endpointId: number,
  alertType: EndpointAlertType,
  fingerprint: string,
): Promise<void> {
  const normalizedEndpointId = Number(endpointId);
  const normalizedFingerprint = fingerprint.trim();
  if (!Number.isInteger(normalizedEndpointId) || normalizedEndpointId <= 0) {
    throw new Error('endpointId 非法');
  }
  if (!normalizedFingerprint) {
    throw new Error('fingerprint 不能为空');
  }

  const state = await getRuntimeState(normalizedEndpointId);
  await setRuntimeState(normalizedEndpointId, {
    ...state,
    acknowledgedFingerprints: {
      ...state.acknowledgedFingerprints,
      [alertType]: normalizedFingerprint,
    },
  });
}

function alertTypeLabel(alertType: EndpointAlertType): string {
  if (alertType === 'credential') {
    return '凭据异常';
  }
  if (alertType === 'parse_error') {
    return '解析异常';
  }
  return '网络异常';
}

function normalizeText(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function isConfiguredRecord(record: QuotaRecordLike): boolean {
  const vendorType = normalizeText(record.vendorType);
  return record.isEnabled && Number.isInteger(record.vendorId) && Number(record.vendorId) > 0 && Boolean(vendorType);
}

function buildAlertFingerprint(
  record: QuotaRecordLike,
  state: EndpointAlertRuntimeState,
  alertType: EndpointAlertType,
): string {
  if (alertType === 'credential') {
    return `credential:${state.credentialCycleStartedAt ?? record.result.checkedAt ?? 'unknown'}`;
  }
  if (alertType === 'parse_error') {
    return `parse_error:${state.parseErrorCycleStartedAt ?? record.result.checkedAt ?? 'unknown'}`;
  }
  return `network_error:${state.networkErrorCycleStartedAt ?? record.result.checkedAt ?? 'unknown'}`;
}

function buildAlertItem(
  record: QuotaRecordLike,
  state: EndpointAlertRuntimeState,
  threshold: number,
): EndpointAlertItem | null {
  if (!isConfiguredRecord(record)) {
    return null;
  }

  const { result } = record;
  let alertType: EndpointAlertType | null = null;
  let severity: 'critical' | 'warning' = 'warning';
  let title = '';
  let detail = '';
  let count: number | null = null;

  if (result.status === 'unauthorized') {
    alertType = 'credential';
    severity = 'critical';
    title = result.credentialIssue === 'cookie_expired' ? 'Cookie 已失效' : '凭据鉴权失败';
    detail = result.message?.trim() || '请检查端点凭据配置后重试';
  } else if (result.status === 'parse_error') {
    alertType = 'parse_error';
    title = '响应解析失败';
    detail = result.message?.trim() || '响应结构无法解析，请检查规则或上游返回';
  } else if (result.status === 'network_error') {
    const streak = Math.max(0, state.consecutiveNetworkErrorCount);
    if (streak < threshold) {
      return null;
    }
    alertType = 'network_error';
    count = streak;
    title = `连续 ${streak} 次网络错误`;
    detail = result.message?.trim() || '网络请求连续失败，请检查链路或上游服务';
  } else {
    return null;
  }

  const fingerprint = buildAlertFingerprint(record, state, alertType);
  if (state.acknowledgedFingerprints[alertType] === fingerprint) {
    return null;
  }

  return {
    endpointId: record.endpointId,
    endpointName: record.endpointName,
    alertType,
    alertLabel: alertTypeLabel(alertType),
    status: result.status,
    severity,
    title,
    detail,
    fingerprint,
    checkedAt: result.checkedAt,
    consecutiveNetworkErrorCount: count,
  };
}

function isMuted(alert: EndpointAlertItem, rules: EndpointAlertMuteRule[]): boolean {
  return rules.some((rule) => rule.endpointId === alert.endpointId && rule.alertType === alert.alertType);
}

export function buildEndpointAlertItems(
  records: QuotaRecordLike[],
  runtimeStates: Map<number, EndpointAlertRuntimeState>,
  threshold: number,
  muteRules: EndpointAlertMuteRule[],
): EndpointAlertItem[] {
  return records
    .map((record) => buildAlertItem(record, runtimeStates.get(record.endpointId) ?? DEFAULT_RUNTIME_STATE, threshold))
    .filter((item): item is EndpointAlertItem => Boolean(item))
    .filter((item) => !isMuted(item, muteRules))
    .sort((left, right) => {
      const severityCompare = left.severity === right.severity ? 0 : left.severity === 'critical' ? -1 : 1;
      if (severityCompare !== 0) {
        return severityCompare;
      }
      const checkedLeft = Date.parse(left.checkedAt ?? '') || 0;
      const checkedRight = Date.parse(right.checkedAt ?? '') || 0;
      if (checkedLeft !== checkedRight) {
        return checkedRight - checkedLeft;
      }
      return left.endpointId - right.endpointId;
    });
}
