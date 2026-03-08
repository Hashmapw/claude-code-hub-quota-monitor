import { getConfig } from '@/lib/config';
import { getEndpointById, listEndpoints, type DbEndpointRow } from '@/lib/db';
import {
  getVendorSettingsMap,
  getEndpointSetting,
  getEndpointSettingsMap,
  type VendorSetting,
  type EndpointSetting,
} from '@/lib/vendor-settings';
import {
  buildVendorBalanceHistorySnapshots,
  insertVendorBalanceHistorySnapshots,
  type VendorBalanceHistorySourceScope,
} from '@/lib/vendor-balance-history';
import { getVendorDefinition } from '@/lib/vendor-definitions';
import { queryEndpointQuotaWithDebug, runVendorDailyCheckinWithDebug } from '@/lib/quota/adapters';
import { getCachedResult, getCachedResults, setCachedResult } from '@/lib/quota/cache';
import { getCachedDebugSnapshot, setCachedDebugSnapshot } from '@/lib/quota/debug-cache';
import {
  getCachedVendorResult,
  getCachedVendorResults,
  setCachedVendorResult,
} from '@/lib/quota/vendor-cache';
import type { EndpointIdentity, QuotaQueryOutput, QuotaRecord, QuotaResult } from '@/lib/quota/types';
import { logDebug, logInfo, logQuotaDebugProbes, summarizeQuotaResult } from '@/lib/logger';

export type RefreshProgressEvent = {
  endpointId: number;
  endpointName: string;
  status: QuotaResult['status'];
  withValue: boolean;
  failed: boolean;
};

function buildRefreshContext(
  provider: DbEndpointRow,
  setting: EndpointSetting | null,
  vendorMap: Map<number, VendorSetting>,
  sourceScope: VendorBalanceHistorySourceScope,
) {
  const vendorId = setting?.vendorId ?? null;
  return {
    sourceScope,
    endpointId: provider.id,
    endpointName: provider.name,
    vendorId,
    vendorName: setting?.vendorName ?? (vendorId ? vendorMap.get(vendorId)?.name ?? null : null),
  };
}

function hasAnyQuotaValue(result: QuotaResult): boolean {
  return hasFiniteAmount(result.totalUsd) || hasFiniteAmount(result.usedUsd) || hasFiniteAmount(result.remainingUsd);
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let index = 0;

  async function loop(): Promise<void> {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current]);
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => loop());
  await Promise.all(runners);
  return results;
}

function notCheckedResult(): QuotaResult {
  return {
    status: 'not_checked',
    strategy: 'none',
    totalUsd: null,
    usedUsd: null,
    remainingUsd: null,
    message: '尚未查询，请点击“刷新”',
    checkedAt: null,
    latencyMs: null,
    credentialIssue: null,
  };
}

function hasFiniteAmount(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function readEnvCredential(envVars: Record<string, string> | null | undefined, keys: string[]): string | null {
  if (!envVars || typeof envVars !== 'object') {
    return null;
  }
  const lowered = new Set(keys.map((key) => key.toLowerCase()));
  for (const [key, value] of Object.entries(envVars)) {
    if (!lowered.has(key.trim().toLowerCase())) {
      continue;
    }
    const normalized = normalizeOptionalText(value);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function lockStaleValuesAfterError(current: QuotaResult, previous: QuotaResult | null): QuotaResult {
  if (!previous) {
    return {
      ...current,
      staleLock: null,
    };
  }

  const pickPreviousMetric = (field: 'totalUsd' | 'usedUsd' | 'remainingUsd'): number | null => {
    const direct = previous[field];
    if (hasFiniteAmount(direct)) {
      return direct;
    }
    const locked = previous.staleLock?.[field];
    if (hasFiniteAmount(locked)) {
      return locked;
    }
    return null;
  };

  const staleTotal = !hasFiniteAmount(current.totalUsd) ? pickPreviousMetric('totalUsd') : null;
  const staleUsed = !hasFiniteAmount(current.usedUsd) ? pickPreviousMetric('usedUsd') : null;
  const staleRemaining = !hasFiniteAmount(current.remainingUsd) ? pickPreviousMetric('remainingUsd') : null;
  const previousCheckedAt = (previous.checkedAt ?? previous.staleLock?.previousCheckedAt ?? null);

  if (!hasFiniteAmount(staleTotal) && !hasFiniteAmount(staleUsed) && !hasFiniteAmount(staleRemaining)) {
    return {
      ...current,
      staleLock: null,
    };
  }

  return {
    ...current,
    totalUsd: hasFiniteAmount(current.totalUsd) ? current.totalUsd : null,
    usedUsd: hasFiniteAmount(current.usedUsd) ? current.usedUsd : null,
    remainingUsd: hasFiniteAmount(current.remainingUsd) ? current.remainingUsd : null,
    staleLock: {
      reason: 'refresh_error',
      lockedAt: new Date().toISOString(),
      previousCheckedAt,
      totalUsd: staleTotal,
      usedUsd: staleUsed,
      remainingUsd: staleRemaining,
    },
  };
}

function toBearerAuthHeader(value: string | null | undefined): string {
  const token = (value || '').trim().replace(/^Bearer\s+/i, '').trim();
  return token ? `Bearer ${token}` : '';
}

function resolveTemplateVariablesWithDefaults(
  vendorType: string,
  vendorVars: Record<string, string>,
  endpointVars: Record<string, string>,
): Record<string, string> {
  const resolvedVendorVars: Record<string, string> = { ...vendorVars };
  const resolvedEndpointVars: Record<string, string> = { ...endpointVars };
  const definition = getVendorDefinition(vendorType);
  if (definition && Array.isArray(definition.envVars)) {
    for (const envVar of definition.envVars) {
      if (!envVar.optional) {
        continue;
      }
      const defaultValue = (envVar.defaultValue || '').trim();
      if (!defaultValue) {
        continue;
      }
      const hasVendorValue = Boolean((resolvedVendorVars[envVar.key] || '').trim());
      const hasEndpointValue = Boolean((resolvedEndpointVars[envVar.key] || '').trim());
      if (hasVendorValue || hasEndpointValue) {
        continue;
      }
      resolvedVendorVars[envVar.key] = defaultValue;
      resolvedEndpointVars[envVar.key] = defaultValue;
    }
  }

  return {
    ...resolvedVendorVars,
    ...resolvedEndpointVars,
  };
}

type ResolvedEndpointConfig = {
  vendorType: EndpointIdentity['vendorType'];
  vendorTotalUsd: number | null;
  cookieQueryEnabled: boolean;
  cookieHeaderText: string | null;
  cookieValue: string | null;
  endpointUserId: string | null;
  vendorBalanceUsd: number | null;
  vendorEnvVars: Record<string, string>;
  endpointEnvVars: Record<string, string>;
};

function applyFollowedVendorBalance(
  result: QuotaResult,
  setting: EndpointSetting | null,
  endpointQuota: QuotaResult | null,
): QuotaResult {
  if (!setting?.useVendorBalance) {
    return result;
  }
  if (!endpointQuota || endpointQuota.status !== 'ok' || !hasFiniteAmount(endpointQuota.remainingUsd)) {
    return result;
  }

  const followedRemaining = endpointQuota.remainingUsd;
  return {
    ...result,
    remainingUsd: followedRemaining,
    remainingSource: '跟随服务商余额',
    regionMetrics: result.regionMetrics
      ? { ...result.regionMetrics, endpointRemainingUsd: followedRemaining }
      : result.regionMetrics,
    regionSources: result.regionSources
      ? { ...result.regionSources, endpointRemaining: '跟随服务商余额' }
      : result.regionSources,
    regionFieldPaths: result.regionFieldPaths
      ? { ...result.regionFieldPaths, endpointRemaining: 'vendor.remainingUsd' }
      : result.regionFieldPaths,
  };
}

function resolveEndpointConfig(
  setting: EndpointSetting | null,
  endpointMap?: Map<number, VendorSetting>,
  endpointQuota?: QuotaResult | null,
): ResolvedEndpointConfig {
  const endpoint = setting?.vendorId && endpointMap ? endpointMap.get(setting.vendorId) ?? null : null;

  const vendorType = endpoint?.vendorType ?? setting?.vendorType ?? '';

  const vendorBalanceUsd = endpointQuota?.status === 'ok' ? endpointQuota.remainingUsd ?? null : null;
  const vendorTotalUsd =
    (setting?.useVendorAmount ?? false)
    && endpointQuota?.status === 'ok'
    && hasFiniteAmount(endpointQuota.usedUsd)
    && hasFiniteAmount(endpointQuota.remainingUsd)
      ? endpointQuota.usedUsd + endpointQuota.remainingUsd
      : null;
  const cookieQueryEnabled = false;
  const cookieHeaderText = null;
  const cookieValue = null;
  const vendorEnvVars = endpoint?.envVars ?? {};
  const endpointEnvVars = setting?.envVars ?? {};
  const endpointUserId =
    readEnvCredential(endpointEnvVars, ['userId', 'user_id'])
    ?? readEnvCredential(vendorEnvVars, ['userId', 'user_id']);

  return {
    vendorType,
    vendorTotalUsd,
    cookieQueryEnabled,
    cookieHeaderText,
    cookieValue,
    endpointUserId,
    vendorBalanceUsd,
    vendorEnvVars,
    endpointEnvVars,
  };
}

export function toEndpointIdentity(
  provider: DbEndpointRow,
  setting: EndpointSetting | null,
  endpointMap?: Map<number, VendorSetting>,
  endpointQuota?: QuotaResult | null,
): EndpointIdentity {
  const resolved = resolveEndpointConfig(setting, endpointMap, endpointQuota);
  const templateVariables = resolveTemplateVariablesWithDefaults(
    resolved.vendorType,
    resolved.vendorEnvVars,
    resolved.endpointEnvVars,
  );
  if ((setting?.useVendorAmount ?? false) && hasFiniteAmount(resolved.vendorTotalUsd)) {
    templateVariables.totalAmount = String(resolved.vendorTotalUsd);
  }
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.url,
    apiKey: provider.key,
    isEnabled: provider.isEnabled,
    vendorType: resolved.vendorType,
    vendorTotalUsd: resolved.vendorTotalUsd,
    useVendorAmount: setting?.useVendorAmount ?? false,
    vendorBalanceUsd: resolved.vendorBalanceUsd,
    userId: resolved.endpointUserId,
    authMethod: 'bearer',
    urlKeyName: null,
    cookieQueryEnabled: resolved.cookieQueryEnabled,
    cookieHeaderText: resolved.cookieHeaderText,
    cookieValue: resolved.cookieValue,
    vendorCookieForAcw: readEnvCredential(resolved.vendorEnvVars, ['cookieValue', 'cookie_value', 'cookie']),
    templateVariables,
  };
}

function toRecord(
  provider: DbEndpointRow,
  setting: EndpointSetting | null,
  result: QuotaResult,
  endpointQuota: QuotaResult | null,
  vendorTotalUsdMap?: Map<number, number | null>,
): QuotaRecord {
  const useVendorAmount = setting?.useVendorAmount ?? false;
  const vendorId = setting?.vendorId ?? null;
  const effectiveResult = applyFollowedVendorBalance(result, setting, endpointQuota);
  return {
    endpointId: provider.id,
    endpointName: provider.name,
    endpointUrl: provider.url,
    endpointConsoleUrl: provider.consoleUrl,
    endpointApiKey: provider.key,
    endpointType: provider.providerType,
    endpointVendorId: provider.providerVendorId,
    isEnabled: provider.isEnabled,
    vendorId,
    vendorName: (setting?.useVendorGroup ?? true) ? setting?.vendorName ?? null : null,
    vendorType: setting?.vendorType ?? '',
    billingMode: setting?.billingMode ?? 'usage',
    useVendorGroup: setting?.useVendorGroup ?? true,
    useVendorUsed: setting?.useVendorUsed ?? true,
    useVendorRemaining: setting?.useVendorRemaining ?? true,
    useVendorAmount: setting?.useVendorAmount ?? false,
    useVendorBalance: setting?.useVendorBalance ?? false,
    endpointEnvVars: setting?.envVars ?? {},
    isHidden: setting?.isHidden ?? false,
    vendorBalanceUsd: endpointQuota?.remainingUsd ?? null,
    vendorTotalUsd: useVendorAmount && vendorId !== null
      ? vendorTotalUsdMap?.get(vendorId) ?? null
      : null,
    vendorBalanceCheckedAt: endpointQuota?.checkedAt ?? null,
    vendorBalanceStrategy: endpointQuota?.strategy ?? null,
    result: effectiveResult,
  };
}


function isSameQuotaResult(left: QuotaResult, right: QuotaResult): boolean {
  const leftStale = left.staleLock ?? null;
  const rightStale = right.staleLock ?? null;
  return (
    left.status === right.status &&
    left.strategy === right.strategy &&
    left.totalUsd === right.totalUsd &&
    left.usedUsd === right.usedUsd &&
    left.remainingUsd === right.remainingUsd &&
    (left.usedSource ?? null) === (right.usedSource ?? null) &&
    (left.remainingSource ?? null) === (right.remainingSource ?? null) &&
    (left.message ?? null) === (right.message ?? null) &&
    left.latencyMs === right.latencyMs &&
    JSON.stringify(leftStale) === JSON.stringify(rightStale) &&
    (left.credentialIssue ?? null) === (right.credentialIssue ?? null)
  );
}

function dedupeDebugProbes(probes: QuotaQueryOutput['debugProbes']): QuotaQueryOutput['debugProbes'] {
  const map = new Map<string, QuotaQueryOutput['debugProbes'][number]>();
  for (const probe of probes) {
    map.set(`${probe.strategy}|${probe.path}`, probe);
  }
  return Array.from(map.values());
}

async function cacheQueryOutput(endpointId: number, output: QuotaQueryOutput): Promise<void> {
  await setCachedResult(endpointId, output.result);
  const previousSnapshot = await getCachedDebugSnapshot(endpointId);
  const previousDailyCheckinProbes = (previousSnapshot?.probes ?? []).filter(
    (probe) => probe.purpose === 'daily_checkin',
  );
  await setCachedDebugSnapshot({
    endpointId,
    generatedAt: new Date().toISOString(),
    resultStatus: output.result.status,
    resultStrategy: output.result.strategy,
    resultMessage: output.result.message ?? null,
    resultTotalUsd: output.result.totalUsd ?? null,
    resultUsedUsd: output.result.usedUsd ?? null,
    resultRemainingUsd: output.result.remainingUsd ?? null,
    resultStaleLock: output.result.staleLock ?? null,
    resultTokenUsed: output.result.tokenUsed ?? null,
    resultTokenAvailable: output.result.tokenAvailable ?? null,
    resultLastCreditReset: output.result.lastCreditReset ?? null,
    resultTotalSource: output.result.totalSource ?? null,
    resultUsedSource: output.result.usedSource ?? null,
    resultRemainingSource: output.result.remainingSource ?? null,
    resultRegionMetrics: output.result.regionMetrics ?? null,
    resultRegionSources: {
      ...(previousSnapshot?.resultRegionSources ?? {}),
      ...(output.result.regionSources ?? {}),
    },
    resultRegionFieldPaths: {
      ...(previousSnapshot?.resultRegionFieldPaths ?? {}),
      ...(output.result.regionFieldPaths ?? {}),
      aggregationMode: output.result.regionFieldPaths?.aggregationMode ?? previousSnapshot?.resultRegionFieldPaths?.aggregationMode ?? null,
      endpointTotalMode: output.result.regionFieldPaths?.endpointTotalMode ?? previousSnapshot?.resultRegionFieldPaths?.endpointTotalMode ?? null,
    },
    resultDailyCheckinDate: previousSnapshot?.resultDailyCheckinDate ?? null,
    resultDailyCheckinAwarded: previousSnapshot?.resultDailyCheckinAwarded ?? null,
    resultDailyCheckinSource: previousSnapshot?.resultDailyCheckinSource ?? null,
    resultDailyCheckinStatus: previousSnapshot?.resultDailyCheckinStatus ?? null,
    resultDailyCheckinMessage: previousSnapshot?.resultDailyCheckinMessage ?? null,
    probes: dedupeDebugProbes([...previousDailyCheckinProbes, ...output.debugProbes]),
  });
}

function buildEndpointProbeIdentity(provider: DbEndpointRow, endpoint: VendorSetting): EndpointIdentity {
  const envVarMap = endpoint.envVars ?? {};
  const accessToken = readEnvCredential(envVarMap, ['AccessToken', 'access_token', 'apiKeyToken', 'api_key_token']);
  const cookieValue = readEnvCredential(envVarMap, ['cookieValue', 'cookie_value', 'cookie']);
  const cookieHeaderText = readEnvCredential(envVarMap, ['cookieHeaderText', 'cookie_header_text']);
  const userId = readEnvCredential(envVarMap, ['userId', 'user_id']);
  const useAccessToken = Boolean(accessToken);
  const templateVariables = resolveTemplateVariablesWithDefaults(endpoint.vendorType ?? '', endpoint.envVars ?? {}, {});
  return {
    id: provider.id,
    name: `${provider.name}-endpoint-${endpoint.id}`,
    baseUrl: provider.url,
    apiKey: provider.key,
    isEnabled: provider.isEnabled,
    vendorType: endpoint.vendorType ?? '',
    vendorTotalUsd: null,
    useVendorAmount: false,
    vendorBalanceUsd: null,
    authMethod: 'bearer',
    urlKeyName: null,
    cookieQueryEnabled: Boolean(cookieValue) || useAccessToken,
    cookieHeaderText: useAccessToken
      ? JSON.stringify({ Authorization: toBearerAuthHeader(accessToken) })
      : cookieHeaderText,
    cookieValue: useAccessToken ? 'x' : cookieValue,
    userId,
    templateVariables,
  };
}

function isVendorAggregatedFromEndpoints(vendorType: string | null | undefined): boolean {
  const normalized = (vendorType || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  const definition = getVendorDefinition(normalized);
  if (!definition) {
    return false;
  }
  const vendorRemainingMode = definition.regionConfig.aggregation?.vendor_remaining ?? 'independent_request';
  const vendorUsedMode = definition.regionConfig.aggregation?.vendor_used ?? 'endpoint_sum';
  return vendorRemainingMode === 'endpoint_sum' && vendorUsedMode === 'endpoint_sum';
}

type VendorEndpointRef = {
  endpointId: number;
  includeUsed: boolean;
  includeRemaining: boolean;
};

function extractEndpointUsedForVendorTotal(result: QuotaResult | null | undefined): number | null {
  if (!result) {
    return null;
  }
  if (result.status === 'ok') {
    const value = result.regionMetrics?.endpointUsedUsd ?? result.usedUsd;
    if (hasFiniteAmount(value)) {
      return value;
    }
  }
  const stale = result.staleLock?.usedUsd;
  return hasFiniteAmount(stale) ? stale : null;
}

function extractEndpointRemainingForVendorTotal(result: QuotaResult | null | undefined): number | null {
  if (!result) {
    return null;
  }
  if (result.status === 'ok') {
    const value = result.regionMetrics?.endpointRemainingUsd ?? result.remainingUsd;
    if (hasFiniteAmount(value)) {
      return value;
    }
  }
  const stale = result.staleLock?.remainingUsd;
  return hasFiniteAmount(stale) ? stale : null;
}

function extractVendorUsedFromVendorCache(result: QuotaResult | null | undefined): number | null {
  if (!result) {
    return null;
  }
  if (result.status === 'ok') {
    const value = result.regionMetrics?.vendorUsedUsd ?? result.usedUsd;
    if (hasFiniteAmount(value)) {
      return value;
    }
  }
  const stale = result.staleLock?.usedUsd;
  return hasFiniteAmount(stale) ? stale : null;
}

function extractVendorRemainingFromVendorCache(result: QuotaResult | null | undefined): number | null {
  if (!result) {
    return null;
  }
  if (result.status === 'ok') {
    const value = result.regionMetrics?.vendorRemainingUsd ?? result.remainingUsd;
    if (hasFiniteAmount(value)) {
      return value;
    }
  }
  const stale = result.staleLock?.remainingUsd;
  return hasFiniteAmount(stale) ? stale : null;
}

function sumEndpointMetric(
  refs: VendorEndpointRef[],
  endpointCachedMap: Map<number, QuotaResult>,
  metric: 'used' | 'remaining',
): number | null {
  let sum = 0;
  let hasValue = false;
  for (const ref of refs) {
    const include = metric === 'used' ? ref.includeUsed : ref.includeRemaining;
    if (!include) {
      continue;
    }
    const result = endpointCachedMap.get(ref.endpointId) ?? null;
    const value =
      metric === 'used'
        ? extractEndpointUsedForVendorTotal(result)
        : extractEndpointRemainingForVendorTotal(result);
    if (!hasFiniteAmount(value)) {
      continue;
    }
    sum += value;
    hasValue = true;
  }
  return hasValue ? sum : null;
}

function computeVendorTotalUsdMap(
  settingsMap: Map<number, EndpointSetting>,
  vendorMap: Map<number, VendorSetting>,
  endpointCachedMap: Map<number, QuotaResult>,
  vendorCachedMap: Map<number, QuotaResult>,
): Map<number, number | null> {
  const refsByVendor = new Map<number, VendorEndpointRef[]>();
  for (const [endpointId, setting] of settingsMap) {
    if (!setting.vendorId || setting.vendorId <= 0) {
      continue;
    }
    const list = refsByVendor.get(setting.vendorId) ?? [];
    list.push({
      endpointId,
      includeUsed: setting.useVendorUsed ?? true,
      includeRemaining: setting.useVendorRemaining ?? true,
    });
    refsByVendor.set(setting.vendorId, list);
  }

  const totals = new Map<number, number | null>();
  for (const [vendorId, refs] of refsByVendor) {
    const vendor = vendorMap.get(vendorId);
    const aggregated = isVendorAggregatedFromEndpoints(vendor?.vendorType ?? null);
    const vendorCached = vendorCachedMap.get(vendorId) ?? null;

    const aggregatedUsed = sumEndpointMetric(refs, endpointCachedMap, 'used');
    const aggregatedRemaining = sumEndpointMetric(refs, endpointCachedMap, 'remaining');
    const vendorUsed = extractVendorUsedFromVendorCache(vendorCached);
    const vendorRemaining = extractVendorRemainingFromVendorCache(vendorCached);

    const used = aggregated ? aggregatedUsed : (vendorUsed ?? aggregatedUsed);
    const remaining = aggregated ? aggregatedRemaining : (vendorRemaining ?? aggregatedRemaining);

    totals.set(
      vendorId,
      hasFiniteAmount(used) && hasFiniteAmount(remaining) ? used + remaining : null,
    );
  }

  return totals;
}

async function resolveEndpointQuotaOutput(
  provider: DbEndpointRow,
  setting: EndpointSetting | null,
  endpointMap: Map<number, VendorSetting>,
  sharedPromises?: Map<number, Promise<QuotaQueryOutput | null>>,
  probeOwnerEndpointIds?: Set<number>,
  vendorProviders?: DbEndpointRow[],
): Promise<QuotaQueryOutput | null> {
  const vendorId = setting?.vendorId ?? null;
  if (!vendorId) {
    return null;
  }

  const endpoint = endpointMap.get(vendorId) ?? null;
  if (!endpoint || isVendorAggregatedFromEndpoints(endpoint.vendorType)) {
    return null;
  }

  const candidates = vendorProviders && vendorProviders.length > 0 ? vendorProviders : [provider];

  const load = async (): Promise<QuotaQueryOutput | null> => {
    let lastOutput: QuotaQueryOutput | null = null;
    const allProbes: QuotaQueryOutput['debugProbes'] = [];

    for (const candidate of candidates) {
      try {
        const identity = buildEndpointProbeIdentity(candidate, endpoint);
        const output = await queryEndpointQuotaWithDebug(identity, {
          vendorType: endpoint.vendorType,
          vendorId,
        });
        allProbes.push(...output.debugProbes);

        if (output.result.status === 'ok' || output.result.status === 'unsupported') {
          await setCachedVendorResult(vendorId, output.result);
          return { ...output, debugProbes: allProbes };
        }
        lastOutput = output;
      } catch {
        // continue to next candidate
      }
    }

    if (lastOutput) {
      await setCachedVendorResult(vendorId, lastOutput.result);
      return { ...lastOutput, debugProbes: allProbes };
    }
    return null;
  };

  if (!sharedPromises) {
    probeOwnerEndpointIds?.add(provider.id);
    return load();
  }

  const isOwner = !sharedPromises.has(vendorId);
  if (isOwner) {
    sharedPromises.set(vendorId, load());
    probeOwnerEndpointIds?.add(provider.id);
  }

  return sharedPromises.get(vendorId) ?? null;
}

export function clearQuotaCache(): void {
  // 保留兼容签名。当前缓存写入 redis / 内存，不执行全量清理。
}

export async function getQuotaRecordByEndpointId(endpointId: number): Promise<QuotaRecord | null> {
  const records = await listQuotaRecordsFromCache();
  return records.find((record) => record.endpointId === endpointId) ?? null;
}

function persistVendorBalanceHistory(
  records: QuotaRecord[],
  vendorMap: Map<number, VendorSetting>,
  sourceScope: VendorBalanceHistorySourceScope,
): void {
  const snapshots = buildVendorBalanceHistorySnapshots(records, vendorMap, sourceScope);
  if (snapshots.length === 0) {
    return;
  }
  insertVendorBalanceHistorySnapshots(snapshots);
}

export async function listQuotaRecordsFromCache(): Promise<QuotaRecord[]> {
  const providers = await listEndpoints();
  const settingsMap = getEndpointSettingsMap();
  const endpointMap = getVendorSettingsMap();
  const cached = await getCachedResults(providers.map((provider) => provider.id));

  const vendorIds = Array.from(
    new Set(
      providers
        .map((provider) => settingsMap.get(provider.id)?.vendorId ?? null)
        .filter((value): value is number => Number.isInteger(value) && Number(value) > 0),
    ),
  );
  const endpointCached = await getCachedVendorResults(vendorIds);
  const vendorTotalUsdMap = computeVendorTotalUsdMap(settingsMap, endpointMap, cached, endpointCached);

  return providers.map((provider) => {
    const setting = settingsMap.get(provider.id) ?? null;
    const endpointQuota = setting?.vendorId ? endpointCached.get(setting.vendorId) ?? null : null;
    const result = cached.get(provider.id) ?? notCheckedResult();
    return toRecord(provider, setting, result, endpointQuota, vendorTotalUsdMap);
  });
}

export async function refreshEndpointQuota(endpointId: number): Promise<QuotaRecord> {
  const provider = await getEndpointById(endpointId);
  if (!provider) {
    throw new Error(`未找到端点: ${endpointId}`);
  }

  const setting = getEndpointSetting(provider.id);
  const endpointMap = getVendorSettingsMap();
  const refreshContext = buildRefreshContext(provider, setting, endpointMap, 'refresh_endpoint');
  logInfo('refresh.endpoint', {
    event: 'start',
    ...refreshContext,
  });
  const previousResult = await getCachedResult(provider.id);

  const endpointOutput = await resolveEndpointQuotaOutput(provider, setting, endpointMap);
  const endpointQuota = endpointOutput?.result ?? (setting?.vendorId ? await getCachedVendorResult(setting.vendorId) : null);

  const identity = toEndpointIdentity(provider, setting, endpointMap, endpointQuota);
  const output = await queryEndpointQuotaWithDebug(identity, {
    vendorType: identity.vendorType,
    vendorId: setting?.vendorId ?? null,
  });

  const mergedOutput: QuotaQueryOutput = {
    result: lockStaleValuesAfterError(output.result, previousResult),
    debugProbes: [...(endpointOutput?.debugProbes ?? []), ...output.debugProbes],
    detectedUserId: output.detectedUserId,
  };

  await cacheQueryOutput(provider.id, mergedOutput);

  if (endpointOutput) {
    logQuotaDebugProbes('refresh.vendor_probe', refreshContext, endpointOutput.debugProbes);
  }
  logQuotaDebugProbes('refresh.endpoint_debug', refreshContext, output.debugProbes);

  const refreshedRecords = await listQuotaRecordsFromCache();
  const refreshedRecord = refreshedRecords.find((record) => record.endpointId === provider.id) ?? null;
  if (refreshedRecord && !isSameQuotaResult(refreshedRecord.result, mergedOutput.result)) {
    await cacheQueryOutput(provider.id, {
      ...mergedOutput,
      result: refreshedRecord.result,
    });
    persistVendorBalanceHistory([refreshedRecord], endpointMap, 'refresh_endpoint');
    logInfo('refresh.endpoint', {
      event: 'done',
      ...refreshContext,
      ...summarizeQuotaResult(refreshedRecord.result),
    });
    return refreshedRecord;
  }

  const fallbackRecord = refreshedRecord ?? toRecord(provider, setting, mergedOutput.result, endpointQuota);
  persistVendorBalanceHistory([fallbackRecord], endpointMap, 'refresh_endpoint');
  logInfo('refresh.endpoint', {
    event: 'done',
    ...refreshContext,
    ...summarizeQuotaResult(fallbackRecord.result),
  });
  return fallbackRecord;
}

async function refreshProvidersWithContext(
  providers: DbEndpointRow[],
  settingsMap: Map<number, EndpointSetting>,
  endpointMap: Map<number, VendorSetting>,
  sourceScope: VendorBalanceHistorySourceScope,
  onProgress?: (event: RefreshProgressEvent) => void | Promise<void>,
): Promise<QuotaRecord[]> {
  const config = getConfig();
  const previousResults = await getCachedResults(providers.map((provider) => provider.id));
  const endpointProbePromises = new Map<number, Promise<QuotaQueryOutput | null>>();
  const probeOwnerEndpointIds = new Set<number>();

  const vendorProvidersMap = new Map<number, DbEndpointRow[]>();
  for (const p of providers) {
    const vid = settingsMap.get(p.id)?.vendorId ?? null;
    if (vid) {
      const list = vendorProvidersMap.get(vid) ?? [];
      list.push(p);
      vendorProvidersMap.set(vid, list);
    }
  }

  await runWithConcurrency(providers, config.concurrency, async (provider) => {
    const setting = settingsMap.get(provider.id) ?? null;
    const vendorProviders = setting?.vendorId ? vendorProvidersMap.get(setting.vendorId) : undefined;

    const endpointOutput = await resolveEndpointQuotaOutput(provider, setting, endpointMap, endpointProbePromises, probeOwnerEndpointIds, vendorProviders);
    const endpointQuota = endpointOutput?.result ?? (setting?.vendorId ? await getCachedVendorResult(setting.vendorId) : null);

    const identity = toEndpointIdentity(provider, setting, endpointMap, endpointQuota);
    const output = await queryEndpointQuotaWithDebug(identity, {
      vendorType: identity.vendorType,
      vendorId: setting?.vendorId ?? null,
    });
    const previousResult = previousResults.get(provider.id) ?? null;

    const mergedOutput: QuotaQueryOutput = {
      result: lockStaleValuesAfterError(output.result, previousResult),
      debugProbes: [...(endpointOutput?.debugProbes ?? []), ...output.debugProbes],
      detectedUserId: output.detectedUserId,
    };

    await cacheQueryOutput(provider.id, mergedOutput);

    const refreshContext = buildRefreshContext(provider, setting, endpointMap, sourceScope);
    if (endpointOutput && probeOwnerEndpointIds.has(provider.id)) {
      logQuotaDebugProbes('refresh.vendor_probe', refreshContext, endpointOutput.debugProbes);
    }
    logDebug('refresh.endpoint_debug', {
      event: 'result',
      ...refreshContext,
      ...summarizeQuotaResult(mergedOutput.result),
    });
    logQuotaDebugProbes('refresh.endpoint_debug', refreshContext, output.debugProbes);

    if (onProgress) {
      await onProgress({
        endpointId: provider.id,
        endpointName: provider.name,
        status: mergedOutput.result.status,
        withValue: hasAnyQuotaValue(mergedOutput.result),
        failed: mergedOutput.result.status !== 'ok',
      });
    }
  });

  const records = await listQuotaRecordsFromCache();
  const scope = new Set(providers.map((provider) => provider.id));
  const scopedRecords = records.filter((record) => scope.has(record.endpointId));
  persistVendorBalanceHistory(scopedRecords, endpointMap, sourceScope);
  return scopedRecords;
}

function filterRefreshAllProviders(
  providers: DbEndpointRow[],
  settingsMap: Map<number, EndpointSetting>,
): DbEndpointRow[] {
  return providers.filter((provider) => !(settingsMap.get(provider.id)?.isHidden ?? false));
}

export async function refreshAllEndpoints(
  sourceScope: VendorBalanceHistorySourceScope = 'manual_refresh_all',
): Promise<QuotaRecord[]> {
  const providers = await listEndpoints();
  const settingsMap = getEndpointSettingsMap();
  const endpointMap = getVendorSettingsMap();
  const visibleProviders = filterRefreshAllProviders(providers, settingsMap);
  return refreshProvidersWithContext(visibleProviders, settingsMap, endpointMap, sourceScope);
}

export async function refreshAllEndpointsWithProgress(
  onProgress: (event: RefreshProgressEvent) => void | Promise<void>,
  sourceScope: VendorBalanceHistorySourceScope = 'manual_refresh_all',
): Promise<QuotaRecord[]> {
  const providers = await listEndpoints();
  const settingsMap = getEndpointSettingsMap();
  const endpointMap = getVendorSettingsMap();
  const visibleProviders = filterRefreshAllProviders(providers, settingsMap);
  return refreshProvidersWithContext(visibleProviders, settingsMap, endpointMap, sourceScope, onProgress);
}

export async function refreshEndpointsByVendor(vendorId: number): Promise<QuotaRecord[]> {
  const normalizedEndpointId = Number(vendorId);
  if (!Number.isInteger(normalizedEndpointId) || normalizedEndpointId <= 0) {
    throw new Error('vendorId 非法');
  }

  const providers = await listEndpoints();
  const settingsMap = getEndpointSettingsMap();
  const endpointMap = getVendorSettingsMap();
  const scopedProviders = providers.filter(
    (provider) => (settingsMap.get(provider.id)?.vendorId ?? null) === normalizedEndpointId,
  );
  return refreshProvidersWithContext(scopedProviders, settingsMap, endpointMap, 'refresh_vendor');
}

export async function runVendorDailyCheckin(vendorId: number): Promise<{
  endpointId: number;
  result: Awaited<ReturnType<typeof runVendorDailyCheckinWithDebug>>;
  records: QuotaRecord[];
}> {
  const normalizedVendorId = Number(vendorId);
  if (!Number.isInteger(normalizedVendorId) || normalizedVendorId <= 0) {
    throw new Error('vendorId 非法');
  }

  const providers = await listEndpoints();
  const settingsMap = getEndpointSettingsMap();
  const endpointMap = getVendorSettingsMap();
  const scopedProviders = providers
    .filter((provider) => (settingsMap.get(provider.id)?.vendorId ?? null) === normalizedVendorId)
    .sort((left, right) => {
      if (left.isEnabled !== right.isEnabled) {
        return left.isEnabled ? -1 : 1;
      }
      return left.id - right.id;
    });
  if (scopedProviders.length === 0) {
    throw new Error('当前服务商下没有可用端点');
  }
  const vendorName =
    scopedProviders
      .map((provider) => settingsMap.get(provider.id)?.vendorName ?? null)
      .find((value) => Boolean(value))
    ?? endpointMap.get(normalizedVendorId)?.name
    ?? null;
  const startedAt = Date.now();
  logInfo('checkin.vendor', {
    event: 'start',
    vendorId: normalizedVendorId,
    vendorName,
    totalCandidates: scopedProviders.length,
  });

  let checkinResult: Awaited<ReturnType<typeof runVendorDailyCheckinWithDebug>> | null = null;
  let lastProvider: DbEndpointRow = scopedProviders[0];
  const allDebugProbes: QuotaQueryOutput['debugProbes'] = [];
  let candidatesTried = 0;

  for (const candidate of scopedProviders) {
    candidatesTried += 1;
    const candidateSetting = settingsMap.get(candidate.id) ?? null;
    const endpointOutput = await resolveEndpointQuotaOutput(candidate, candidateSetting, endpointMap, undefined, undefined, scopedProviders);
    const endpointQuota = endpointOutput?.result ?? (candidateSetting?.vendorId ? await getCachedVendorResult(candidateSetting.vendorId) : null);
    const identity = toEndpointIdentity(candidate, candidateSetting, endpointMap, endpointQuota);
    const result = await runVendorDailyCheckinWithDebug(identity, {
      vendorType: identity.vendorType,
      vendorId: normalizedVendorId,
    });

    allDebugProbes.push(...result.debugProbes);
    checkinResult = result;
    lastProvider = candidate;
    logDebug('checkin.vendor_debug', {
      event: 'candidate_result',
      vendorId: normalizedVendorId,
      vendorName,
      endpointId: candidate.id,
      endpointName: candidate.name,
      status: result.status,
      checkinDate: result.checkinDate,
      quotaAwarded: result.quotaAwarded,
      source: result.source,
      message: result.message,
      candidateIndex: candidatesTried,
      willStop: result.status === 'ok' || result.status === 'unsupported',
    });
    logQuotaDebugProbes(
      'checkin.vendor_debug',
      {
        vendorId: normalizedVendorId,
        vendorName,
        endpointId: candidate.id,
        endpointName: candidate.name,
      },
      result.debugProbes,
    );

    if (result.status === 'ok' || result.status === 'unsupported') {
      break;
    }
  }

  if (!checkinResult) {
    throw new Error('当前服务商下没有可用端点');
  }
  checkinResult = { ...checkinResult, debugProbes: allDebugProbes };

  const previousSnapshot = await getCachedDebugSnapshot(lastProvider.id);
  const cachedQuota = await getCachedResult(lastProvider.id);
  const baseResult = cachedQuota ?? notCheckedResult();
  const previousNonDailyCheckinProbes = (previousSnapshot?.probes ?? []).filter(
    (probe) => probe.purpose !== 'daily_checkin',
  );
  const nextRegionSources = {
    ...(previousSnapshot?.resultRegionSources ?? {}),
    dailyCheckinDate: checkinResult.source ?? null,
    dailyCheckinAwarded: checkinResult.source ?? null,
  };
  const nextRegionFieldPaths = {
    ...(previousSnapshot?.resultRegionFieldPaths ?? {}),
    dailyCheckinDate: checkinResult.fieldPaths.checkinDate,
    dailyCheckinAwarded: checkinResult.fieldPaths.quotaAwarded,
  };
  await setCachedDebugSnapshot({
    endpointId: lastProvider.id,
    generatedAt: new Date().toISOString(),
    resultStatus: previousSnapshot?.resultStatus ?? baseResult.status,
    resultStrategy: previousSnapshot?.resultStrategy ?? baseResult.strategy,
    resultMessage: previousSnapshot?.resultMessage ?? baseResult.message ?? null,
    resultTotalUsd: previousSnapshot?.resultTotalUsd ?? baseResult.totalUsd ?? null,
    resultUsedUsd: previousSnapshot?.resultUsedUsd ?? baseResult.usedUsd ?? null,
    resultRemainingUsd: previousSnapshot?.resultRemainingUsd ?? baseResult.remainingUsd ?? null,
    resultStaleLock: previousSnapshot?.resultStaleLock ?? baseResult.staleLock ?? null,
    resultTokenUsed: previousSnapshot?.resultTokenUsed ?? baseResult.tokenUsed ?? null,
    resultTokenAvailable: previousSnapshot?.resultTokenAvailable ?? baseResult.tokenAvailable ?? null,
    resultLastCreditReset: previousSnapshot?.resultLastCreditReset ?? baseResult.lastCreditReset ?? null,
    resultTotalSource: previousSnapshot?.resultTotalSource ?? baseResult.totalSource ?? null,
    resultUsedSource: previousSnapshot?.resultUsedSource ?? baseResult.usedSource ?? null,
    resultRemainingSource: previousSnapshot?.resultRemainingSource ?? baseResult.remainingSource ?? null,
    resultRegionMetrics: previousSnapshot?.resultRegionMetrics ?? baseResult.regionMetrics ?? null,
    resultRegionSources: nextRegionSources,
    resultRegionFieldPaths: nextRegionFieldPaths,
    resultDailyCheckinDate: checkinResult.checkinDate,
    resultDailyCheckinAwarded: checkinResult.quotaAwarded,
    resultDailyCheckinSource: checkinResult.source ?? null,
    resultDailyCheckinStatus: checkinResult.status,
    resultDailyCheckinMessage: checkinResult.message,
    probes: dedupeDebugProbes([...previousNonDailyCheckinProbes, ...checkinResult.debugProbes]),
  });

  logInfo('checkin.vendor', {
    event: 'done',
    vendorId: normalizedVendorId,
    vendorName,
    endpointId: lastProvider.id,
    endpointName: lastProvider.name,
    status: checkinResult.status,
    checkinDate: checkinResult.checkinDate,
    quotaAwarded: checkinResult.quotaAwarded,
    source: checkinResult.source,
    message: checkinResult.message,
    candidatesTried,
    durationMs: Date.now() - startedAt,
  });

  return {
    endpointId: lastProvider.id,
    result: checkinResult,
    records: await listQuotaRecordsFromCache(),
  };
}

export async function scanAllQuotas(forceRefresh = false): Promise<QuotaRecord[]> {
  if (forceRefresh) {
    return refreshAllEndpoints();
  }
  return listQuotaRecordsFromCache();
}

export async function getCachedQuotaByEndpoint(endpointId: number): Promise<QuotaResult | null> {
  return getCachedResult(endpointId);
}
