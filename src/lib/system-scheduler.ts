import 'server-only';

import { listDailyCheckinEnabledVendors } from '@/lib/daily-checkin';
import { recordDailyCheckinAttempt } from '@/lib/daily-checkin-history';
import { logInfo } from '@/lib/logger';
import { runVendorDailyCheckin, refreshAllEndpoints } from '@/lib/quota/service';
import type { QuotaDebugProbe } from '@/lib/quota/types';
import {
  getSystemSettings,
  MIN_AUTO_REFRESH_INTERVAL_MINUTES,
  recordAutoRefreshRun,
  recordDailyCheckinScheduleRun,
} from '@/lib/system-settings';

const SCHEDULER_TICK_INTERVAL_MS = 20 * 1000;
const globalKey = Symbol.for('__system_scheduler_state__');

type SchedulerState = {
  started: boolean;
  timer: NodeJS.Timeout | null;
  autoRefreshRunning: boolean;
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

async function runScheduledDailyCheckinPass(): Promise<void> {
  const vendors = listDailyCheckinEnabledVendors();
  const startedAt = Date.now();
  let succeeded = 0;
  let failed = 0;
  let totalAwardedUsd = 0;
  logInfo('checkin.all', {
    event: 'start',
    trigger: 'scheduled',
    total: vendors.length,
  });
  for (const vendor of vendors) {
    try {
      const output = await runVendorDailyCheckin(vendor.id);
      const message = normalizeMessage(output.result.message);
      recordDailyCheckinAttempt({
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
      if (output.result.status === 'ok') {
        succeeded += 1;
      } else {
        failed += 1;
      }
      totalAwardedUsd += typeof output.result.quotaAwarded === 'number' ? output.result.quotaAwarded : 0;
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
    }
  }
  logInfo('checkin.all', {
    event: 'done',
    trigger: 'scheduled',
    total: vendors.length,
    success: succeeded,
    failed,
    totalAwardedUsd: Math.round(totalAwardedUsd * 10000) / 10000,
    durationMs: Date.now() - startedAt,
  });
}

async function maybeRunAutoRefresh(state: SchedulerState): Promise<void> {
  const settings = getSystemSettings();
  if (!settings.autoRefreshEnabled) {
    return;
  }
  if (state.autoRefreshRunning) {
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

  state.autoRefreshRunning = true;
  logInfo('refresh.all', {
    event: 'start',
    trigger: 'scheduled',
  });
  const startedAt = Date.now();
  try {
    const records = await refreshAllEndpoints('scheduled_refresh_all');
    let success = 0;
    let failed = 0;
    for (const record of records) {
      if (record.result.status === 'ok') {
        success += 1;
      } else {
        failed += 1;
      }
    }
    logInfo('refresh.all', {
      event: 'done',
      trigger: 'scheduled',
      total: records.length,
      success,
      failed,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logInfo('refresh.all', {
      event: 'failed',
      trigger: 'scheduled',
      durationMs: Date.now() - startedAt,
      message,
    });
    // Ignore scheduler task errors to keep next ticks alive.
  } finally {
    const finishedAt = new Date().toISOString();
    state.lastAutoRefreshRunAtMs = parseIsoMs(finishedAt);
    recordAutoRefreshRun(finishedAt);
    state.autoRefreshRunning = false;
  }
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
    await runScheduledDailyCheckinPass();
    recordDailyCheckinScheduleRun(new Date().toISOString());
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
