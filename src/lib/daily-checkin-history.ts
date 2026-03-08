import 'server-only';

import { getSqliteConnection } from '@/lib/sqlite-connection';
import type { QuotaStatus } from '@/lib/quota/types';

export type DailyCheckinRecord = {
  dayKey: string;
  vendorId: number;
  vendorName: string;
  vendorType: string;
  awardedUsd: number | null;
  status: QuotaStatus;
  message: string | null;
  endpointId: number | null;
  checkinDate: string | null;
  source: string | null;
  rawResponseText: string | null;
  attempts: number;
  firstSuccessAt: string | null;
  lastAttemptAt: string;
  updatedAt: string;
};

export type DailyCheckinMonthSummary = {
  dayKey: string;
  totalAwardedUsd: number;
  vendorCount: number;
  awardedVendorCount: number;
  updatedAt: string | null;
};

type DailyCheckinRecordRow = {
  day_key: string;
  vendor_id: number;
  vendor_name: string;
  vendor_type: string;
  awarded_usd: number | null;
  status: string;
  message: string | null;
  endpoint_id: number | null;
  checkin_date: string | null;
  source: string | null;
  raw_response_text: string | null;
  attempts: number;
  first_success_at: string | null;
  last_attempt_at: string;
  updated_at: string;
};

let initialized = false;

function nowIso(): string {
  return new Date().toISOString();
}

function roundUsd(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function normalizeAwardedUsd(value: number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!Number.isFinite(value)) {
    return null;
  }
  return roundUsd(value);
}

function buildDateKey(date: Date, timeZone = 'Asia/Shanghai'): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value ?? '';
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const day = parts.find((part) => part.type === 'day')?.value ?? '';
  if (!year || !month || !day) {
    const fallbackYear = date.getFullYear();
    const fallbackMonth = String(date.getMonth() + 1).padStart(2, '0');
    const fallbackDay = String(date.getDate()).padStart(2, '0');
    return `${fallbackYear}-${fallbackMonth}-${fallbackDay}`;
  }
  return `${year}-${month}-${day}`;
}

function normalizeDayKey(value: string | null | undefined): string | null {
  const raw = (value || '').trim();
  if (!raw) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  let parsed: Date | null = null;
  if (/^\d+$/.test(raw)) {
    // Pure numeric date tokens are ambiguous.
    // Only accept unix timestamps (seconds/ms) and reject tiny values such as "0".
    if (raw.length === 10) {
      const seconds = Number(raw);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        return null;
      }
      parsed = new Date(seconds * 1000);
    } else if (raw.length === 13) {
      const milliseconds = Number(raw);
      if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
        return null;
      }
      parsed = new Date(milliseconds);
    } else {
      return null;
    }
  } else {
    parsed = new Date(raw);
  }

  if (!parsed) {
    return null;
  }
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return buildDateKey(parsed);
}

function nextMonthKey(monthKey: string): string | null {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    return null;
  }
  const [yearRaw, monthRaw] = monthKey.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}`;
}

function mapRow(row: DailyCheckinRecordRow): DailyCheckinRecord {
  return {
    dayKey: String(row.day_key),
    vendorId: Number(row.vendor_id),
    vendorName: String(row.vendor_name || ''),
    vendorType: String(row.vendor_type || ''),
    awardedUsd: row.awarded_usd !== null && Number.isFinite(Number(row.awarded_usd)) ? Number(row.awarded_usd) : null,
    status: String(row.status || 'not_checked') as QuotaStatus,
    message: row.message ? String(row.message) : null,
    endpointId: row.endpoint_id !== null && Number.isFinite(Number(row.endpoint_id)) ? Number(row.endpoint_id) : null,
    checkinDate: row.checkin_date ? String(row.checkin_date) : null,
    source: row.source ? String(row.source) : null,
    rawResponseText: row.raw_response_text ? String(row.raw_response_text) : null,
    attempts: Number.isFinite(Number(row.attempts)) ? Number(row.attempts) : 0,
    firstSuccessAt: row.first_success_at ? String(row.first_success_at) : null,
    lastAttemptAt: String(row.last_attempt_at || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

function ensureTable(): void {
  if (initialized) {
    return;
  }
  const conn = getSqliteConnection();
  conn.exec(`
    CREATE TABLE IF NOT EXISTS daily_checkin_records (
      day_key TEXT NOT NULL,
      vendor_id INTEGER NOT NULL,
      vendor_name TEXT NOT NULL,
      vendor_type TEXT NOT NULL,
      awarded_usd REAL,
      status TEXT NOT NULL DEFAULT 'not_checked',
      message TEXT,
      endpoint_id INTEGER,
      checkin_date TEXT,
      source TEXT,
      raw_response_text TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      first_success_at TEXT,
      last_attempt_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (day_key, vendor_id)
    );

    CREATE INDEX IF NOT EXISTS idx_daily_checkin_records_day
      ON daily_checkin_records (day_key);
  `);
  initialized = true;
}

export function getTodayCheckinDayKey(): string {
  return buildDateKey(new Date());
}

export function normalizeMonthKey(value: string | null | undefined): string {
  const raw = (value || '').trim();
  if (/^\d{4}-\d{2}$/.test(raw)) {
    return raw;
  }
  return getTodayCheckinDayKey().slice(0, 7);
}

export function normalizeDetailDayKey(value: string | null | undefined): string {
  const normalized = normalizeDayKey(value);
  if (normalized) {
    return normalized;
  }
  return getTodayCheckinDayKey();
}

export function listDailyCheckinRecordsByDay(dayKey: string): DailyCheckinRecord[] {
  ensureTable();
  const normalizedDayKey = normalizeDayKey(dayKey);
  if (!normalizedDayKey) {
    return [];
  }

  const rows = getSqliteConnection()
    .prepare(`
      SELECT
        day_key,
        vendor_id,
        vendor_name,
        vendor_type,
        awarded_usd,
        status,
        message,
        endpoint_id,
        checkin_date,
        source,
        raw_response_text,
        attempts,
        first_success_at,
        last_attempt_at,
        updated_at
      FROM daily_checkin_records
      WHERE day_key = ?
      ORDER BY vendor_name COLLATE NOCASE ASC, vendor_id ASC
    `)
    .all(normalizedDayKey) as DailyCheckinRecordRow[];

  return rows.map(mapRow);
}

export function getDailyCheckinTotalByDay(dayKey: string): number {
  ensureTable();
  const normalizedDayKey = normalizeDayKey(dayKey);
  if (!normalizedDayKey) {
    return 0;
  }

  const row = getSqliteConnection()
    .prepare(`
      SELECT COALESCE(SUM(CASE WHEN awarded_usd IS NULL THEN 0 ELSE awarded_usd END), 0) AS total_awarded_usd
      FROM daily_checkin_records
      WHERE day_key = ?
    `)
    .get(normalizedDayKey) as { total_awarded_usd: number | null } | undefined;

  const total = row?.total_awarded_usd ?? 0;
  return Number.isFinite(Number(total)) ? roundUsd(Number(total)) : 0;
}

export function listDailyCheckinSummaryByMonth(monthKey: string): DailyCheckinMonthSummary[] {
  ensureTable();
  const normalizedMonthKey = normalizeMonthKey(monthKey);
  const nextMonth = nextMonthKey(normalizedMonthKey);
  if (!nextMonth) {
    return [];
  }
  const startKey = `${normalizedMonthKey}-01`;
  const endKey = `${nextMonth}-01`;

  const rows = getSqliteConnection()
    .prepare(`
      SELECT
        day_key,
        COALESCE(SUM(CASE WHEN awarded_usd IS NULL THEN 0 ELSE awarded_usd END), 0) AS total_awarded_usd,
        COUNT(*) AS vendor_count,
        SUM(CASE WHEN awarded_usd IS NOT NULL AND awarded_usd > 0 THEN 1 ELSE 0 END) AS awarded_vendor_count,
        MAX(updated_at) AS updated_at
      FROM daily_checkin_records
      WHERE day_key >= ? AND day_key < ?
      GROUP BY day_key
      ORDER BY day_key ASC
    `)
    .all(startKey, endKey) as Array<{
      day_key: string;
      total_awarded_usd: number;
      vendor_count: number;
      awarded_vendor_count: number;
      updated_at: string | null;
    }>;

  return rows.map((row) => ({
    dayKey: String(row.day_key),
    totalAwardedUsd: roundUsd(Number(row.total_awarded_usd) || 0),
    vendorCount: Number(row.vendor_count) || 0,
    awardedVendorCount: Number(row.awarded_vendor_count) || 0,
    updatedAt: row.updated_at ? String(row.updated_at) : null,
  }));
}

export function recordDailyCheckinAttempt(input: {
  dayKey?: string | null;
  vendorId: number;
  vendorName: string;
  vendorType: string;
  requestSucceeded?: boolean;
  status: QuotaStatus;
  message?: string | null;
  endpointId?: number | null;
  checkinDate?: string | null;
  source?: string | null;
  rawResponseText?: string | null;
  awardedUsd?: number | null;
}): {
  dayKey: string;
  storedAwardedUsd: number | null;
  deltaAwardedUsd: number;
  effectiveStatus: QuotaStatus;
} {
  ensureTable();

  const vendorId = Number(input.vendorId);
  if (!Number.isInteger(vendorId) || vendorId <= 0) {
    throw new Error('vendorId 非法');
  }

  const vendorName = (input.vendorName || '').trim() || `Vendor-${vendorId}`;
  const vendorType = (input.vendorType || '').trim() || '';
  const status = (input.status || 'not_checked') as QuotaStatus;
  const message = (input.message || '').trim() || null;
  const source = (input.source || '').trim() || null;
  const rawResponseText = (input.rawResponseText || '').trim() || null;
  const checkinDate = (input.checkinDate || '').trim() || null;
  const endpointId = Number.isInteger(input.endpointId) && Number(input.endpointId) > 0
    ? Number(input.endpointId)
    : null;
  const candidateAwarded = normalizeAwardedUsd(input.awardedUsd);
  const requestSucceeded = input.requestSucceeded === true;
  const dayKey = normalizeDayKey(input.dayKey) || normalizeDayKey(checkinDate) || getTodayCheckinDayKey();
  const now = nowIso();

  const conn = getSqliteConnection();
  const existing = conn.prepare(`
    SELECT
      awarded_usd,
      attempts,
      first_success_at,
      checkin_date,
      source,
      raw_response_text,
      endpoint_id
    FROM daily_checkin_records
    WHERE day_key = ? AND vendor_id = ?
    LIMIT 1
  `).get(dayKey, vendorId) as {
    awarded_usd: number | null;
    attempts: number | null;
    first_success_at: string | null;
    checkin_date: string | null;
    source: string | null;
    raw_response_text: string | null;
    endpoint_id: number | null;
  } | undefined;

  const existingAwarded = normalizeAwardedUsd(existing?.awarded_usd ?? null);
  let storedAwarded: number | null = existingAwarded;
  // Real successful requests may update today's amount; failed retries should not override existing amount.
  if (requestSucceeded && candidateAwarded !== null && candidateAwarded > 0) {
    storedAwarded = candidateAwarded;
  } else if ((existingAwarded === null || existingAwarded <= 0) && candidateAwarded !== null && candidateAwarded > 0) {
    storedAwarded = candidateAwarded;
  } else if (existingAwarded === null && candidateAwarded !== null) {
    storedAwarded = candidateAwarded;
  }

  const hasAwarded = storedAwarded !== null && storedAwarded > 0;
  const effectiveStatus: QuotaStatus = hasAwarded ? 'ok' : status;

  const deltaAwarded = roundUsd((storedAwarded ?? 0) - (existingAwarded ?? 0));
  const attempts = (existing?.attempts ?? 0) + 1;
  const firstSuccessAt = existing?.first_success_at
    ? String(existing.first_success_at)
    : effectiveStatus === 'ok' && hasAwarded
      ? now
      : null;
  const persistedCheckinDate = checkinDate || (existing?.checkin_date ? String(existing.checkin_date) : null);
  const persistedSource = source || (existing?.source ? String(existing.source) : null);
  const persistedRawResponseText = rawResponseText || (existing?.raw_response_text ? String(existing.raw_response_text) : null);
  const persistedEndpointId = endpointId ?? (existing?.endpoint_id !== null && existing?.endpoint_id !== undefined
    ? Number(existing.endpoint_id)
    : null);

  conn.prepare(`
    INSERT INTO daily_checkin_records (
      day_key,
      vendor_id,
      vendor_name,
      vendor_type,
      awarded_usd,
      status,
      message,
      endpoint_id,
      checkin_date,
      source,
      raw_response_text,
      attempts,
      first_success_at,
      last_attempt_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(day_key, vendor_id) DO UPDATE SET
      vendor_name = excluded.vendor_name,
      vendor_type = excluded.vendor_type,
      awarded_usd = excluded.awarded_usd,
      status = excluded.status,
      message = excluded.message,
      endpoint_id = excluded.endpoint_id,
      checkin_date = excluded.checkin_date,
      source = excluded.source,
      raw_response_text = excluded.raw_response_text,
      attempts = excluded.attempts,
      first_success_at = excluded.first_success_at,
      last_attempt_at = excluded.last_attempt_at,
      updated_at = excluded.updated_at
  `).run(
    dayKey,
    vendorId,
    vendorName,
    vendorType,
    storedAwarded,
    effectiveStatus,
    message,
    persistedEndpointId,
    persistedCheckinDate,
    persistedSource,
    persistedRawResponseText,
    attempts,
    firstSuccessAt,
    now,
    now,
  );

  return {
    dayKey,
    storedAwardedUsd: storedAwarded,
    deltaAwardedUsd: deltaAwarded > 0 ? deltaAwarded : 0,
    effectiveStatus,
  };
}

export function updateDailyCheckinAwardedUsd(input: {
  dayKey: string;
  vendorId: number;
  awardedUsd: number;
}): DailyCheckinRecord {
  ensureTable();

  const dayKey = normalizeDayKey(input.dayKey);
  if (!dayKey) {
    throw new Error('dayKey 非法');
  }

  const vendorId = Number(input.vendorId);
  if (!Number.isInteger(vendorId) || vendorId <= 0) {
    throw new Error('vendorId 非法');
  }

  const awardedUsd = normalizeAwardedUsd(input.awardedUsd);
  if (awardedUsd === null || awardedUsd < 0) {
    throw new Error('awardedUsd 非法');
  }

  const conn = getSqliteConnection();
  const existing = conn.prepare(`
    SELECT
      day_key,
      vendor_id,
      vendor_name,
      vendor_type,
      awarded_usd,
      status,
      message,
      endpoint_id,
      checkin_date,
      source,
      raw_response_text,
      attempts,
      first_success_at,
      last_attempt_at,
      updated_at
    FROM daily_checkin_records
    WHERE day_key = ? AND vendor_id = ?
    LIMIT 1
  `).get(dayKey, vendorId) as DailyCheckinRecordRow | undefined;

  if (!existing) {
    throw new Error('未找到签到记录');
  }

  const now = nowIso();
  const shouldMarkSuccess = awardedUsd > 0;
  const nextStatus: QuotaStatus = shouldMarkSuccess ? 'ok' : (String(existing.status || 'not_checked') as QuotaStatus);
  const nextMessage = shouldMarkSuccess ? null : (existing.message ? String(existing.message) : null);
  const nextFirstSuccessAt = existing.first_success_at
    ? String(existing.first_success_at)
    : shouldMarkSuccess
      ? now
      : null;

  conn.prepare(`
    UPDATE daily_checkin_records
    SET
      awarded_usd = ?,
      status = ?,
      message = ?,
      first_success_at = ?,
      updated_at = ?
    WHERE day_key = ? AND vendor_id = ?
  `).run(
    awardedUsd,
    nextStatus,
    nextMessage,
    nextFirstSuccessAt,
    now,
    dayKey,
    vendorId,
  );

  const updated = conn.prepare(`
    SELECT
      day_key,
      vendor_id,
      vendor_name,
      vendor_type,
      awarded_usd,
      status,
      message,
      endpoint_id,
      checkin_date,
      source,
      raw_response_text,
      attempts,
      first_success_at,
      last_attempt_at,
      updated_at
    FROM daily_checkin_records
    WHERE day_key = ? AND vendor_id = ?
    LIMIT 1
  `).get(dayKey, vendorId) as DailyCheckinRecordRow | undefined;

  if (!updated) {
    throw new Error('更新签到记录失败');
  }

  return mapRow(updated);
}
