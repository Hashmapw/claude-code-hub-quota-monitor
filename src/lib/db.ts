import postgres from 'postgres';
import { getConfig } from '@/lib/config';

export type DbEndpointRow = {
  id: number;
  name: string;
  url: string;
  key: string;
  consoleUrl: string | null;
  providerType: string | null;
  providerVendorId: number | null;
  isEnabled: boolean;
};

export type EndpointSourceStatus = {
  schema: string;
  table: string;
  rawRecordCount: number;
  readableRecordCount: number;
  tableCount: number;
  tables: Array<{
    name: string;
    rowCount: number;
    readableRecordCount: number;
  }>;
};

let sqlClient: postgres.Sql | null = null;

function normalizeIdentifier(value: string, fallback: string): string {
  const candidate = value.trim();
  if (!candidate) {
    return fallback;
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(candidate)) {
    return fallback;
  }
  return candidate;
}

function sql(): postgres.Sql {
  if (!sqlClient) {
    const config = getConfig();
    sqlClient = postgres(config.dsn, {
      max: 8,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return sqlClient;
}

function pickFirstString(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return '';
}

function pickNullableString(source: Record<string, unknown>, keys: string[]): string | null {
  const value = pickFirstString(source, keys);
  return value ? value : null;
}

function pickNullableNumber(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function pickEnabled(source: Record<string, unknown>): boolean {
  if (typeof source.is_enabled === 'boolean') {
    return source.is_enabled;
  }
  if (typeof source.enabled === 'boolean') {
    return source.enabled;
  }
  if (typeof source.is_enabled === 'number') {
    return source.is_enabled > 0;
  }
  if (typeof source.enabled === 'number') {
    return source.enabled > 0;
  }
  if (typeof source.is_enabled === 'string') {
    const value = source.is_enabled.toLowerCase();
    if (value === '1' || value === 'true' || value === 'yes') {
      return true;
    }
    if (value === '0' || value === 'false' || value === 'no') {
      return false;
    }
  }
  if (typeof source.enabled === 'string') {
    const value = source.enabled.toLowerCase();
    if (value === '1' || value === 'true' || value === 'yes') {
      return true;
    }
    if (value === '0' || value === 'false' || value === 'no') {
      return false;
    }
  }
  if (typeof source.status === 'string') {
    const value = source.status.toLowerCase();
    if (value === 'enabled' || value === 'active') {
      return true;
    }
    if (value === 'disabled' || value === 'inactive') {
      return false;
    }
  }
  return true;
}

function isDeleted(source: Record<string, unknown>): boolean {
  if (source.deleted_at !== null && source.deleted_at !== undefined) {
    return true;
  }
  if (typeof source.is_deleted === 'boolean') {
    return source.is_deleted;
  }
  if (typeof source.is_deleted === 'number') {
    return source.is_deleted > 0;
  }
  if (typeof source.is_deleted === 'string') {
    const value = source.is_deleted.toLowerCase();
    return value === '1' || value === 'true' || value === 'yes';
  }
  return false;
}

function normalizeUrlLike(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed).toString();
  } catch {
    return null;
  }
}

function deriveConsoleUrlFromRequest(url: string): string | null {
  const normalized = normalizeUrlLike(url);
  if (!normalized) {
    return null;
  }

  try {
    const parsed = new URL(normalized);
    const pathname = parsed.pathname.replace(/\/+$/, '');

    if (pathname.endsWith('/v1')) {
      parsed.pathname = pathname.slice(0, -3) || '/';
      return parsed.toString();
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeEndpointRow(row: Record<string, unknown>): DbEndpointRow | null {
  const id = Number(row.id);
  if (!Number.isFinite(id)) {
    return null;
  }

  const name = pickFirstString(row, ['name', 'provider_name', 'title']) || `provider-${id}`;

  const url = pickFirstString(row, ['url', 'base_url', 'api_base', 'api_url', 'endpoint']);
  const key = pickFirstString(row, ['key', 'api_key', 'token']);

  if (!url || !key) {
    return null;
  }

  const consoleUrl =
    normalizeUrlLike(
      pickFirstString(row, [
        'website_url',
        'website',
        'console_url',
        'dashboard_url',
        'manage_url',
        'home_url',
      ]),
    ) ?? deriveConsoleUrlFromRequest(url);

  return {
    id,
    name,
    url,
    key,
    consoleUrl,
    providerType: pickNullableString(row, ['provider_type', 'providerType', 'type']),
    providerVendorId: pickNullableNumber(row, ['provider_vendor_id', 'providerVendorId', 'vendor_id']),
    isEnabled: pickEnabled(row),
  };
}

function buildFromRows(rows: Array<Record<string, unknown>>): DbEndpointRow[] {
  const config = getConfig();
  const endpoints: DbEndpointRow[] = [];

  for (const row of rows) {
    if (isDeleted(row)) {
      continue;
    }
    const normalized = normalizeEndpointRow(row);
    if (!normalized) {
      continue;
    }
    if (!config.includeDisabled && !normalized.isEnabled) {
      continue;
    }
    endpoints.push(normalized);
  }

  return endpoints;
}

export async function listEndpoints(): Promise<DbEndpointRow[]> {
  const config = getConfig();
  const schema = normalizeIdentifier(config.schema, 'public');
  const table = normalizeIdentifier(config.table, 'providers');
  const rows = await sql().unsafe(`select * from "${schema}"."${table}" order by id asc`);

  return buildFromRows(rows as Array<Record<string, unknown>>);
}

export async function getEndpointSourceStatus(): Promise<EndpointSourceStatus> {
  const config = getConfig();
  const schema = normalizeIdentifier(config.schema, 'public');
  const table = normalizeIdentifier(config.table, 'providers');
  const rows = await sql().unsafe(`select * from "${schema}"."${table}" order by id asc`);
  const normalizedRows = buildFromRows(rows as Array<Record<string, unknown>>);

  return {
    schema,
    table,
    rawRecordCount: rows.length,
    readableRecordCount: normalizedRows.length,
    tableCount: 1,
    tables: [
      {
        name: `${schema}.${table}`,
        rowCount: rows.length,
        readableRecordCount: normalizedRows.length,
      },
    ],
  };
}

export async function getEndpointById(endpointId: number): Promise<DbEndpointRow | null> {
  if (!Number.isInteger(endpointId) || endpointId <= 0) {
    return null;
  }

  const config = getConfig();
  const schema = normalizeIdentifier(config.schema, 'public');
  const table = normalizeIdentifier(config.table, 'providers');
  const rows = await sql().unsafe(`select * from "${schema}"."${table}" where id = $1 limit 1`, [endpointId]);
  const list = buildFromRows(rows as Array<Record<string, unknown>>);
  return list[0] ?? null;
}
