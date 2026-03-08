import 'server-only';

import { DatabaseSync } from 'node:sqlite';

import {
  ensureVendorDefinitionsTable,
  isRegisteredVendorType,
  normalizeVendorTypeText,
  requireRegisteredVendorType,
} from '@/lib/vendor-definitions';
import { getDatabasePath } from '@/lib/db-path';
import { getSqliteConnection } from '@/lib/sqlite-connection';

export type VendorType = string;

export type VendorOption = {
  id: number;
  name: string;
  vendorType: VendorType | null;
  envVars: Record<string, string>;
  displayOrder: number | null;
  updatedAt: string | null;
};

export type VendorSetting = {
  id: number;
  name: string;
  vendorType: VendorType | null;
  envVars: Record<string, string>;
  displayOrder: number | null;
  updatedAt: string | null;
};

export type EndpointBillingMode = 'usage' | 'duration';

export type EndpointSetting = {
  endpointId: number;
  vendorId: number | null;
  vendorName: string | null;
  vendorType: VendorType | null;
  billingMode: EndpointBillingMode;
  useVendorGroup: boolean;
  useVendorUsed: boolean;
  useVendorRemaining: boolean;
  useVendorAmount: boolean;
  useVendorBalance: boolean;
  envVars: Record<string, string>;
  isHidden: boolean;
  updatedAt: string | null;
};

type UpsertEndpointSettingInput = {
  endpointId: number;
  vendorId: number | null;
  vendorName: string | null;
  vendorType?: string | null;
  billingMode?: EndpointBillingMode | string | null;
  useVendorGroup?: boolean | number | string | null;
  useVendorUsed?: boolean | number | string | null;
  useVendorRemaining?: boolean | number | string | null;
  useVendorAmount?: boolean | number | string | null;
  useVendorBalance?: boolean | number | string | null;
  envVars?: Record<string, string> | null;
  isHidden?: boolean | number | string | null;
};

type NormalizedEndpointToggles = {
  useVendorGroup: boolean;
  useVendorUsed: boolean;
  useVendorRemaining: boolean;
  useVendorAmount: boolean;
  useVendorBalance: boolean;
};

type UpsertVendorSettingInput = {
  vendorId: number;
  vendorType?: string | null;
  envVars?: Record<string, string> | null;
};

type SqliteTableColumnRow = {
  name: string;
};

let dbInstance: DatabaseSync | null = null;

export function getVendorSettingsDatabasePath(): string {
  return getDatabasePath();
}

function normalizeEnvVarKey(value: string): string | null {
  const key = value.trim().replace(/^\$+/, '');
  if (!key) return null;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return null;
  }
  return key;
}

function normalizeEnvVarValues(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [rawKey, rawVal] of Object.entries(value as Record<string, unknown>)) {
    const key = normalizeEnvVarKey(rawKey);
    if (!key) continue;
    if (typeof rawVal !== 'string') continue;
    const text = rawVal.trim();
    if (!text) continue;
    result[key] = text;
  }
  return result;
}

function db(): DatabaseSync {
  if (dbInstance) {
    return dbInstance;
  }

  dbInstance = getSqliteConnection();

  dbInstance.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS vendors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      vendor_type TEXT NOT NULL DEFAULT '',
      env_vars_json TEXT NOT NULL DEFAULT '{}',
      display_order INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS endpoint_settings (
      endpoint_id INTEGER PRIMARY KEY,
      vendor_id INTEGER,
      vendor_type TEXT NOT NULL,
      billing_mode TEXT NOT NULL DEFAULT 'usage',
      use_vendor_group INTEGER NOT NULL DEFAULT 1,
      use_vendor_used_aggregation INTEGER NOT NULL DEFAULT 1,
      use_vendor_balance_aggregation INTEGER NOT NULL DEFAULT 1,
      use_vendor_amount INTEGER NOT NULL DEFAULT 0,
      use_vendor_balance INTEGER NOT NULL DEFAULT 0,
      env_vars_json TEXT NOT NULL DEFAULT '{}',
      is_hidden INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(vendor_id) REFERENCES vendors(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_endpoint_settings_vendor_id
      ON endpoint_settings (vendor_id);
  `);

  const vendorTableColumns = dbInstance
    .prepare(`PRAGMA table_info(vendors)`)
    .all() as SqliteTableColumnRow[];
  const hasDisplayOrderColumn = vendorTableColumns.some((row) => String(row.name) === 'display_order');
  if (!hasDisplayOrderColumn) {
    dbInstance.exec(`ALTER TABLE vendors ADD COLUMN display_order INTEGER`);
  }

  ensureVendorDefinitionsTable(dbInstance);

  return dbInstance;
}

function normalizeVendorName(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeBooleanLike(
  value: boolean | number | string | null | undefined,
  fallback = false,
): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value > 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return fallback;
    }
    if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
      return true;
    }
    if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
      return false;
    }
  }
  return fallback;
}

function normalizeBillingMode(value: string | null | undefined): EndpointBillingMode {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === 'duration' || normalized === 'monthly') {
    return 'duration';
  }
  return 'usage';
}

function normalizeVendorTypeForWrite(value: string | null | undefined, field = 'vendorType'): VendorType {
  return requireRegisteredVendorType(value, field);
}

function normalizeVendorTypeFromStorage(value: string | null | undefined, field: string): VendorType {
  const normalized = normalizeVendorTypeText(value);
  if (!normalized) {
    throw new Error(`${field} 不能为空或格式非法`);
  }
  if (normalized === '__hidden__' || normalized === '_hidden_') {
    throw new Error(`${field} 是隐藏占位值，不是实际 vendorType`);
  }
  if (!isRegisteredVendorType(normalized)) {
    throw new Error(`${field} 未注册: ${normalized}`);
  }
  return normalized;
}

export function normalizeEndpointToggles(
  input: {
    useVendorGroup?: boolean | number | string | null;
    useVendorUsed?: boolean | number | string | null;
    useVendorRemaining?: boolean | number | string | null;
    useVendorAmount?: boolean | number | string | null;
    useVendorBalance?: boolean | number | string | null;
  },
  existingSetting: EndpointSetting | null,
): NormalizedEndpointToggles {
  return {
    useVendorGroup: normalizeBooleanLike(input.useVendorGroup, existingSetting?.useVendorGroup ?? true),
    useVendorUsed: normalizeBooleanLike(input.useVendorUsed, existingSetting?.useVendorUsed ?? true),
    useVendorRemaining: normalizeBooleanLike(
      input.useVendorRemaining,
      existingSetting?.useVendorRemaining ?? true,
    ),
    useVendorAmount: normalizeBooleanLike(input.useVendorAmount, existingSetting?.useVendorAmount ?? false),
    useVendorBalance: normalizeBooleanLike(input.useVendorBalance, existingSetting?.useVendorBalance ?? false),
  };
}

function ensureVendorId(name: string, vendorType?: string): number {
  const conn = db();
  if (vendorType) {
    conn
      .prepare(`
        INSERT INTO vendors (name, vendor_type)
        VALUES (?, ?)
        ON CONFLICT(name) DO NOTHING
      `)
      .run(name, vendorType);
  } else {
    conn
      .prepare(`
        INSERT INTO vendors (name, vendor_type)
        VALUES (?, '')
        ON CONFLICT(name) DO NOTHING
      `)
      .run(name);
  }

  const row = conn
    .prepare(`
      SELECT id
      FROM vendors
      WHERE name = ?
      LIMIT 1
    `)
    .get(name) as { id: number } | undefined;

  if (!row?.id) {
    throw new Error(`创建服务商失败: ${name}`);
  }

  return Number(row.id);
}

export function upsertVendorByName(name: string, vendorType?: string | null): VendorSetting {
  const vendorName = normalizeVendorName(name);
  if (!vendorName) {
    throw new Error('服务商名称不能为空');
  }

  const normalizedVendorType =
    vendorType === undefined || vendorType === null || vendorType.trim() === ''
      ? undefined
      : normalizeVendorTypeForWrite(vendorType, 'vendorType');

  const vendorId = ensureVendorId(vendorName, normalizedVendorType);
  const endpoint = getVendorSetting(vendorId);
  if (!endpoint) {
    throw new Error(`创建服务商失败: ${vendorName}`);
  }

  return endpoint;
}

type VendorRow = {
  id: number;
  name: string;
  vendor_type: string | null;
  env_vars_json: string | null;
  display_order: number | null;
  updated_at: string | null;
};

function mapVendorRow(row: VendorRow): VendorSetting {
  let envVars: Record<string, string> = {};
  try {
    envVars = normalizeEnvVarValues(row.env_vars_json ? JSON.parse(row.env_vars_json) : {});
  } catch {
    envVars = {};
  }

  let vendorType: VendorType | null = null;
  if (row.vendor_type) {
    try {
      vendorType = normalizeVendorTypeFromStorage(row.vendor_type, `vendors.id=${row.id}.vendor_type`);
    } catch {
      vendorType = null;
    }
  }

  return {
    id: Number(row.id),
    name: String(row.name),
    vendorType,
    envVars,
    displayOrder: row.display_order === null ? null : Number(row.display_order),
    updatedAt: row.updated_at ? String(row.updated_at) : null,
  };
}

export function listVendorSettings(): VendorSetting[] {
  const rows = db()
    .prepare(`
      SELECT
        id,
        name,
        vendor_type,
        env_vars_json,
        display_order,
        updated_at
      FROM vendors
      ORDER BY
        CASE WHEN display_order IS NULL THEN 1 ELSE 0 END ASC,
        display_order ASC,
        name COLLATE NOCASE ASC
    `)
    .all() as VendorRow[];

  return rows.map(mapVendorRow);
}

export function getVendorSettingsMap(): Map<number, VendorSetting> {
  const map = new Map<number, VendorSetting>();
  for (const vendor of listVendorSettings()) {
    map.set(vendor.id, vendor);
  }
  return map;
}

export function listVendorOptions(): VendorOption[] {
  return listVendorSettings().map((vendor) => ({
    id: vendor.id,
    name: vendor.name,
    vendorType: vendor.vendorType,
    envVars: { ...vendor.envVars },
    displayOrder: vendor.displayOrder,
    updatedAt: vendor.updatedAt,
  }));
}

export function getVendorSetting(vendorId: number): VendorSetting | null {
  const normalizedId = Number(vendorId);
  if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
    return null;
  }

  const row = db()
    .prepare(`
      SELECT
        id,
        name,
        vendor_type,
        env_vars_json,
        display_order,
        updated_at
      FROM vendors
      WHERE id = ?
      LIMIT 1
    `)
    .get(normalizedId) as VendorRow | undefined;

  return row ? mapVendorRow(row) : null;
}

type EndpointSettingRow = {
  endpoint_id: number;
  vendor_id: number | null;
  vendor_name: string | null;
  vendor_type: string | null;
  billing_mode: string | null;
  use_vendor_group: number | null;
  use_vendor_used_aggregation: number | null;
  use_vendor_balance_aggregation: number | null;
  use_vendor_amount: number | null;
  use_vendor_balance: number | null;
  env_vars_json: string | null;
  is_hidden: number | null;
  updated_at: string | null;
};

function mapEndpointSettingRow(row: EndpointSettingRow): EndpointSetting {
  let envVars: Record<string, string> = {};
  try {
    envVars = normalizeEnvVarValues(row.env_vars_json ? JSON.parse(row.env_vars_json) : {});
  } catch {
    envVars = {};
  }

  const rawType = row.vendor_type;
  const isHiddenOnly = rawType === '__hidden__' || rawType === '_hidden_' || !rawType;
  let vendorType: VendorType | null = null;
  if (!isHiddenOnly) {
    try {
      vendorType = normalizeVendorTypeFromStorage(rawType, `endpoint_settings.endpoint_id=${row.endpoint_id}.vendor_type`);
    } catch {
      vendorType = null;
    }
  }

  return {
    endpointId: Number(row.endpoint_id),
    vendorId: row.vendor_id !== null ? Number(row.vendor_id) : null,
    vendorName: row.vendor_name ? String(row.vendor_name) : null,
    vendorType,
    billingMode: normalizeBillingMode(row.billing_mode),
    useVendorGroup: row.use_vendor_group === null ? true : Number(row.use_vendor_group) > 0,
    useVendorUsed: row.use_vendor_used_aggregation === null ? true : Number(row.use_vendor_used_aggregation) > 0,
    useVendorRemaining: row.use_vendor_balance_aggregation === null ? true : Number(row.use_vendor_balance_aggregation) > 0,
    useVendorAmount: row.use_vendor_amount === null ? false : Number(row.use_vendor_amount) > 0,
    useVendorBalance: row.use_vendor_balance === null ? false : Number(row.use_vendor_balance) > 0,
    envVars,
    isHidden: Number(row.is_hidden) > 0,
    updatedAt: row.updated_at ? String(row.updated_at) : null,
  };
}

export function listEndpointSettings(): EndpointSetting[] {
  const rows = db()
    .prepare(`
      SELECT
        ps.endpoint_id,
        ps.vendor_id,
        ps.vendor_type,
        ps.billing_mode,
        ps.use_vendor_group,
        ps.use_vendor_used_aggregation,
        ps.use_vendor_balance_aggregation,
        ps.use_vendor_amount,
        ps.use_vendor_balance,
        ps.env_vars_json,
        ps.is_hidden,
        ps.updated_at,
        e.name AS vendor_name
      FROM endpoint_settings ps
      LEFT JOIN vendors e ON e.id = ps.vendor_id
      ORDER BY ps.endpoint_id ASC
    `)
    .all() as EndpointSettingRow[];

  return rows.map(mapEndpointSettingRow);
}

export function getEndpointSettingsMap(): Map<number, EndpointSetting> {
  const map = new Map<number, EndpointSetting>();
  for (const setting of listEndpointSettings()) {
    map.set(setting.endpointId, setting);
  }
  return map;
}

export function getEndpointSetting(endpointId: number): EndpointSetting | null {
  const row = db()
    .prepare(`
      SELECT
        ps.endpoint_id,
        ps.vendor_id,
        ps.vendor_type,
        ps.billing_mode,
        ps.use_vendor_group,
        ps.use_vendor_used_aggregation,
        ps.use_vendor_balance_aggregation,
        ps.use_vendor_amount,
        ps.use_vendor_balance,
        ps.env_vars_json,
        ps.is_hidden,
        ps.updated_at,
        e.name AS vendor_name
      FROM endpoint_settings ps
      LEFT JOIN vendors e ON e.id = ps.vendor_id
      WHERE ps.endpoint_id = ?
      LIMIT 1
    `)
    .get(endpointId) as EndpointSettingRow | undefined;

  return row ? mapEndpointSettingRow(row) : null;
}

export function upsertEndpointSetting(input: UpsertEndpointSettingInput): EndpointSetting {
  const endpointId = Number(input.endpointId);
  if (!Number.isInteger(endpointId) || endpointId <= 0) {
    throw new Error('endpointId 非法');
  }

  const existingSetting = getEndpointSetting(endpointId);

  const vendorType = normalizeVendorTypeForWrite(input.vendorType ?? existingSetting?.vendorType);

  const vendorName = normalizeVendorName(input.vendorName);
  let vendorId: number | null = Number.isInteger(input.vendorId)
    ? Number(input.vendorId)
    : null;

  if (vendorName) {
    vendorId = ensureVendorId(vendorName, vendorType);
  }
  const endpoint = vendorId === null ? null : getVendorSetting(vendorId);
  if (vendorId !== null && !endpoint) {
    throw new Error("服务商不存在: " + vendorId);
  }

  const effectiveVendorType = endpoint?.vendorType ?? vendorType;
  const billingMode = normalizeBillingMode(input.billingMode ?? existingSetting?.billingMode ?? 'usage');

  const {
    useVendorGroup,
    useVendorUsed,
    useVendorRemaining,
    useVendorAmount,
    useVendorBalance,
  } = normalizeEndpointToggles(input, existingSetting);
  const envVars =
    input.envVars === undefined
      ? (existingSetting?.envVars ?? {})
      : normalizeEnvVarValues(input.envVars ?? {});

  const isHidden =
    input.isHidden === undefined
      ? existingSetting?.isHidden ?? false
      : normalizeBooleanLike(input.isHidden, false);

  db()
    .prepare(`
      INSERT INTO endpoint_settings (
        endpoint_id,
        vendor_id,
        vendor_type,
        billing_mode,
        use_vendor_group,
        use_vendor_used_aggregation,
        use_vendor_balance_aggregation,
        use_vendor_amount,
        use_vendor_balance,
        env_vars_json,
        is_hidden
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(endpoint_id)
      DO UPDATE SET
        vendor_id = excluded.vendor_id,
        vendor_type = excluded.vendor_type,
        billing_mode = excluded.billing_mode,
        use_vendor_group = excluded.use_vendor_group,
        use_vendor_used_aggregation = excluded.use_vendor_used_aggregation,
        use_vendor_balance_aggregation = excluded.use_vendor_balance_aggregation,
        use_vendor_amount = excluded.use_vendor_amount,
        use_vendor_balance = excluded.use_vendor_balance,
        env_vars_json = excluded.env_vars_json,
        is_hidden = excluded.is_hidden,
        updated_at = datetime('now')
    `)
    .run(
      endpointId,
      vendorId,
      effectiveVendorType,
      billingMode,
      useVendorGroup ? 1 : 0,
      useVendorUsed ? 1 : 0,
      useVendorRemaining ? 1 : 0,
      useVendorAmount ? 1 : 0,
      useVendorBalance ? 1 : 0,
      JSON.stringify(envVars),
      isHidden ? 1 : 0,
    );

  const saved = getEndpointSetting(endpointId);
  if (!saved) {
    throw new Error('保存端点设置失败');
  }

  return saved;
}

export function setEndpointHidden(endpointId: number, isHidden: boolean): void {
  db()
    .prepare(
      `INSERT INTO endpoint_settings (endpoint_id, vendor_type, is_hidden)
       VALUES (?, '__hidden__', ?)
       ON CONFLICT(endpoint_id)
       DO UPDATE SET is_hidden = excluded.is_hidden, updated_at = datetime('now')`,
    )
    .run(endpointId, isHidden ? 1 : 0);
}

export function deleteEndpointSettings(endpointIds: number[]): number {
  const normalizedIds = Array.from(
    new Set(endpointIds.filter((id) => Number.isInteger(id) && id > 0)),
  );
  if (normalizedIds.length === 0) {
    return 0;
  }

  const placeholders = normalizedIds.map(() => '?').join(', ');
  const result = db()
    .prepare(`DELETE FROM endpoint_settings WHERE endpoint_id IN (${placeholders})`)
    .run(...normalizedIds);

  return Number((result as { changes?: number }).changes ?? 0);
}

export function updateVendorDisplayOrder(orderedVendorIds: number[]): number {
  const normalizedIds = Array.from(
    new Set(orderedVendorIds.filter((id) => Number.isInteger(id) && id > 0)),
  );

  const conn = db();
  const existingIds = new Set<number>(
    (
      conn
        .prepare(`SELECT id FROM vendors`)
        .all() as Array<{ id: number }>
    ).map((row) => Number(row.id)),
  );
  const validOrderedIds = normalizedIds.filter((id) => existingIds.has(id));

  const clearUnorderedStmt = validOrderedIds.length > 0
    ? conn.prepare(`
      UPDATE vendors
      SET display_order = NULL, updated_at = datetime('now')
      WHERE display_order IS NOT NULL
        AND id NOT IN (${validOrderedIds.map(() => '?').join(', ')})
    `)
    : conn.prepare(`
      UPDATE vendors
      SET display_order = NULL, updated_at = datetime('now')
      WHERE display_order IS NOT NULL
    `);

  const updateStmt = conn.prepare(`
    UPDATE vendors
    SET display_order = ?, updated_at = datetime('now')
    WHERE id = ?
  `);

  conn.exec('BEGIN');
  try {
    const clearResult = (
      validOrderedIds.length > 0
        ? clearUnorderedStmt.run(...validOrderedIds)
        : clearUnorderedStmt.run()
    ) as { changes?: number };
    let changes = Number(clearResult.changes ?? 0);

    for (let index = 0; index < validOrderedIds.length; index += 1) {
      const result = updateStmt.run(index + 1, validOrderedIds[index]);
      changes += Number((result as { changes?: number }).changes ?? 0);
    }
    conn.exec('COMMIT');
    return changes;
  } catch (error) {
    conn.exec('ROLLBACK');
    throw error;
  }
}

export function deleteOrphanedVendors(): number {
  const result = db()
    .prepare(
      `DELETE FROM vendors
       WHERE id NOT IN (
         SELECT DISTINCT vendor_id
         FROM endpoint_settings
         WHERE vendor_id IS NOT NULL
       )`,
    )
    .run();

  return Number((result as { changes?: number }).changes ?? 0);
}

export function upsertVendorSetting(input: UpsertVendorSettingInput): VendorSetting {
  const vendorId = Number(input.vendorId);
  if (!Number.isInteger(vendorId) || vendorId <= 0) {
    throw new Error('vendorId 非法');
  }

  const existing = getVendorSetting(vendorId);
  if (!existing) {
    throw new Error(`服务商不存在: ${vendorId}`);
  }

  const vendorType = normalizeVendorTypeForWrite(input.vendorType ?? existing.vendorType);
  const envVars =
    input.envVars === undefined
      ? existing.envVars
      : normalizeEnvVarValues(input.envVars ?? {});

  db()
    .prepare(`
      UPDATE vendors
      SET
        vendor_type = ?,
        env_vars_json = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `)
    .run(
      vendorType,
      JSON.stringify(envVars),
      vendorId,
    );

  db()
    .prepare(`
      UPDATE endpoint_settings
      SET vendor_type = ?, updated_at = datetime('now')
      WHERE vendor_id = ?
    `)
    .run(vendorType, vendorId);

  const saved = getVendorSetting(vendorId);
  if (!saved) {
    throw new Error('保存端点设置失败');
  }

  return saved;
}
