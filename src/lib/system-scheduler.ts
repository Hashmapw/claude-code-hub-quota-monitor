import 'server-only';

import { listDailyCheckinEnabledVendors } from '@/lib/daily-checkin';
import { recordDailyCheckinAttempt } from '@/lib/daily-checkin-history';
import { logInfo } from '@/lib/logger';
import { dispatchPushTaskMessage, getEnabledPushTargetsForTask } from '@/lib/push-management';
import { buildBalanceRefreshMessage, buildDailyCheckinSummaryMessage, buildVendorUsageAnomalyAlertMessage } from '@/lib/push/templates';
import { runVendorDailyCheckin, refreshAllEndpoints } from '@/lib/quota/service';
import type { QuotaDebugProbe, QuotaRecord } from '@/lib/quota/types';
import {
  getSystemSettings,
  MIN_AUTO_REFRESH_INTERVAL_MINUTES,
  recordAutoRefreshRun,
  recordDailyCheckinScheduleRun,
} from '@/lib/system-settings';
import { getVendorDailyUsageComparisons } from '@/lib/vendor-balance-history';
import { listVendorSettings } from '@/lib/vendor-settings';
import { formatUsd } from '@/lib/utils';

const SCHEDULER_TICK_INTERVAL_MS = 20 * 1000;
const globalKey = Symbol.for('__system_scheduler_state__');

type SchedulerState = {
  started: boolean;
  timer: NodeJS.Timeout | null;
  autoRefreshRunning: boolean;
  autoRefreshPromise: Promise<ScheduledRefreshSummary> | null;
  autoRefreshStartedAtMs: number | null;
  dailyCheckinRunning: boolean;
  pendingDailyCheckinRun: boolean;
  lastAutoRefreshRunAtMs: number | null;
  firedDailyCheckinSlots: Set<string>;
};

function getState(): SchedulerState {
  const g = globalThis as unknown as Record<symbol, SchedulerState | undefined>;
  if (!g[globalKey]) {
    g[globalKey] = {
      started: false,
      timer: null,
      autoRefreshRunning: false,
      autoRefreshPromise: null,
      autoRefreshStartedAtMs: null,
      dailyCheckinRunning: false,
      pendingDailyCheckinRun: false,
      lastAutoRefreshRunAtMs: null,
      firedDailyCheckinSlots: new Set<string>(),
    };
  }
  return g[globalKey]!;
}

function normalizeMessage(value: string | null | undefined): string | null {
  const text = (value || '').trim();
  return text || null;
}

function extractDailyCheckinRawResponse(probes: QuotaDebugProbe[] | null | undefined): string | null {
  if (!Array.isArray(probes) || probes.length === 0) {
    return null;
  }

  const candidate = [...probes]
    .reverse()
    .find((probe) => probe.purpose === 'daily_checkin')
    ?? [...probes].reverse().find((probe) => (probe.strategy || '').includes('daily_checkin'))
    ?? null;

  if (!candidate) {
    return null;
  }

  const preview = (candidate.preview || '').trim();
  return preview || null;
}

function formatDateKey(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatTimeKey(now: Date): string {
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function parseIsoMs(value: string | null | undefined): number | null {
  const normalized = normalizeMessage(value);
  if (!normalized) return null;
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function pruneOldCheckinSlots(state: SchedulerState, todayKey: string): void {
  for (const key of state.firedDailyCheckinSlots) {
    if (!key.startsWith(`${todayKey} `)) {
      state.firedDailyCheckinSlots.delete(key);
    }
  }
}

type ScheduledDailyCheckinResult = {
  scheduledSlot: string;
  total: number;
  succeeded: number;
  failed: number;
  totalAwardedUsd: number;
  detailRows: Array<{
    vendorName: string;
    detail: string;
  }>;
  startedAt: string;
  finishedAt: string;
};

type ScheduledRefreshSummary = {
  total: number;
  success: number;
  failed: number;
  withValue: number;
  detailRows: Array<{
    vendorName: string;
    detail: string;
  }>;
  startedAt: string;
  finishedAt: string;
  isFailure: boolean;
  failureMessage?: string | null;
};

function summarizeStatus(status: string): string {
  if (status === 'unauthorized') {
    return '鉴权失败';
  }
  if (status === 'network_error') {
    return '网络异常';
  }
  if (status === 'parse_error') {
    return '解析失败';
  }
  if (status === 'unsupported') {
    return '当前服务商未实现签到';
  }
  if (status === 'not_checked') {
    return '未执行';
  }
  return status || '未知错误';
}

function hasFiniteAmount(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function extractRemainingUsd(record: QuotaRecord): number | null {
  if (hasFiniteAmount(record.result.remainingUsd)) {
    return record.result.remainingUsd;
  }
  const staleValue = record.result.staleLock?.remainingUsd;
  return hasFiniteAmount(staleValue) ? staleValue : null;
}

function buildVendorOrderMap(): Map<number, number> {
  const map = new Map<number, number>();
  listVendorSettings().forEach((vendor, index) => {
    map.set(vendor.id, index);
  });
  return map;
}

function compareVendorRows(
  left: { vendorId: number | null; vendorName: string; orderIndex: number },
  right: { vendorId: number | null; vendorName: string; orderIndex: number },
): number {
  const leftHasOrder = Number.isInteger(left.orderIndex) && left.orderIndex >= 0;
  const rightHasOrder = Number.isInteger(right.orderIndex) && right.orderIndex >= 0;
  if (leftHasOrder && rightHasOrder && left.orderIndex !== right.orderIndex) {
    return left.orderIndex - right.orderIndex;
  }
  if (leftHasOrder && !rightHasOrder) {
    return -1;
  }
  if (!leftHasOrder && rightHasOrder) {
    return 1;
  }
  return left.vendorName.localeCompare(right.vendorName, 'zh-CN');
}

function summarizeRefreshRecords(records: QuotaRecord[], startedAtIso: string, finishedAtIso: string): ScheduledRefreshSummary {
  const vendorOrderMap = buildVendorOrderMap();
  const success = records.filter((record) => record.result.status === 'ok').length;
  const grouped = new Map<string, {
    vendorId: number | null;
    vendorName: string;
    orderIndex: number;
    details: string[];
  }>();

  for (const record of records) {
    const vendorId = Number.isInteger(record.vendorId) && Number(record.vendorId) > 0 ? Number(record.vendorId) : null;
    const vendorName = (record.vendorName || '').trim() || record.endpointName;
    const groupKey = vendorId !== null ? `vendor:${vendorId}` : `endpoint:${record.endpointId}`;
    const orderIndex = vendorId !== null ? (vendorOrderMap.get(vendorId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        vendorId,
        vendorName,
        orderIndex,
        details: [],
      });
    }

    const remainingUsd = extractRemainingUsd(record);
    const detail = record.result.status === 'ok'
      ? `${record.endpointName}：${remainingUsd !== null ? `余额 ${formatUsd(remainingUsd)} USD` : '刷新成功，暂无余额值'}`
      : `${record.endpointName}：刷新失败 · ${normalizeMessage(record.result.message) ?? summarizeStatus(record.result.status)}`;
    grouped.get(groupKey)!.details.push(detail);
  }

  return {
    total: records.length,
    success,
    failed: records.length - success,
    withValue: records.filter((record) => (
      hasFiniteAmount(record.result.totalUsd)
      || hasFiniteAmount(record.result.usedUsd)
      || hasFiniteAmount(record.result.remainingUsd)
    )).length,
    detailRows: Array.from(grouped.values())
      .sort(compareVendorRows)
      .map((group) => ({
        vendorName: group.vendorName,
        detail: group.details.join('\n'),
      })),
    startedAt: startedAtIso,
    finishedAt: finishedAtIso,
    isFailure: false,
  };
}

async function runScheduledDailyCheckinPass(scheduledSlot: string): Promise<ScheduledDailyCheckinResult> {
  const vendors = listDailyCheckinEnabledVendors();
  const startedAtMs = Date.now();
  const startedAtIso = new Date(startedAtMs).toISOString();
  let succeeded = 0;
  let failed = 0;
  let totalAwardedUsd = 0;
  const detailRows: Array<{ vendorName: string; detail: string }> = [];
  logInfo('checkin.all', {
    event: 'start',
    trigger: 'scheduled',
    total: vendors.length,
  });
  for (const vendor of vendors) {
    try {
      const output = await runVendorDailyCheckin(vendor.id);
      const message = normalizeMessage(output.result.message);
      const recorded = recordDailyCheckinAttempt({
        vendorId: vendor.id,
        vendorName: vendor.name,
        vendorType: vendor.vendorType,
        requestSucceeded: output.result.status === 'ok',
        status: output.result.status,
        message,
        endpointId: output.endpointId,
        checkinDate: output.result.checkinDate,
        source: output.result.source,
        rawResponseText: extractDailyCheckinRawResponse(output.result.debugProbes),
        awardedUsd: output.result.quotaAwarded,
      });
      if (recorded.effectiveStatus === 'ok') {
        succeeded += 1;
        detailRows.push({
          vendorName: vendor.name,
          detail: recorded.deltaAwardedUsd > 0
            ? `新增 ${formatUsd(recorded.deltaAwardedUsd)} USD`
            : '签到成功',
        });
      } else {
        failed += 1;
        detailRows.push({
          vendorName: vendor.name,
          detail: `签到失败 · ${message ?? summarizeStatus(output.result.status)}`,
        });
      }
      totalAwardedUsd += recorded.deltaAwardedUsd;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordDailyCheckinAttempt({
        vendorId: vendor.id,
        vendorName: vendor.name,
        vendorType: vendor.vendorType,
        requestSucceeded: false,
        status: 'network_error',
        message,
        awardedUsd: null,
      });
      failed += 1;
      detailRows.push({
        vendorName: vendor.name,
        detail: `签到失败 · ${message}`,
      });
    }
  }
  const finishedAtIso = new Date().toISOString();
  logInfo('checkin.all', {
    event: 'done',
    trigger: 'scheduled',
    total: vendors.length,
    success: succeeded,
    failed,
    totalAwardedUsd: Math.round(totalAwardedUsd * 10000) / 10000,
    durationMs: Date.now() - startedAtMs,
  });
  return {
    scheduledSlot,
    total: vendors.length,
    succeeded,
    failed,
    totalAwardedUsd: Math.round(totalAwardedUsd * 10000) / 10000,
    detailRows,
    startedAt: startedAtIso,
    finishedAt: finishedAtIso,
  };
}

async function maybeRunAutoRefresh(state: SchedulerState): Promise<void> {
  const settings = getSystemSettings();
  if (!settings.autoRefreshEnabled) {
    return;
  }
  if (state.autoRefreshPromise) {
    return;
  }

  const intervalMinutes = Math.max(
    MIN_AUTO_REFRESH_INTERVAL_MINUTES,
    settings.autoRefreshIntervalMinutes,
  );
  const intervalMs = intervalMinutes * 60 * 1000;
  const fallbackLastRunMs = parseIsoMs(settings.autoRefreshLastRunAt);
  const lastRunMs = state.lastAutoRefreshRunAtMs ?? fallbackLastRunMs;
  const nowMs = Date.now();

  if (lastRunMs !== null && nowMs - lastRunMs < intervalMs) {
    return;
  }

  const summary = await runRefreshPass(state, 'scheduled');
  if (!summary.isFailure) {
    await maybeDispatchBalanceRefreshAnomalyAlert({
      startedAt: summary.startedAt,
      finishedAt: summary.finishedAt,
    });
  }
}

function runRefreshPass(
  state: SchedulerState,
  trigger: 'scheduled' | 'scheduled_checkin_push',
): Promise<ScheduledRefreshSummary> {
  if (state.autoRefreshPromise) {
    return state.autoRefreshPromise;
  }

  const startedAtMs = Date.now();
  const startedAtIso = new Date(startedAtMs).toISOString();
  state.autoRefreshRunning = true;
  state.autoRefreshStartedAtMs = startedAtMs;
  logInfo('refresh.all', {
    event: 'start',
    trigger,
  });

  const runPromise = (async (): Promise<ScheduledRefreshSummary> => {
    try {
      const records = await refreshAllEndpoints('scheduled_refresh_all');
      const finishedAtIso = new Date().toISOString();
      const summary = summarizeRefreshRecords(records, startedAtIso, finishedAtIso);
      logInfo('refresh.all', {
        event: 'done',
        trigger,
        total: summary.total,
        success: summary.success,
        failed: summary.failed,
        withValue: summary.withValue,
        durationMs: Date.now() - startedAtMs,
      });
      state.lastAutoRefreshRunAtMs = parseIsoMs(finishedAtIso);
      recordAutoRefreshRun(finishedAtIso);
      return summary;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logInfo('refresh.all', {
        event: 'failed',
        trigger,
        durationMs: Date.now() - startedAtMs,
        message,
      });
      return {
        total: 0,
        success: 0,
        failed: 0,
        withValue: 0,
        detailRows: [],
        startedAt: startedAtIso,
        finishedAt: new Date().toISOString(),
        isFailure: true,
        failureMessage: message,
      };
    } finally {
      state.autoRefreshRunning = false;
      state.autoRefreshPromise = null;
      state.autoRefreshStartedAtMs = null;
    }
  })();

  state.autoRefreshPromise = runPromise;
  return runPromise;
}

async function runPostCheckinBalanceRefresh(
  state: SchedulerState,
  checkinFinishedAtMs: number,
): Promise<ScheduledRefreshSummary> {
  while (true) {
    const activePromise = state.autoRefreshPromise;
    const activeStartedAtMs = state.autoRefreshStartedAtMs;
    if (!activePromise) {
      return runRefreshPass(state, 'scheduled_checkin_push');
    }
    if (activeStartedAtMs !== null && activeStartedAtMs >= checkinFinishedAtMs) {
      return activePromise;
    }
    await activePromise;
  }
}

async function maybeDispatchBalanceRefreshAnomalyAlert(input: {
  startedAt: string;
  finishedAt: string;
}): Promise<void> {
  const settings = getSystemSettings();
  if (settings.balanceRefreshAnomalyVendorIds.length === 0) {
    return;
  }
  if (getEnabledPushTargetsForTask('daily_checkin_balance_refresh_anomaly').length === 0) {
    return;
  }

  const comparisons = await getVendorDailyUsageComparisons(settings.balanceRefreshAnomalyVendorIds);
  const anomalies = comparisons.filter((item) => {
    if (item.usedDelta <= item.hubCostUsd) {
      return false;
    }
    if (item.hubCostUsd <= 0) {
      return item.usedDelta > 0;
    }
    return (item.excessPercent ?? 0) > settings.balanceRefreshAnomalyThresholdPercent;
  });

  if (anomalies.length === 0) {
    logInfo('push.anomaly', {
      event: 'skipped',
      reason: 'no_vendor_anomaly',
      vendorCount: settings.balanceRefreshAnomalyVendorIds.length,
      thresholdPercent: settings.balanceRefreshAnomalyThresholdPercent,
    });
    return;
  }

  await dispatchPushTaskMessage(
    'daily_checkin_balance_refresh_anomaly',
    buildVendorUsageAnomalyAlertMessage({
      thresholdPercent: settings.balanceRefreshAnomalyThresholdPercent,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      rows: anomalies.map((item) => ({
        vendorName: item.vendorName,
        usedDeltaUsd: item.usedDelta,
        hubCostUsd: item.hubCostUsd,
        differenceUsd: item.differenceUsd,
        excessPercent: item.excessPercent,
      })),
    }),
  );
  logInfo('push.anomaly', {
    event: 'sent',
    count: anomalies.length,
    thresholdPercent: settings.balanceRefreshAnomalyThresholdPercent,
    vendors: anomalies.map((item) => item.vendorName),
  });
}

async function maybeRunDailyCheckin(state: SchedulerState): Promise<void> {
  const settings = getSystemSettings();
  if (!settings.dailyCheckinScheduleEnabled) {
    return;
  }
  if (settings.dailyCheckinScheduleTimes.length === 0) {
    return;
  }

  const now = new Date();
  const todayKey = formatDateKey(now);
  const currentTimeKey = formatTimeKey(now);
  pruneOldCheckinSlots(state, todayKey);

  if (settings.dailyCheckinScheduleTimes.includes(currentTimeKey)) {
    const slotKey = `${todayKey} ${currentTimeKey}`;
    if (!state.firedDailyCheckinSlots.has(slotKey)) {
      state.firedDailyCheckinSlots.add(slotKey);
      state.pendingDailyCheckinRun = true;
    }
  }

  if (!state.pendingDailyCheckinRun || state.dailyCheckinRunning) {
    return;
  }

  state.pendingDailyCheckinRun = false;
  state.dailyCheckinRunning = true;
  const startedAt = Date.now();
  try {
    const scheduledSlot = `${todayKey} ${currentTimeKey}`;
    const result = await runScheduledDailyCheckinPass(scheduledSlot);
    recordDailyCheckinScheduleRun(result.finishedAt);

    if (result.succeeded > 0) {
      await dispatchPushTaskMessage(
        'daily_checkin_summary',
        buildDailyCheckinSummaryMessage(result),
      );

      if (getEnabledPushTargetsForTask('daily_checkin_balance_refresh').length > 0) {
        const refreshSummary = await runPostCheckinBalanceRefresh(
          state,
          parseIsoMs(result.finishedAt) ?? Date.now(),
        );
        await dispatchPushTaskMessage(
          'daily_checkin_balance_refresh',
          buildBalanceRefreshMessage(refreshSummary),
        );
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logInfo('checkin.all', {
      event: 'failed',
      trigger: 'scheduled',
      durationMs: Date.now() - startedAt,
      message,
    });
    // Ignore scheduler task errors to keep next ticks alive.
  } finally {
    state.dailyCheckinRunning = false;
  }
}

async function runSchedulerTick(): Promise<void> {
  const state = getState();
  await Promise.all([
    maybeRunAutoRefresh(state),
    maybeRunDailyCheckin(state),
  ]);
}

export function ensureSystemSchedulerStarted(): void {
  const state = getState();
  if (state.started) {
    return;
  }
  state.started = true;
  state.timer = setInterval(() => {
    void runSchedulerTick();
  }, SCHEDULER_TICK_INTERVAL_MS);
  void runSchedulerTick();
}
