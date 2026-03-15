import 'server-only';

import { listHubDailyUsageStats, type HubDailyUsageStat } from '@/lib/db';
import { getSqliteConnection } from '@/lib/sqlite-connection';
import { getVendorDefinition } from '@/lib/vendor-definitions';
import {
  getEndpointSettingsMap,
  listVendorOptions,
  type VendorOption,
  type VendorSetting,
} from '@/lib/vendor-settings';
import type { QuotaRecord } from '@/lib/quota/types';

export type VendorBalanceHistoryRange = '6h' | '24h' | '3d' | '7d' | '30d' | '90d' | 'all';
export type VendorBalanceHistorySourceScope =
  | 'manual_refresh_all'
  | 'scheduled_refresh_all'
  | 'refresh_vendor'
  | 'refresh_endpoint';
type VendorBalanceHistorySourceScopeStorage = VendorBalanceHistorySourceScope | 'refresh_all';

export type VendorBalanceHistoryPoint = {
  id: number;
  vendorId: number;
  vendorName: string;
  vendorType: string;
  remainingUsd: number | null;
  usedUsd: number | null;
  checkedAt: string;
  sourceScope: VendorBalanceHistorySourceScope;
  createdAt: string;
};

export type VendorBalanceHistoryPayload = {
  generatedAt: string;
  range: VendorBalanceHistoryRange;
  vendorId: number | null;
  vendor: VendorOption | null;
  vendors: VendorOption[];
  points: VendorBalanceHistoryPoint[];
  latestPoint: VendorBalanceHistoryPoint | null;
  hubDailyUsage: HubDailyUsageStat[];
};

export type VendorDailyUsageComparison = {
  vendorId: number;
  vendorName: string;
  vendorType: string | null;
  dateKey: string;
  usedDelta: number;
  hubCostUsd: number;
  differenceUsd: number;
  excessPercent: number | null;
};

export type VendorBalanceHistorySnapshotInput = {
  vendorId: number;
  vendorName: string;
  vendorType: string;
  remainingUsd: number | null;
  usedUsd: number | null;
  checkedAt: string;
  sourceScope: VendorBalanceHistorySourceScope;
};

type VendorBalanceHistoryRow = {
  id: number;
  vendor_id: number;
  vendor_name: string;
  vendor_type: string;
  remaining_usd: number | null;
  used_usd: number | null;
  checked_at: string;
  source_scope: string;
  created_at: string;
};

let initialized = false;

function roundUsd(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function normalizeUsd(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return roundUsd(value);
}

function normalizeRange(value: string | null | undefined): VendorBalanceHistoryRange {
  const normalized = (value || '').trim().toLowerCase();
  if (['6h', '24h', '3d', '7d', '30d', '90d', 'all'].includes(normalized)) {
    return normalized as VendorBalanceHistoryRange;
  }
  return '24h';
}

function rangeStartIso(range: VendorBalanceHistoryRange, now = new Date()): string | null {
  if (range === 'all') {
    return null;
  }
  const start = new Date(now);
  if (range === '6h') {
    start.setHours(start.getHours() - 6);
  } else if (range === '24h') {
    start.setHours(start.getHours() - 24);
  } else {
    const days = range === '3d' ? 3 : range === '7d' ? 7 : range === '90d' ? 90 : 30;
    start.setDate(start.getDate() - days);
  }
  return start.toISOString();
}

function formatShanghaiDateKey(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function shanghaiDayStartIso(now = new Date()): string {
  const dayKey = formatShanghaiDateKey(now).replace(/\//g, '-');
  return new Date(`${dayKey}T00:00:00+08:00`).toISOString();
}

function sumMonotonicSegments(values: number[], direction: 'increase' | 'decrease'): number {
  if (values.length <= 1) {
    return 0;
  }

  let segmentStart = values[0];
  let previousValue = values[0];
  let total = 0;

  for (let index = 1; index < values.length; index += 1) {
    const currentValue = values[index];
    const keepsDirection =
      direction === 'increase'
        ? currentValue >= previousValue
        : currentValue <= previousValue;

    if (keepsDirection) {
      previousValue = currentValue;
      continue;
    }

    total += direction === 'increase' ? previousValue - segmentStart : segmentStart - previousValue;
    segmentStart = currentValue;
    previousValue = currentValue;
  }

  total += direction === 'increase' ? previousValue - segmentStart : segmentStart - previousValue;
  return total;
}

function ensureTable(): void {
  if (initialized) {
    return;
  }

  const conn = getSqliteConnection();
  conn.exec(`
    CREATE TABLE IF NOT EXISTS vendor_balance_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id INTEGER NOT NULL,
      vendor_name TEXT NOT NULL,
      vendor_type TEXT NOT NULL,
      remaining_usd REAL,
      used_usd REAL,
      checked_at TEXT NOT NULL,
      source_scope TEXT NOT NULL DEFAULT 'manual_refresh_all',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_vendor_balance_history_vendor_checked
      ON vendor_balance_history (vendor_id, checked_at);

    CREATE INDEX IF NOT EXISTS idx_vendor_balance_history_checked
      ON vendor_balance_history (checked_at);
  `);

  conn.exec(`
    UPDATE vendor_balance_history
    SET source_scope = 'scheduled_refresh_all'
    WHERE lower(trim(source_scope)) = 'refresh_all';
  `);

  initialized = true;
}

function normalizeSourceScope(value: string | null | undefined): VendorBalanceHistorySourceScope {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'scheduled_refresh_all') {
    return 'scheduled_refresh_all';
  }
  if (normalized === 'refresh_vendor') {
    return 'refresh_vendor';
  }
  if (normalized === 'refresh_endpoint') {
    return 'refresh_endpoint';
  }
  return 'manual_refresh_all';
}

function mapRow(row: VendorBalanceHistoryRow): VendorBalanceHistoryPoint {
  return {
    id: Number(row.id),
    vendorId: Number(row.vendor_id),
    vendorName: String(row.vendor_name || ''),
    vendorType: String(row.vendor_type || ''),
    remainingUsd: normalizeUsd(row.remaining_usd),
    usedUsd: normalizeUsd(row.used_usd),
    checkedAt: String(row.checked_at || ''),
    sourceScope: normalizeSourceScope(row.source_scope),
    createdAt: String(row.created_at || ''),
  };
}

function hasFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function latestCheckedAtIso(records: QuotaRecord[]): string | null {
  const values = records
    .map((record) => record.result.checkedAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left));
  return values[0] ?? null;
}

function resolveAggregation(vendorType: string | null | undefined): {
  vendor_remaining: 'independent_request' | 'endpoint_sum';
  vendor_used: 'independent_request' | 'endpoint_sum';
} {
  const definition = getVendorDefinition((vendorType || '').trim().toLowerCase());
  return definition?.regionConfig.aggregation ?? {
    vendor_remaining: 'independent_request',
    vendor_used: 'endpoint_sum',
  };
}

function buildSummedMetric(
  records: QuotaRecord[],
  include: (record: QuotaRecord) => boolean,
  valueOf: (record: QuotaRecord) => number | null | undefined,
): { value: number; checkedAt: string | null } | null {
  const matched = records.filter(
    (record) =>
      include(record)
      && record.result.status === 'ok'
      && hasFiniteNumber(valueOf(record)),
  );
  if (matched.length === 0) {
    return null;
  }
  const value = matched.reduce((sum, record) => sum + (valueOf(record) ?? 0), 0);
  const checkedAt = matched
    .map((record) => record.result.checkedAt)
    .filter((item): item is string => Boolean(item))
    .sort((left, right) => right.localeCompare(left))[0] ?? null;
  return { value: roundUsd(value), checkedAt };
}

function buildLatestMetric(
  records: QuotaRecord[],
  valueOf: (record: QuotaRecord) => number | null | undefined,
): { value: number; checkedAt: string | null } | null {
  const matched = records
    .filter(
      (record) =>
        record.result.status === 'ok'
        && hasFiniteNumber(valueOf(record)),
    )
    .sort((left, right) =>
      String(right.result.checkedAt || '').localeCompare(String(left.result.checkedAt || '')),
    );
  const latest = matched[0] ?? null;
  if (!latest) {
    return null;
  }
  return {
    value: roundUsd(valueOf(latest) ?? 0),
    checkedAt: latest.result.checkedAt ?? null,
  };
}

export function buildVendorBalanceHistorySnapshots(
  records: QuotaRecord[],
  vendorMap: Map<number, VendorSetting>,
  sourceScope: VendorBalanceHistorySourceScope,
): VendorBalanceHistorySnapshotInput[] {
  const recordsByVendor = new Map<number, QuotaRecord[]>();
  for (const record of records) {
    const vendorId = Number(record.vendorId);
    if (!Number.isInteger(vendorId) || vendorId <= 0) {
      continue;
    }
    const list = recordsByVendor.get(vendorId) ?? [];
    list.push(record);
    recordsByVendor.set(vendorId, list);
  }

  const snapshots: VendorBalanceHistorySnapshotInput[] = [];
  for (const [vendorId, vendorRecords] of recordsByVendor) {
    const vendor = vendorMap.get(vendorId);
    const vendorName = (vendor?.name || vendorRecords.find((record) => record.vendorName)?.vendorName || '').trim();
    const vendorType = (vendor?.vendorType || vendorRecords.find((record) => record.vendorType)?.vendorType || '').trim();
    if (!vendorName || !vendorType) {
      continue;
    }

    const aggregation = resolveAggregation(vendorType);
    const used = aggregation.vendor_used === 'endpoint_sum'
      ? buildSummedMetric(
          vendorRecords,
          (record) => record.useVendorUsed,
          (record) => record.result.regionMetrics?.endpointUsedUsd ?? record.result.usedUsd,
        )
      : buildLatestMetric(
          vendorRecords,
          (record) => record.result.regionMetrics?.vendorUsedUsd ?? record.result.usedUsd,
        );

    const remaining = aggregation.vendor_remaining === 'endpoint_sum'
      ? buildSummedMetric(
          vendorRecords,
          (record) => record.useVendorRemaining,
          (record) => record.result.regionMetrics?.endpointRemainingUsd ?? record.result.remainingUsd,
        )
      : buildLatestMetric(
          vendorRecords,
          (record) => record.result.regionMetrics?.vendorRemainingUsd ?? record.result.remainingUsd,
        );

    const checkedAtCandidates = [used?.checkedAt ?? null, remaining?.checkedAt ?? null]
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => right.localeCompare(left));
    const checkedAt = checkedAtCandidates[0] ?? latestCheckedAtIso(vendorRecords);
    if (!checkedAt) {
      continue;
    }

    const usedUsd = normalizeUsd(used?.value);
    const remainingUsd = normalizeUsd(remaining?.value);
    if (usedUsd === null && remainingUsd === null) {
      continue;
    }

    snapshots.push({
      vendorId,
      vendorName,
      vendorType,
      remainingUsd,
      usedUsd,
      checkedAt,
      sourceScope,
    });
  }

  return snapshots.sort((left, right) => left.vendorName.localeCompare(right.vendorName, 'zh-CN'));
}

export function insertVendorBalanceHistorySnapshots(snapshots: VendorBalanceHistorySnapshotInput[]): void {
  ensureTable();
  if (snapshots.length === 0) {
    return;
  }

  const conn = getSqliteConnection();
  const statement = conn.prepare(`
    INSERT INTO vendor_balance_history (
      vendor_id,
      vendor_name,
      vendor_type,
      remaining_usd,
      used_usd,
      checked_at,
      source_scope
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  conn.exec('BEGIN');
  try {
    for (const item of snapshots) {
      statement.run(
        item.vendorId,
        item.vendorName,
        item.vendorType,
        item.remainingUsd,
        item.usedUsd,
        item.checkedAt,
        item.sourceScope,
      );
    }
    conn.exec('COMMIT');
  } catch (error) {
    conn.exec('ROLLBACK');
    throw error;
  }
}

export function listVendorBalanceHistoryPoints(
  vendorId: number,
  rangeInput?: string | null,
): VendorBalanceHistoryPoint[] {
  ensureTable();
  const normalizedVendorId = Number(vendorId);
  if (!Number.isInteger(normalizedVendorId) || normalizedVendorId <= 0) {
    return [];
  }

  const range = normalizeRange(rangeInput);
  const startIso = rangeStartIso(range);
  const conn = getSqliteConnection();
  const rows = (startIso
    ? conn.prepare(`
        SELECT
          id,
          vendor_id,
          vendor_name,
          vendor_type,
          remaining_usd,
          used_usd,
          checked_at,
          source_scope,
          created_at
        FROM vendor_balance_history
        WHERE vendor_id = ? AND checked_at >= ?
        ORDER BY checked_at ASC, id ASC
      `).all(normalizedVendorId, startIso)
    : conn.prepare(`
        SELECT
          id,
          vendor_id,
          vendor_name,
          vendor_type,
          remaining_usd,
          used_usd,
          checked_at,
          source_scope,
          created_at
        FROM vendor_balance_history
        WHERE vendor_id = ?
        ORDER BY checked_at ASC, id ASC
      `).all(normalizedVendorId)) as VendorBalanceHistoryRow[];

  return rows.map(mapRow);
}

export function listVendorIdsWithBalanceHistory(): number[] {
  ensureTable();
  const rows = getSqliteConnection()
    .prepare(`
      SELECT DISTINCT vendor_id
      FROM vendor_balance_history
      ORDER BY vendor_id ASC
    `)
    .all() as Array<{ vendor_id: number }>;
  return rows
    .map((row) => Number(row.vendor_id))
    .filter((value) => Number.isInteger(value) && value > 0);
}

export function normalizeVendorBalanceHistoryRange(value: string | null | undefined): VendorBalanceHistoryRange {
  return normalizeRange(value);
}

export function resolveDefaultVendorBalanceHistoryVendorId(preferredVendorId?: number | null): number | null {
  const normalizedPreferred = Number(preferredVendorId);
  if (Number.isInteger(normalizedPreferred) && normalizedPreferred > 0) {
    return normalizedPreferred;
  }
  return null;
}

export function listVendorBalanceHistoryVendors(): VendorOption[] {
  return listVendorOptions();
}

function listMappedEndpointIdsForVendor(vendorId: number): number[] {
  const endpointSettings = getEndpointSettingsMap();
  return Array.from(endpointSettings.values())
    .filter((setting) => setting.vendorId === vendorId)
    .map((setting) => setting.endpointId)
    .filter((endpointId) => Number.isInteger(endpointId) && endpointId > 0);
}

function findLatestVendorBalanceHistoryPointBefore(
  vendorId: number,
  beforeIso: string,
): VendorBalanceHistoryPoint | null {
  ensureTable();
  const normalizedVendorId = Number(vendorId);
  if (!Number.isInteger(normalizedVendorId) || normalizedVendorId <= 0) {
    return null;
  }

  const row = getSqliteConnection()
    .prepare(`
      SELECT
        id,
        vendor_id,
        vendor_name,
        vendor_type,
        remaining_usd,
        used_usd,
        checked_at,
        source_scope,
        created_at
      FROM vendor_balance_history
      WHERE vendor_id = ? AND checked_at < ?
      ORDER BY checked_at DESC, id DESC
      LIMIT 1
    `)
    .get(normalizedVendorId, beforeIso) as VendorBalanceHistoryRow | undefined;

  return row ? mapRow(row) : null;
}

export async function getVendorBalanceHistoryHubDailyUsage(
  preferredVendorId?: number | null,
  rangeInput?: string | null,
): Promise<HubDailyUsageStat[]> {
  const vendorId = resolveDefaultVendorBalanceHistoryVendorId(preferredVendorId);
  if (!vendorId) {
    return [];
  }

  return listHubDailyUsageStats(listMappedEndpointIdsForVendor(vendorId), rangeStartIso(normalizeRange(rangeInput)));
}

export async function getVendorDailyUsageComparisons(
  vendorIds: number[],
  now = new Date(),
): Promise<VendorDailyUsageComparison[]> {
  const normalizedVendorIds = Array.from(new Set(
    vendorIds
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item > 0),
  ));
  if (normalizedVendorIds.length === 0) {
    return [];
  }

  const vendorMap = new Map(listVendorBalanceHistoryVendors().map((item) => [item.id, item] as const));
  const todayKey = formatShanghaiDateKey(now);
  const todayStartIso = shanghaiDayStartIso(now);
  const results: VendorDailyUsageComparison[] = [];

  for (const vendorId of normalizedVendorIds) {
    const endpointIds = listMappedEndpointIdsForVendor(vendorId);
    if (endpointIds.length === 0) {
      continue;
    }

    const points = listVendorBalanceHistoryPoints(vendorId, '24h')
      .filter((point) => formatShanghaiDateKey(point.checkedAt) === todayKey);
    const baselinePoint = findLatestVendorBalanceHistoryPointBefore(vendorId, todayStartIso);
    const usedValues = [
      baselinePoint?.usedUsd ?? null,
      ...points.map((point) => point.usedUsd),
    ]
      .filter((value): value is number => hasFiniteNumber(value));
    if (usedValues.length === 0) {
      continue;
    }

    const usedDelta = roundUsd(sumMonotonicSegments(usedValues, 'increase'));
    const hubDailyUsage = await listHubDailyUsageStats(endpointIds, rangeStartIso('24h', now));
    const hubToday = hubDailyUsage.find((item) => item.dateKey === todayKey) ?? null;
    const hubCostUsd = roundUsd(hubToday?.totalCostUsd ?? 0);
    const differenceUsd = roundUsd(usedDelta - hubCostUsd);
    const excessPercent = hubCostUsd > 0
      ? Math.round((differenceUsd / hubCostUsd) * 10000) / 100
      : null;
    const vendor = vendorMap.get(vendorId) ?? null;
    const fallbackPoint = points[points.length - 1] ?? null;

    results.push({
      vendorId,
      vendorName: vendor?.name ?? fallbackPoint?.vendorName ?? `服务商 ${vendorId}`,
      vendorType: vendor?.vendorType ?? fallbackPoint?.vendorType ?? null,
      dateKey: todayKey,
      usedDelta,
      hubCostUsd,
      differenceUsd,
      excessPercent,
    });
  }

  return results.sort((left, right) => right.differenceUsd - left.differenceUsd);
}

export async function getVendorBalanceHistoryPayload(
  preferredVendorId?: number | null,
  rangeInput?: string | null,
): Promise<VendorBalanceHistoryPayload> {
  const vendors = listVendorBalanceHistoryVendors();
  const range = normalizeRange(rangeInput);
  const vendorId = resolveDefaultVendorBalanceHistoryVendorId(preferredVendorId);
  const vendor = vendorId
    ? vendors.find((item) => item.id === vendorId) ?? null
    : null;
  const points = vendorId ? listVendorBalanceHistoryPoints(vendorId, range) : [];
  const latestPoint = points[points.length - 1] ?? null;

  return {
    generatedAt: new Date().toISOString(),
    range,
    vendorId,
    vendor,
    vendors,
    points,
    latestPoint,
    hubDailyUsage: [],
  };
}
