import 'server-only';

import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_SYSTEM_DISPLAY_NAME } from '@/lib/app-identity';
import { listAvailableVendorTypes } from '@/lib/vendor-definitions';
import { getSqliteConnection } from '@/lib/sqlite-connection';

export type VendorTypeDocs = Record<string, string>;

export const MIN_AUTO_REFRESH_INTERVAL_MINUTES = 30;
const DEFAULT_INCLUDE_DISABLED = true;
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const MIN_REQUEST_TIMEOUT_MS = 1000;
const MAX_REQUEST_TIMEOUT_MS = 120000;
const DEFAULT_CONCURRENCY = 6;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 30;
const DEFAULT_BALANCE_REFRESH_ANOMALY_THRESHOLD_PERCENT = 20;
const MIN_BALANCE_REFRESH_ANOMALY_THRESHOLD_PERCENT = 0;
const MAX_BALANCE_REFRESH_ANOMALY_THRESHOLD_PERCENT = 1000;

export type SystemSettings = {
  systemDisplayName: string;
  proxyUrl: string | null;
  vendorTypeDocs: VendorTypeDocs;
  includeDisabled: boolean;
  requestTimeoutMs: number;
  concurrency: number;
  autoRefreshEnabled: boolean;
  autoRefreshIntervalMinutes: number;
  autoRefreshLastRunAt: string | null;
  autoCleanupAfterRefreshEnabled: boolean;
  dailyCheckinScheduleEnabled: boolean;
  dailyCheckinScheduleTimes: string[];
  dailyCheckinLastRunAt: string | null;
  balanceRefreshAnomalyThresholdPercent: number;
  balanceRefreshAnomalyVendorIds: number[];
  updatedAt: string | null;
};

type UpsertSystemSettingsInput = {
  systemDisplayName?: string | null;
  proxyUrl?: string | null;
  vendorTypeDocs?: Record<string, string | null | undefined> | null;
  includeDisabled?: boolean | null;
  requestTimeoutMs?: number | string | null;
  concurrency?: number | string | null;
  autoRefreshEnabled?: boolean | null;
  autoRefreshIntervalMinutes?: number | string | null;
  autoCleanupAfterRefreshEnabled?: boolean | null;
  dailyCheckinScheduleEnabled?: boolean | null;
  dailyCheckinScheduleTimes?: string[] | null;
  balanceRefreshAnomalyThresholdPercent?: number | string | null;
  balanceRefreshAnomalyVendorIds?: number[] | null;
};

const SETTING_KEY_SYSTEM_DISPLAY_NAME = 'system_display_name';
const SETTING_KEY_PROXY_URL = 'proxy_url';
const SETTING_KEY_VENDOR_TYPE_DOCS = 'vendor_type_docs';
const SETTING_KEY_INCLUDE_DISABLED = 'include_disabled';
const SETTING_KEY_REQUEST_TIMEOUT_MS = 'request_timeout_ms';
const SETTING_KEY_CONCURRENCY = 'concurrency';
const SETTING_KEY_AUTO_REFRESH_ENABLED = 'auto_refresh_enabled';
const SETTING_KEY_AUTO_REFRESH_INTERVAL_MINUTES = 'auto_refresh_interval_minutes';
const SETTING_KEY_AUTO_REFRESH_LAST_RUN_AT = 'auto_refresh_last_run_at';
const SETTING_KEY_AUTO_CLEANUP_AFTER_REFRESH_ENABLED = 'auto_cleanup_after_refresh_enabled';
const SETTING_KEY_DAILY_CHECKIN_SCHEDULE_ENABLED = 'daily_checkin_schedule_enabled';
const SETTING_KEY_DAILY_CHECKIN_SCHEDULE_TIMES = 'daily_checkin_schedule_times';
const SETTING_KEY_DAILY_CHECKIN_LAST_RUN_AT = 'daily_checkin_last_run_at';
const SETTING_KEY_BALANCE_REFRESH_ANOMALY_THRESHOLD_PERCENT = 'balance_refresh_anomaly_threshold_percent';
const SETTING_KEY_BALANCE_REFRESH_ANOMALY_VENDOR_IDS = 'balance_refresh_anomaly_vendor_ids';
const TIME_POINT_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

let dbInstance: DatabaseSync | null = null;

function db(): DatabaseSync {
  if (dbInstance) {
    return dbInstance;
  }

  dbInstance = getSqliteConnection();
  dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return dbInstance;
}

function normalizeText(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeProxyUrl(value: string | null | undefined): string | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  let candidate = normalized;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate)) {
    candidate = `http://${candidate}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('代理地址格式不正确，请填写如 http://127.0.0.1:7890');
  }

  const allowedProtocols = new Set(['http:', 'https:', 'socks:', 'socks5:', 'socks5h:']);
  if (!allowedProtocols.has(parsed.protocol)) {
    throw new Error('代理地址协议仅支持 http/https/socks/socks5/socks5h');
  }

  return parsed.toString();
}

function normalizeSystemDisplayName(value: string | null | undefined): string {
  return normalizeText(value) ?? DEFAULT_SYSTEM_DISPLAY_NAME;
}

function parseBooleanSetting(value: string | null, fallback: boolean): boolean {
  const normalized = normalizeText(value)?.toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return fallback;
}

function normalizeBooleanInput(
  value: boolean | null | undefined,
  fallback: boolean,
): boolean {
  if (value === undefined) {
    return fallback;
  }
  return value === true;
}

function parseRequestTimeoutMs(value: string | null): number {
  const parsed = Number(normalizeText(value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }
  return Math.max(MIN_REQUEST_TIMEOUT_MS, Math.min(MAX_REQUEST_TIMEOUT_MS, Math.trunc(parsed)));
}

function normalizeRequestTimeoutMsInput(
  value: number | string | null | undefined,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`请求超时必须在 ${MIN_REQUEST_TIMEOUT_MS}–${MAX_REQUEST_TIMEOUT_MS} 毫秒之间`);
  }
  return Math.max(MIN_REQUEST_TIMEOUT_MS, Math.min(MAX_REQUEST_TIMEOUT_MS, Math.trunc(parsed)));
}

function parseConcurrency(value: string | null): number {
  const parsed = Number(normalizeText(value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_CONCURRENCY;
  }
  return Math.max(MIN_CONCURRENCY, Math.min(MAX_CONCURRENCY, Math.trunc(parsed)));
}

function normalizeConcurrencyInput(
  value: number | string | null | undefined,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`并发数必须在 ${MIN_CONCURRENCY}–${MAX_CONCURRENCY} 之间`);
  }
  return Math.max(MIN_CONCURRENCY, Math.min(MAX_CONCURRENCY, Math.trunc(parsed)));
}

function parseAutoRefreshIntervalMinutes(value: string | null): number {
  const parsed = Number(normalizeText(value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return MIN_AUTO_REFRESH_INTERVAL_MINUTES;
  }
  return Math.max(MIN_AUTO_REFRESH_INTERVAL_MINUTES, Math.trunc(parsed));
}

function normalizeAutoRefreshIntervalMinutesInput(
  value: number | string | null | undefined,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('自动刷新间隔必须是正整数分钟');
  }
  return Math.max(MIN_AUTO_REFRESH_INTERVAL_MINUTES, Math.trunc(parsed));
}

function normalizeDailyCheckinScheduleTimes(
  input: unknown,
): string[] {
  if (!Array.isArray(input)) {
    throw new Error('签到时间点必须是数组');
  }
  const deduped = new Set<string>();
  for (let i = 0; i < input.length; i += 1) {
    const raw = input[i];
    if (typeof raw !== 'string') {
      throw new Error(`签到时间点[${i}] 必须是 HH:mm 字符串`);
    }
    const normalized = raw.trim();
    if (!TIME_POINT_PATTERN.test(normalized)) {
      throw new Error(`签到时间点[${i}] 格式非法，必须为 HH:mm`);
    }
    deduped.add(normalized);
  }
  return Array.from(deduped).sort((left, right) => left.localeCompare(right));
}

function parseDailyCheckinScheduleTimes(value: string | null): string[] {
  const normalized = normalizeText(value);
  if (!normalized) {
    return [];
  }
  try {
    return normalizeDailyCheckinScheduleTimes(JSON.parse(normalized) as unknown);
  } catch {
    return [];
  }
}

function parseVendorIdArray(value: string | null): number[] {
  const normalized = normalizeText(value);
  if (!normalized) {
    return [];
  }
  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return Array.from(new Set(
      parsed
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0),
    ));
  } catch {
    return [];
  }
}

function normalizeVendorIdArrayInput(value: number[] | null | undefined, fallback: number[]): number[] {
  if (value === undefined) {
    return fallback;
  }
  if (!Array.isArray(value)) {
    throw new Error('异常提醒服务商必须是数组');
  }
  return Array.from(new Set(
    value
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item > 0),
  ));
}

function parseBalanceRefreshAnomalyThresholdPercent(value: string | null): number {
  const normalized = normalizeText(value);
  if (!normalized) {
    return DEFAULT_BALANCE_REFRESH_ANOMALY_THRESHOLD_PERCENT;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < MIN_BALANCE_REFRESH_ANOMALY_THRESHOLD_PERCENT) {
    return DEFAULT_BALANCE_REFRESH_ANOMALY_THRESHOLD_PERCENT;
  }
  return Math.max(
    MIN_BALANCE_REFRESH_ANOMALY_THRESHOLD_PERCENT,
    Math.min(MAX_BALANCE_REFRESH_ANOMALY_THRESHOLD_PERCENT, Math.round(parsed * 100) / 100),
  );
}

function normalizeBalanceRefreshAnomalyThresholdPercentInput(
  value: number | string | null | undefined,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < MIN_BALANCE_REFRESH_ANOMALY_THRESHOLD_PERCENT) {
    throw new Error(`异常阈值必须在 ${MIN_BALANCE_REFRESH_ANOMALY_THRESHOLD_PERCENT}–${MAX_BALANCE_REFRESH_ANOMALY_THRESHOLD_PERCENT} 之间`);
  }
  return Math.max(
    MIN_BALANCE_REFRESH_ANOMALY_THRESHOLD_PERCENT,
    Math.min(MAX_BALANCE_REFRESH_ANOMALY_THRESHOLD_PERCENT, Math.round(parsed * 100) / 100),
  );
}

export function getSystemSettingValue(key: string): { value: string | null; updatedAt: string | null } {
  const row = db()
    .prepare(
      `
      SELECT value, updated_at
      FROM system_settings
      WHERE key = ?
      LIMIT 1
    `,
    )
    .get(key) as { value: string | null; updated_at: string | null } | undefined;

  if (!row) {
    return {
      value: null,
      updatedAt: null,
    };
  }

  return {
    value: normalizeText(row.value),
    updatedAt: row.updated_at ? String(row.updated_at) : null,
  };
}

export function setSystemSettingValue(key: string, value: string | null): void {
  db()
    .prepare(
      `
      INSERT INTO system_settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key)
      DO UPDATE SET
        value = excluded.value,
        updated_at = datetime('now')
    `,
    )
    .run(key, value);
}

function resolveProxyFromEnv(): string | null {
  const candidates = [
    process.env.MONITOR_PROXY_URL,
    process.env.MONITOR_HTTP_PROXY,
    process.env.HTTPS_PROXY,
    process.env.HTTP_PROXY,
    process.env.ALL_PROXY,
  ];

  for (const value of candidates) {
    if (!value || !value.trim()) {
      continue;
    }

    try {
      return normalizeProxyUrl(value);
    } catch {
      continue;
    }
  }

  return null;
}

function parseVendorTypeDocs(raw: string | null): VendorTypeDocs {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    let vendorTypes: string[];
    try {
      vendorTypes = listAvailableVendorTypes();
    } catch {
      vendorTypes = [];
    }

    const result: VendorTypeDocs = {};
    for (const vendorType of vendorTypes) {
      const value = normalizeText((parsed as Record<string, unknown>)[vendorType] as string | null | undefined);
      if (value) {
        result[vendorType] = value;
      }
    }

    // Also preserve any keys already in the JSON that aren't in vendorTypes
    for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
      if (!result[key]) {
        const value = normalizeText(val as string | null | undefined);
        if (value) {
          result[key] = value;
        }
      }
    }

    return result;
  } catch {
    return {};
  }
}

function normalizeVendorTypeDocs(input: Record<string, string | null | undefined> | null | undefined): VendorTypeDocs {
  if (!input || typeof input !== 'object') {
    return {};
  }

  const result: VendorTypeDocs = {};
  for (const [key, val] of Object.entries(input)) {
    const value = normalizeText(val);
    if (value) {
      result[key] = value;
    }
  }

  return result;
}

function resolveLatestUpdatedAt(...values: Array<string | null>): string | null {
  const candidates = values
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => String(right).localeCompare(String(left)));

  return candidates[0] ?? null;
}

export function getSystemSettings(): SystemSettings {
  const systemDisplayName = getSystemSettingValue(SETTING_KEY_SYSTEM_DISPLAY_NAME);
  const proxy = getSystemSettingValue(SETTING_KEY_PROXY_URL);
  const docs = getSystemSettingValue(SETTING_KEY_VENDOR_TYPE_DOCS);
  const includeDisabled = getSystemSettingValue(SETTING_KEY_INCLUDE_DISABLED);
  const requestTimeout = getSystemSettingValue(SETTING_KEY_REQUEST_TIMEOUT_MS);
  const concurrencySetting = getSystemSettingValue(SETTING_KEY_CONCURRENCY);
  const autoRefreshEnabled = getSystemSettingValue(SETTING_KEY_AUTO_REFRESH_ENABLED);
  const autoRefreshInterval = getSystemSettingValue(SETTING_KEY_AUTO_REFRESH_INTERVAL_MINUTES);
  const autoRefreshLastRun = getSystemSettingValue(SETTING_KEY_AUTO_REFRESH_LAST_RUN_AT);
  const autoCleanupAfterRefreshEnabled = getSystemSettingValue(SETTING_KEY_AUTO_CLEANUP_AFTER_REFRESH_ENABLED);
  const dailyCheckinEnabled = getSystemSettingValue(SETTING_KEY_DAILY_CHECKIN_SCHEDULE_ENABLED);
  const dailyCheckinTimes = getSystemSettingValue(SETTING_KEY_DAILY_CHECKIN_SCHEDULE_TIMES);
  const dailyCheckinLastRun = getSystemSettingValue(SETTING_KEY_DAILY_CHECKIN_LAST_RUN_AT);
  const balanceRefreshAnomalyThreshold = getSystemSettingValue(SETTING_KEY_BALANCE_REFRESH_ANOMALY_THRESHOLD_PERCENT);
  const balanceRefreshAnomalyVendorIds = getSystemSettingValue(SETTING_KEY_BALANCE_REFRESH_ANOMALY_VENDOR_IDS);

  return {
    systemDisplayName: normalizeSystemDisplayName(systemDisplayName.value),
    proxyUrl: normalizeText(proxy.value),
    vendorTypeDocs: parseVendorTypeDocs(docs.value),
    includeDisabled: parseBooleanSetting(includeDisabled.value, DEFAULT_INCLUDE_DISABLED),
    requestTimeoutMs: parseRequestTimeoutMs(requestTimeout.value),
    concurrency: parseConcurrency(concurrencySetting.value),
    autoRefreshEnabled: parseBooleanSetting(autoRefreshEnabled.value, false),
    autoRefreshIntervalMinutes: parseAutoRefreshIntervalMinutes(autoRefreshInterval.value),
    autoRefreshLastRunAt: normalizeText(autoRefreshLastRun.value),
    autoCleanupAfterRefreshEnabled: parseBooleanSetting(autoCleanupAfterRefreshEnabled.value, true),
    dailyCheckinScheduleEnabled: parseBooleanSetting(dailyCheckinEnabled.value, false),
    dailyCheckinScheduleTimes: parseDailyCheckinScheduleTimes(dailyCheckinTimes.value),
    dailyCheckinLastRunAt: normalizeText(dailyCheckinLastRun.value),
    balanceRefreshAnomalyThresholdPercent: parseBalanceRefreshAnomalyThresholdPercent(balanceRefreshAnomalyThreshold.value),
    balanceRefreshAnomalyVendorIds: parseVendorIdArray(balanceRefreshAnomalyVendorIds.value),
    updatedAt: resolveLatestUpdatedAt(
      systemDisplayName.updatedAt,
      proxy.updatedAt,
      docs.updatedAt,
      autoRefreshEnabled.updatedAt,
      autoRefreshInterval.updatedAt,
      autoRefreshLastRun.updatedAt,
      autoCleanupAfterRefreshEnabled.updatedAt,
      dailyCheckinEnabled.updatedAt,
      dailyCheckinTimes.updatedAt,
      dailyCheckinLastRun.updatedAt,
      balanceRefreshAnomalyThreshold.updatedAt,
      balanceRefreshAnomalyVendorIds.updatedAt,
    ),
  };
}

export function getVendorTypeDescription(vendorType: string | null | undefined): string | null {
  const normalized = normalizeText(vendorType)?.toLowerCase();
  if (!normalized) {
    return null;
  }

  const settings = getSystemSettings();
  return normalizeText(settings.vendorTypeDocs[normalized]);
}

export function getEffectiveProxyUrl(): string | null {
  const settings = getSystemSettings();
  const url = settings.proxyUrl ?? resolveProxyFromEnv();
  if (!url) return null;
  // Use socks5h for remote DNS resolution (required for Cloudflare-fronted hosts)
  return url.replace(/^socks5:\/\//i, 'socks5h://');
}

export function upsertSystemSettings(input: UpsertSystemSettingsInput): SystemSettings {
  const current = getSystemSettings();
  const nextSystemDisplayName =
    input.systemDisplayName === undefined
      ? current.systemDisplayName
      : normalizeSystemDisplayName(input.systemDisplayName);
  const nextProxyUrl =
    input.proxyUrl === undefined ? current.proxyUrl : normalizeProxyUrl(input.proxyUrl);

  const nextVendorTypeDocs =
    input.vendorTypeDocs === undefined ? current.vendorTypeDocs : normalizeVendorTypeDocs(input.vendorTypeDocs);
  const nextIncludeDisabled =
    normalizeBooleanInput(input.includeDisabled, current.includeDisabled);
  const nextRequestTimeoutMs =
    normalizeRequestTimeoutMsInput(input.requestTimeoutMs, current.requestTimeoutMs);
  const nextConcurrency =
    normalizeConcurrencyInput(input.concurrency, current.concurrency);
  const nextAutoRefreshEnabled =
    normalizeBooleanInput(input.autoRefreshEnabled, current.autoRefreshEnabled);
  const nextAutoRefreshIntervalMinutes =
    normalizeAutoRefreshIntervalMinutesInput(input.autoRefreshIntervalMinutes, current.autoRefreshIntervalMinutes);
  const nextAutoCleanupAfterRefreshEnabled =
    normalizeBooleanInput(
      input.autoCleanupAfterRefreshEnabled,
      current.autoCleanupAfterRefreshEnabled,
    );
  const nextDailyCheckinScheduleEnabled =
    normalizeBooleanInput(input.dailyCheckinScheduleEnabled, current.dailyCheckinScheduleEnabled);
  const nextDailyCheckinScheduleTimes =
    input.dailyCheckinScheduleTimes === undefined
      ? current.dailyCheckinScheduleTimes
      : normalizeDailyCheckinScheduleTimes(input.dailyCheckinScheduleTimes ?? []);
  const nextBalanceRefreshAnomalyThresholdPercent =
    normalizeBalanceRefreshAnomalyThresholdPercentInput(
      input.balanceRefreshAnomalyThresholdPercent,
      current.balanceRefreshAnomalyThresholdPercent,
    );
  const nextBalanceRefreshAnomalyVendorIds =
    normalizeVendorIdArrayInput(input.balanceRefreshAnomalyVendorIds, current.balanceRefreshAnomalyVendorIds);
  if (nextDailyCheckinScheduleEnabled && nextDailyCheckinScheduleTimes.length === 0) {
    throw new Error('已启用定时签到时，至少需要配置 1 个签到时间点');
  }

  setSystemSettingValue(SETTING_KEY_SYSTEM_DISPLAY_NAME, nextSystemDisplayName);
  setSystemSettingValue(SETTING_KEY_PROXY_URL, nextProxyUrl);
  setSystemSettingValue(SETTING_KEY_VENDOR_TYPE_DOCS, JSON.stringify(nextVendorTypeDocs));
  setSystemSettingValue(SETTING_KEY_INCLUDE_DISABLED, nextIncludeDisabled ? '1' : '0');
  setSystemSettingValue(SETTING_KEY_REQUEST_TIMEOUT_MS, String(nextRequestTimeoutMs));
  setSystemSettingValue(SETTING_KEY_CONCURRENCY, String(nextConcurrency));
  setSystemSettingValue(SETTING_KEY_AUTO_REFRESH_ENABLED, nextAutoRefreshEnabled ? '1' : '0');
  setSystemSettingValue(SETTING_KEY_AUTO_REFRESH_INTERVAL_MINUTES, String(nextAutoRefreshIntervalMinutes));
  setSystemSettingValue(
    SETTING_KEY_AUTO_CLEANUP_AFTER_REFRESH_ENABLED,
    nextAutoCleanupAfterRefreshEnabled ? '1' : '0',
  );
  setSystemSettingValue(SETTING_KEY_DAILY_CHECKIN_SCHEDULE_ENABLED, nextDailyCheckinScheduleEnabled ? '1' : '0');
  setSystemSettingValue(SETTING_KEY_DAILY_CHECKIN_SCHEDULE_TIMES, JSON.stringify(nextDailyCheckinScheduleTimes));
  setSystemSettingValue(
    SETTING_KEY_BALANCE_REFRESH_ANOMALY_THRESHOLD_PERCENT,
    String(nextBalanceRefreshAnomalyThresholdPercent),
  );
  setSystemSettingValue(
    SETTING_KEY_BALANCE_REFRESH_ANOMALY_VENDOR_IDS,
    JSON.stringify(nextBalanceRefreshAnomalyVendorIds),
  );
  return getSystemSettings();
}

export function recordAutoRefreshRun(runAtIso?: string): void {
  const value = normalizeText(runAtIso) ?? new Date().toISOString();
  setSystemSettingValue(SETTING_KEY_AUTO_REFRESH_LAST_RUN_AT, value);
}

export function recordDailyCheckinScheduleRun(runAtIso?: string): void {
  const value = normalizeText(runAtIso) ?? new Date().toISOString();
  setSystemSettingValue(SETTING_KEY_DAILY_CHECKIN_LAST_RUN_AT, value);
}
