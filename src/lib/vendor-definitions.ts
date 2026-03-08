import 'server-only';

import { DatabaseSync } from 'node:sqlite';
import { getSqliteConnection } from '@/lib/sqlite-connection';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StrategyQueryTarget =
  | 'amount'
  | 'token_usage'
  | 'reset_date'
  | 'identity'
  | 'compat_deprecated'
  | 'refresh';

export type StrategyDefinition = {
  name: string;
  priority: number;
  auth: 'bearer' | 'cookie' | 'url_key';
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  queryTarget?: StrategyQueryTarget;
  queryParams?: Record<string, string | number | boolean>;
  requestHeaders?: Record<string, string>;
  requestBody?: Record<string, unknown> | null;
  fields: {
    total?: string | null;
    used?: string | null;
    remaining?: string | null;
  };
  formulas: {
    total?: { type: 'direct' | 'divide'; divisor?: number } | null;
    used?: { type: 'direct' | 'divide'; divisor?: number } | null;
    remaining?: { type: 'direct' | 'divide'; divisor?: number } | null;
  };
  balanceCalc: 'remaining_direct' | 'total_minus_used' | 'fields_independent';
  refreshOnUnauth?: boolean;
  refreshPath?: string;
  refreshBodyTemplate?: Record<string, string>;
};

export type RegionMetricSlot =
  | 'vendor_remaining'
  | 'vendor_used'
  | 'endpoint_remaining'
  | 'endpoint_used'
  | 'endpoint_total';

export type RegionMiddleMode = 'none' | 'token_usage' | 'reset_date';
export type VendorEnvVarScope = 'vendor' | 'endpoint';
export type VendorRegionAggregateMode = 'independent_request' | 'endpoint_sum';
export type EndpointTotalMode = 'independent_request' | 'sum_from_parts' | 'manual_total';
export type EndpointMetricMode = 'independent_request' | 'subtract_from_total';
export type VendorApiKind = 'claude_code' | 'gemini' | 'codex' | 'unknown';

export type VendorEnvVarDefinition = {
  key: string;
  label: string;
  scope: VendorEnvVarScope;
  meaning?: string | null;
  optional?: boolean;
  defaultValue?: string | null;
};

type BaseUrlReplacementRule = {
  search: string;
  replace: string;
};

type RefreshResponseMapping = {
  field: string;
  envVarKey: string;
  formula?: { type: 'direct' | 'divide'; divisor?: number } | null;
};

type RequestRegionBase = {
  auth: StrategyDefinition['auth'];
  method: StrategyDefinition['method'];
  path: string;
  baseUrlReplacements?: BaseUrlReplacementRule[];
  queryParams?: Record<string, string | number | boolean>;
  requestHeaders?: Record<string, string>;
  requestBody?: Record<string, unknown> | null;
  autoHandle403Intercept?: boolean;
  refreshOnUnauth?: boolean;
  refreshPath?: string;
  refreshBodyTemplate?: Record<string, string>;
  refreshResponseMappings?: RefreshResponseMapping[];
};

export type RegionMetricConfig = RequestRegionBase & {
  field?: string | null;
  formula?: { type: 'direct' | 'divide'; divisor?: number } | null;
};

export type RegionTokenUsageConfig = RequestRegionBase & {
  usedField?: string | null;
  remainingField?: string | null;
  usedFormula?: { type: 'direct' | 'divide'; divisor?: number } | null;
  remainingFormula?: { type: 'direct' | 'divide'; divisor?: number } | null;
};

export type RegionResetDateConfig = RequestRegionBase & {
  resetField?: string | null;
};

export type RegionDailyCheckinConfig = RequestRegionBase & {
  dateField?: string | null;
  awardedField?: string | null;
  awardedFormula?: { type: 'direct' | 'divide'; divisor?: number } | null;
};

export type VendorRegionConfig = {
  version: 1;
  endpointTotalMode: EndpointTotalMode;
  refreshTokenEnabled: boolean;
  refreshToken: RequestRegionBase | null;
  dailyCheckinEnabled: boolean;
  dailyCheckin: RegionDailyCheckinConfig | null;
  endpointMetricModes: {
    endpoint_remaining: EndpointMetricMode;
    endpoint_used: EndpointMetricMode;
  };
  aggregation: {
    vendor_remaining: VendorRegionAggregateMode;
    vendor_used: VendorRegionAggregateMode;
  };
  regions: {
    vendor_remaining: RegionMetricConfig | null;
    vendor_used: RegionMetricConfig | null;
    endpoint_remaining: RegionMetricConfig | null;
    endpoint_used: RegionMetricConfig | null;
    endpoint_total: RegionMetricConfig | null;
  };
  middle: {
    mode: RegionMiddleMode;
    token_usage: RegionTokenUsageConfig | null;
    reset_date: RegionResetDateConfig | null;
  };
};

export type VendorDefinition = {
  id: number;
  vendorType: string;
  displayName: string;
  description: string | null;
  strategies: StrategyDefinition[];
  regionConfig: VendorRegionConfig;
  envVars: VendorEnvVarDefinition[];
  createdAt: string;
  updatedAt: string;
};

type VendorDefinitionRow = {
  id: number;
  vendor_type: string;
  display_name: string;
  description: string | null;
  region_config_json: string | null;
  env_vars_json: string | null;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

type StrategyFormula = { type: 'direct' | 'divide'; divisor?: number } | null;

type StrategyFormulaBag = {
  total?: StrategyFormula;
  used?: StrategyFormula;
  remaining?: StrategyFormula;
};

const VALID_AUTH = new Set<StrategyDefinition['auth']>(['bearer', 'cookie', 'url_key']);
const VALID_METHOD = new Set<StrategyDefinition['method']>(['GET', 'POST', 'PUT']);
const VALID_BALANCE_CALC = new Set<StrategyDefinition['balanceCalc']>([
  'remaining_direct',
  'total_minus_used',
  'fields_independent',
]);

const VALID_QUERY_TARGET = new Set<StrategyQueryTarget>([
  'amount',
  'token_usage',
  'reset_date',
  'identity',
  'compat_deprecated',
  'refresh',
]);
const VALID_ENV_SCOPE = new Set<VendorEnvVarScope>(['vendor', 'endpoint']);
const VALID_REGION_AGGREGATE_MODE = new Set<VendorRegionAggregateMode>([
  'independent_request',
  'endpoint_sum',
]);
const VALID_ENDPOINT_TOTAL_MODE = new Set<EndpointTotalMode>([
  'independent_request',
  'sum_from_parts',
  'manual_total',
]);
const VALID_ENDPOINT_METRIC_MODE = new Set<EndpointMetricMode>([
  'independent_request',
  'subtract_from_total',
]);

function normalizeText(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeEnvVarKey(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${field} 必须为字符串`);
  }
  const raw = value.trim().replace(/^\$+/, '');
  if (!raw) {
    throw new Error(`${field} 不能为空`);
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(raw)) {
    throw new Error(`${field} 仅支持英文、数字、下划线，且不能以数字开头`);
  }
  return raw;
}

function normalizeEnvVarDefinitions(input: unknown): VendorEnvVarDefinition[] {
  if (!input) return [];
  if (!Array.isArray(input)) {
    throw new Error('envVars 必须为数组');
  }

  const result: VendorEnvVarDefinition[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < input.length; i += 1) {
    const row = input[i];
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`envVars[${i}] 必须为对象`);
    }
    const source = row as Record<string, unknown>;
    const key = normalizeEnvVarKey(source.key, `envVars[${i}].key`);
    const label = normalizeText(typeof source.label === 'string' ? source.label : String(source.label ?? ''));
    if (!label) {
      throw new Error(`envVars[${i}].label 不能为空`);
    }
    const rawScope = String(source.scope ?? 'endpoint').trim().toLowerCase();
    if (!VALID_ENV_SCOPE.has(rawScope as VendorEnvVarScope)) {
      throw new Error(`envVars[${i}].scope 仅支持 vendor/endpoint`);
    }
    let meaning: string | null = null;
    if (source.meaning !== undefined && source.meaning !== null) {
      if (typeof source.meaning !== 'string') {
        throw new Error(`envVars[${i}].meaning 必须为字符串`);
      }
      meaning = normalizeText(source.meaning);
    }
    const optional = source.optional === true;
    let defaultValue: string | null = null;
    if (source.defaultValue !== undefined && source.defaultValue !== null) {
      if (typeof source.defaultValue !== 'string') {
        throw new Error(`envVars[${i}].defaultValue 必须为字符串`);
      }
      defaultValue = normalizeText(source.defaultValue);
    }
    const lowered = key.toLowerCase();
    if (seen.has(lowered)) {
      throw new Error(`环境变量重复: ${key}`);
    }
    seen.add(lowered);
    result.push({
      key,
      label,
      scope: rawScope as VendorEnvVarScope,
      meaning,
      optional,
      defaultValue,
    });
  }
  return result;
}

function ensureValidPath(path: string, field: string): string {
  const normalized = (path || '').trim();
  if (!normalized) {
    throw new Error(`${field} 不能为空`);
  }
  if (!normalized.startsWith('/')) {
    throw new Error(`${field} 必须以 / 开头`);
  }
  if (normalized.includes('://')) {
    throw new Error(`${field} 不能包含协议前缀`);
  }
  return normalized;
}

function normalizeFieldPath(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    throw new Error(`${field} 必须为字符串`);
  }
  const normalized = value.trim();
  if (!normalized) return null;
  // Supports dot path and array index, e.g. data.items[0].value
  if (!/^[A-Za-z0-9_]+(?:\[[0-9]+\])?(?:\.[A-Za-z0-9_]+(?:\[[0-9]+\])?)*$/.test(normalized)) {
    throw new Error(`${field} 格式无效`);
  }
  return normalized;
}

function normalizeFormula(
  formula: unknown,
  field: string,
): { type: 'direct' | 'divide'; divisor?: number } | null {
  if (formula === null || formula === undefined) {
    return null;
  }
  if (typeof formula !== 'object') {
    throw new Error(`${field} 必须为对象或 null`);
  }

  const raw = formula as Record<string, unknown>;
  const type = raw.type;
  if (type !== 'direct' && type !== 'divide') {
    throw new Error(`${field}.type 仅支持 direct 或 divide`);
  }

  if (type === 'direct') {
    return { type: 'direct' };
  }

  const divisorRaw = raw.divisor;
  const divisor =
    typeof divisorRaw === 'number'
      ? divisorRaw
      : typeof divisorRaw === 'string'
        ? Number(divisorRaw)
        : NaN;

  if (!Number.isFinite(divisor) || divisor <= 0) {
    throw new Error(`${field}.divisor 必须是大于 0 的数字`);
  }

  return { type: 'divide', divisor };
}

function normalizeFormulaBag(formulas: unknown): StrategyFormulaBag {
  if (!formulas || typeof formulas !== 'object') {
    return {};
  }

  const source = formulas as Record<string, unknown>;
  return {
    total: normalizeFormula(source.total, 'formulas.total'),
    used: normalizeFormula(source.used, 'formulas.used'),
    remaining: normalizeFormula(source.remaining, 'formulas.remaining'),
  };
}

function normalizeRequestBody(value: unknown): Record<string, unknown> | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('requestBody 必须为对象或 null');
  }
  return value as Record<string, unknown>;
}

function normalizeQueryParams(value: unknown): Record<string, string | number | boolean> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('queryParams 必须为对象');
  }

  const result: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = k.trim();
    if (!key) {
      throw new Error('queryParams 的参数名不能为空');
    }

    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      result[key] = v;
      continue;
    }

    throw new Error(`queryParams.${key} 仅支持 string/number/boolean`);
  }
  return result;
}

function normalizeRequestHeaders(value: unknown): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('requestHeaders 必须为对象');
  }

  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = k.trim();
    if (!key) {
      throw new Error('requestHeaders 的参数名不能为空');
    }
    if (typeof v !== 'string') {
      throw new Error(`requestHeaders.${key} 必须为字符串`);
    }
    result[key] = v;
  }
  return result;
}

function normalizeRefreshBodyTemplate(value: unknown): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('refreshBodyTemplate 必须为对象');
  }

  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v !== 'string') {
      throw new Error(`refreshBodyTemplate.${k} 必须为字符串`);
    }
    result[k] = v;
  }
  return result;
}

function normalizeRefreshResponseMappings(value: unknown): RefreshResponseMapping[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new Error('refreshResponseMappings 必须为数组');
  }

  const result: RefreshResponseMapping[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const raw = value[i];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`refreshResponseMappings[${i}] 必须为对象`);
    }
    const source = raw as Record<string, unknown>;
    const fieldPath = normalizeFieldPath(source.field, `refreshResponseMappings[${i}].field`);
    if (!fieldPath) {
      throw new Error(`refreshResponseMappings[${i}].field 不能为空`);
    }
    const envVarKey = normalizeEnvVarKey(source.envVarKey, `refreshResponseMappings[${i}].envVarKey`);
    result.push({
      field: fieldPath,
      envVarKey,
      formula: normalizeFormula(source.formula, `refreshResponseMappings[${i}].formula`),
    });
  }

  return result.length > 0 ? result : undefined;
}

function normalizeBaseUrlReplacements(value: unknown): BaseUrlReplacementRule[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new Error('baseUrlReplacements 必须为数组');
  }

  const result: BaseUrlReplacementRule[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const raw = value[i];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`baseUrlReplacements[${i}] 必须为对象`);
    }
    const source = raw as Record<string, unknown>;
    const search = normalizeText(String(source.search ?? ''));
    if (!search) {
      throw new Error(`baseUrlReplacements[${i}].search 不能为空`);
    }
    const replace = source.replace === undefined || source.replace === null
      ? ''
      : String(source.replace);
    result.push({ search, replace });
  }
  return result.length > 0 ? result : undefined;
}

function normalizeStrategy(raw: unknown, index: number): StrategyDefinition {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`strategies[${index}] 必须是对象`);
  }

  const strategy = raw as Record<string, unknown>;
  const name = normalizeText(String(strategy.name ?? ''));
  if (!name) {
    throw new Error(`strategies[${index}].name 不能为空`);
  }

  const priorityRaw =
    typeof strategy.priority === 'number'
      ? strategy.priority
      : typeof strategy.priority === 'string'
        ? Number(strategy.priority)
        : NaN;
  const priority = Math.trunc(priorityRaw);
  if (!Number.isFinite(priorityRaw) || priority <= 0) {
    throw new Error(`strategies[${index}].priority 必须是正整数`);
  }

  const auth = String(strategy.auth ?? '');
  if (!VALID_AUTH.has(auth as StrategyDefinition['auth'])) {
    throw new Error(`strategies[${index}].auth 仅支持 bearer/cookie/url_key`);
  }

  const method = String(strategy.method ?? '').toUpperCase();
  if (!VALID_METHOD.has(method as StrategyDefinition['method'])) {
    throw new Error(`strategies[${index}].method 仅支持 GET/POST/PUT`);
  }

  const path = ensureValidPath(String(strategy.path ?? ''), `strategies[${index}].path`);

  const rawQueryTarget = strategy.queryTarget;
  let queryTarget: StrategyQueryTarget | undefined;
  if (rawQueryTarget !== undefined && rawQueryTarget !== null && rawQueryTarget !== '') {
    if (typeof rawQueryTarget !== 'string' || !VALID_QUERY_TARGET.has(rawQueryTarget as StrategyQueryTarget)) {
      throw new Error(`strategies[${index}].queryTarget 无效`);
    }
    queryTarget = rawQueryTarget as StrategyQueryTarget;
  }

  const fieldsRaw =
    strategy.fields && typeof strategy.fields === 'object'
      ? (strategy.fields as Record<string, unknown>)
      : {};

  const fields = {
    total: normalizeFieldPath(fieldsRaw.total, `strategies[${index}].fields.total`),
    used: normalizeFieldPath(fieldsRaw.used, `strategies[${index}].fields.used`),
    remaining: normalizeFieldPath(fieldsRaw.remaining, `strategies[${index}].fields.remaining`),
  };

  const formulas = normalizeFormulaBag(strategy.formulas);

  const balanceCalc = String(strategy.balanceCalc ?? '');
  if (!VALID_BALANCE_CALC.has(balanceCalc as StrategyDefinition['balanceCalc'])) {
    throw new Error(`strategies[${index}].balanceCalc 无效`);
  }

  const refreshOnUnauth = Boolean(strategy.refreshOnUnauth);
  const refreshPath =
    strategy.refreshPath === undefined || strategy.refreshPath === null
      ? undefined
      : ensureValidPath(String(strategy.refreshPath), `strategies[${index}].refreshPath`);

  const requestBody = normalizeRequestBody(strategy.requestBody);
  const queryParams = normalizeQueryParams(strategy.queryParams);
  const requestHeaders = normalizeRequestHeaders(strategy.requestHeaders);
  const refreshBodyTemplate = normalizeRefreshBodyTemplate(strategy.refreshBodyTemplate);

  return {
    name,
    priority,
    auth: auth as StrategyDefinition['auth'],
    method: method as StrategyDefinition['method'],
    path,
    ...(queryTarget ? { queryTarget } : {}),
    ...(queryParams ? { queryParams } : {}),
    ...(requestHeaders ? { requestHeaders } : {}),
    ...(requestBody !== undefined ? { requestBody } : {}),
    fields,
    formulas,
    balanceCalc: balanceCalc as StrategyDefinition['balanceCalc'],
    ...(refreshOnUnauth ? { refreshOnUnauth: true } : {}),
    ...(refreshPath ? { refreshPath } : {}),
    ...(refreshBodyTemplate ? { refreshBodyTemplate } : {}),
  };
}

function normalizeStrategies(input: unknown): StrategyDefinition[] {
  if (!Array.isArray(input)) {
    throw new Error('strategies 必须为数组');
  }

  const normalized = input.map((item, index) => normalizeStrategy(item, index));
  const nameSet = new Set<string>();
  for (const strategy of normalized) {
    const lowered = strategy.name.toLowerCase();
    if (nameSet.has(lowered)) {
      throw new Error(`策略名称重复: ${strategy.name}`);
    }
    nameSet.add(lowered);
  }

  return normalized;
}

function toRequestRegionBase(strategy: StrategyDefinition): RequestRegionBase {
  return {
    auth: strategy.auth,
    method: strategy.method,
    path: strategy.path,
    ...(strategy.queryParams ? { queryParams: { ...strategy.queryParams } } : {}),
    ...(strategy.requestHeaders ? { requestHeaders: { ...strategy.requestHeaders } } : {}),
    ...(strategy.requestBody !== undefined ? { requestBody: strategy.requestBody } : {}),
    autoHandle403Intercept: true,
    ...(strategy.refreshOnUnauth ? { refreshOnUnauth: true } : {}),
    ...(strategy.refreshPath ? { refreshPath: strategy.refreshPath } : {}),
    ...(strategy.refreshBodyTemplate ? { refreshBodyTemplate: { ...strategy.refreshBodyTemplate } } : {}),
  };
}

function normalizeRequestRegionBase(
  raw: unknown,
  field: string,
): RequestRegionBase {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${field} 必须为对象`);
  }

  const source = raw as Record<string, unknown>;
  const auth = String(source.auth ?? '');
  if (!VALID_AUTH.has(auth as StrategyDefinition['auth'])) {
    throw new Error(`${field}.auth 仅支持 bearer/cookie/url_key`);
  }

  const method = String(source.method ?? '').toUpperCase();
  if (!VALID_METHOD.has(method as StrategyDefinition['method'])) {
    throw new Error(`${field}.method 仅支持 GET/POST/PUT`);
  }

  const path = ensureValidPath(String(source.path ?? ''), `${field}.path`);
  const autoHandle403Intercept = source.autoHandle403Intercept !== false;
  const refreshOnUnauth = Boolean(source.refreshOnUnauth);
  const refreshPath =
    source.refreshPath === undefined || source.refreshPath === null
      ? undefined
      : ensureValidPath(String(source.refreshPath), `${field}.refreshPath`);
  const queryParams = normalizeQueryParams(source.queryParams);
  const requestHeaders = normalizeRequestHeaders(source.requestHeaders);
  const requestBody = normalizeRequestBody(source.requestBody);
  const refreshBodyTemplate = normalizeRefreshBodyTemplate(source.refreshBodyTemplate);
  const refreshResponseMappings = normalizeRefreshResponseMappings(source.refreshResponseMappings);
  const baseUrlReplacements = normalizeBaseUrlReplacements(source.baseUrlReplacements);

  return {
    auth: auth as StrategyDefinition['auth'],
    method: method as StrategyDefinition['method'],
    path,
    ...(baseUrlReplacements ? { baseUrlReplacements } : {}),
    ...(queryParams ? { queryParams } : {}),
    ...(requestHeaders ? { requestHeaders } : {}),
    ...(requestBody !== undefined ? { requestBody } : {}),
    autoHandle403Intercept,
    ...(refreshOnUnauth ? { refreshOnUnauth: true } : {}),
    ...(refreshPath ? { refreshPath } : {}),
    ...(refreshBodyTemplate ? { refreshBodyTemplate } : {}),
    ...(refreshResponseMappings ? { refreshResponseMappings } : {}),
  };
}

function normalizeRegionMetricConfig(raw: unknown, field: string): RegionMetricConfig | null {
  if (raw === null || raw === undefined) return null;
  const source = raw as Record<string, unknown>;
  const base = normalizeRequestRegionBase(raw, field);
  return {
    ...base,
    field: normalizeFieldPath(source.field, `${field}.field`),
    formula: normalizeFormula(source.formula, `${field}.formula`),
  };
}

function normalizeRegionTokenUsageConfig(raw: unknown, field: string): RegionTokenUsageConfig | null {
  if (raw === null || raw === undefined) return null;
  const source = raw as Record<string, unknown>;
  const base = normalizeRequestRegionBase(raw, field);
  return {
    ...base,
    usedField: normalizeFieldPath(source.usedField, `${field}.usedField`),
    remainingField: normalizeFieldPath(source.remainingField, `${field}.remainingField`),
    usedFormula: normalizeFormula(source.usedFormula, `${field}.usedFormula`),
    remainingFormula: normalizeFormula(source.remainingFormula, `${field}.remainingFormula`),
  };
}

function normalizeRegionResetDateConfig(raw: unknown, field: string): RegionResetDateConfig | null {
  if (raw === null || raw === undefined) return null;
  const source = raw as Record<string, unknown>;
  const base = normalizeRequestRegionBase(raw, field);
  return {
    ...base,
    resetField: normalizeFieldPath(source.resetField, `${field}.resetField`),
  };
}

function normalizeRegionDailyCheckinConfig(raw: unknown, field: string): RegionDailyCheckinConfig | null {
  if (raw === null || raw === undefined) return null;
  const source = raw as Record<string, unknown>;
  const base = normalizeRequestRegionBase(raw, field);
  return {
    ...base,
    dateField: normalizeFieldPath(source.dateField, `${field}.dateField`),
    awardedField: normalizeFieldPath(source.awardedField, `${field}.awardedField`),
    awardedFormula: normalizeFormula(source.awardedFormula, `${field}.awardedFormula`),
  };
}

function syncRegionRefreshFromGlobal(config: VendorRegionConfig): VendorRegionConfig {
  return config;
}

function toMetricRegionFromAmount(
  strategy: StrategyDefinition | null,
  fieldKey: 'total' | 'used' | 'remaining',
): RegionMetricConfig | null {
  if (!strategy) return null;
  return {
    ...toRequestRegionBase(strategy),
    field: strategy.fields[fieldKey] ?? null,
    formula: strategy.formulas[fieldKey] ?? null,
  };
}

function toTokenUsageRegion(strategy: StrategyDefinition | null): RegionTokenUsageConfig | null {
  if (!strategy) return null;
  return {
    ...toRequestRegionBase(strategy),
    usedField: strategy.fields.used ?? null,
    remainingField: strategy.fields.remaining ?? null,
    usedFormula: strategy.formulas.used ?? null,
    remainingFormula: strategy.formulas.remaining ?? null,
  };
}

function toResetDateRegion(strategy: StrategyDefinition | null): RegionResetDateConfig | null {
  if (!strategy) return null;
  return {
    ...toRequestRegionBase(strategy),
    resetField: strategy.fields.remaining ?? strategy.fields.total ?? strategy.fields.used ?? null,
  };
}

function buildRegionConfigFromStrategies(strategies: StrategyDefinition[]): VendorRegionConfig {
  const ordered = [...strategies].sort((a, b) => a.priority - b.priority);
  const amount =
    ordered.find((strategy) => !strategy.queryTarget || strategy.queryTarget === 'amount') ??
    ordered[0] ??
    null;
  const tokenUsage = ordered.find((strategy) => strategy.queryTarget === 'token_usage') ?? null;
  const resetDate = ordered.find((strategy) => strategy.queryTarget === 'reset_date') ?? null;
  const mode: RegionMiddleMode = tokenUsage ? 'token_usage' : resetDate ? 'reset_date' : 'none';
  const refreshSource = ordered.find((strategy) => Boolean(strategy.refreshPath)) ?? null;

  return syncRegionRefreshFromGlobal({
    version: 1,
    endpointTotalMode: 'independent_request',
    refreshTokenEnabled: true,
    refreshToken: refreshSource?.refreshPath
      ? {
          auth: refreshSource.auth,
          method: 'POST',
          path: refreshSource.refreshPath,
          ...(refreshSource.requestHeaders ? { requestHeaders: { ...refreshSource.requestHeaders } } : {}),
          ...(refreshSource.refreshBodyTemplate ? { requestBody: { ...refreshSource.refreshBodyTemplate } } : {}),
          refreshResponseMappings: [
            { field: 'access_token', envVarKey: 'AccessToken', formula: { type: 'direct' } },
            { field: 'refresh_token', envVarKey: 'RefreshToken', formula: { type: 'direct' } },
          ],
          autoHandle403Intercept: true,
        }
      : null,
    dailyCheckinEnabled: false,
    dailyCheckin: null,
    endpointMetricModes: {
      endpoint_remaining: 'independent_request',
      endpoint_used: 'independent_request',
    },
    aggregation: {
      vendor_remaining: 'independent_request',
      vendor_used: 'endpoint_sum',
    },
    regions: {
      vendor_remaining: toMetricRegionFromAmount(amount, 'remaining'),
      vendor_used: toMetricRegionFromAmount(amount, 'used'),
      endpoint_remaining: toMetricRegionFromAmount(amount, 'remaining'),
      endpoint_used: toMetricRegionFromAmount(amount, 'used'),
      endpoint_total: toMetricRegionFromAmount(amount, 'total'),
    },
    middle: {
      mode,
      token_usage: toTokenUsageRegion(tokenUsage),
      reset_date: toResetDateRegion(resetDate),
    },
  });
}

function createAmountStrategy(
  name: string,
  priority: number,
  request: RegionMetricConfig,
  fieldKey: 'total' | 'used' | 'remaining',
): StrategyDefinition {
  const fields: StrategyDefinition['fields'] = { total: null, used: null, remaining: null };
  const formulas: StrategyDefinition['formulas'] = { total: null, used: null, remaining: null };
  fields[fieldKey] = request.field ?? null;
  formulas[fieldKey] = request.formula ?? null;
  return {
    name,
    priority,
    auth: request.auth,
    method: request.method,
    path: request.path,
    queryTarget: 'amount',
    ...(request.queryParams ? { queryParams: { ...request.queryParams } } : {}),
    ...(request.requestHeaders ? { requestHeaders: { ...request.requestHeaders } } : {}),
    ...(request.requestBody !== undefined ? { requestBody: request.requestBody } : {}),
    fields,
    formulas,
    balanceCalc: fieldKey === 'remaining' ? 'remaining_direct' : 'fields_independent',
    ...(request.refreshOnUnauth ? { refreshOnUnauth: true } : {}),
    ...(request.refreshPath ? { refreshPath: request.refreshPath } : {}),
    ...(request.refreshBodyTemplate ? { refreshBodyTemplate: { ...request.refreshBodyTemplate } } : {}),
  };
}

function buildStrategiesFromRegionConfig(regionConfig: VendorRegionConfig): StrategyDefinition[] {
  const strategies: StrategyDefinition[] = [];
  let priority = 1;
  const endpointTotalMode = regionConfig.endpointTotalMode;
  const endpointRemainingMode = regionConfig.endpointMetricModes?.endpoint_remaining ?? 'independent_request';
  const endpointUsedMode = regionConfig.endpointMetricModes?.endpoint_used ?? 'independent_request';
  const pushAmount = (name: string, request: RegionMetricConfig | null, fieldKey: 'total' | 'used' | 'remaining') => {
    if (!request) return;
    strategies.push(createAmountStrategy(name, priority++, request, fieldKey));
  };

  pushAmount('Region-Vendor-Remaining', regionConfig.regions.vendor_remaining, 'remaining');
  pushAmount('Region-Vendor-Used', regionConfig.regions.vendor_used, 'used');
  if (endpointRemainingMode === 'independent_request') {
    pushAmount('Region-Endpoint-Remaining', regionConfig.regions.endpoint_remaining, 'remaining');
  }
  if (endpointUsedMode === 'independent_request') {
    pushAmount('Region-Endpoint-Used', regionConfig.regions.endpoint_used, 'used');
  }
  if (endpointTotalMode === 'independent_request') {
    pushAmount('Region-Endpoint-Total', regionConfig.regions.endpoint_total, 'total');
  }

  if (regionConfig.middle.mode === 'token_usage' && regionConfig.middle.token_usage) {
    const token = regionConfig.middle.token_usage;
    strategies.push({
      name: 'Region-Middle-TokenUsage',
      priority: priority++,
      auth: token.auth,
      method: token.method,
      path: token.path,
      queryTarget: 'token_usage',
      ...(token.queryParams ? { queryParams: { ...token.queryParams } } : {}),
      ...(token.requestHeaders ? { requestHeaders: { ...token.requestHeaders } } : {}),
      ...(token.requestBody !== undefined ? { requestBody: token.requestBody } : {}),
      fields: {
        total: null,
        used: token.usedField ?? null,
        remaining: token.remainingField ?? null,
      },
      formulas: {
        total: null,
        used: token.usedFormula ?? null,
        remaining: token.remainingFormula ?? null,
      },
      balanceCalc: 'fields_independent',
      ...(token.refreshOnUnauth ? { refreshOnUnauth: true } : {}),
      ...(token.refreshPath ? { refreshPath: token.refreshPath } : {}),
      ...(token.refreshBodyTemplate ? { refreshBodyTemplate: { ...token.refreshBodyTemplate } } : {}),
    });
  }

  if (regionConfig.middle.mode === 'reset_date' && regionConfig.middle.reset_date) {
    const reset = regionConfig.middle.reset_date;
    strategies.push({
      name: 'Region-Middle-ResetDate',
      priority: priority++,
      auth: reset.auth,
      method: reset.method,
      path: reset.path,
      queryTarget: 'reset_date',
      ...(reset.queryParams ? { queryParams: { ...reset.queryParams } } : {}),
      ...(reset.requestHeaders ? { requestHeaders: { ...reset.requestHeaders } } : {}),
      ...(reset.requestBody !== undefined ? { requestBody: reset.requestBody } : {}),
      fields: {
        total: null,
        used: null,
        remaining: reset.resetField ?? null,
      },
      formulas: {
        total: null,
        used: null,
        remaining: null,
      },
      balanceCalc: 'fields_independent',
      ...(reset.refreshOnUnauth ? { refreshOnUnauth: true } : {}),
      ...(reset.refreshPath ? { refreshPath: reset.refreshPath } : {}),
      ...(reset.refreshBodyTemplate ? { refreshBodyTemplate: { ...reset.refreshBodyTemplate } } : {}),
    });
  }

  if (strategies.length === 0) {
    throw new Error('regionConfig 未配置任何可执行区域请求');
  }

  return normalizeStrategies(strategies);
}

function normalizeRegionConfig(input: unknown): VendorRegionConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('regionConfig 必须为对象');
  }

  const source = input as Record<string, unknown>;
  const rawRegions = source.regions;
  const rawMiddle = source.middle;
  const rawAggregation = source.aggregation;

  if (!rawRegions || typeof rawRegions !== 'object' || Array.isArray(rawRegions)) {
    throw new Error('regionConfig.regions 必须为对象');
  }
  if (!rawMiddle || typeof rawMiddle !== 'object' || Array.isArray(rawMiddle)) {
    throw new Error('regionConfig.middle 必须为对象');
  }
  if (!rawAggregation || typeof rawAggregation !== 'object' || Array.isArray(rawAggregation)) {
    throw new Error('regionConfig.aggregation 必须为对象');
  }

  const regions = rawRegions as Record<string, unknown>;
  const middle = rawMiddle as Record<string, unknown>;
  const aggregationSource = rawAggregation as Record<string, unknown>;

  const vendorRemainingRaw = String(aggregationSource.vendor_remaining ?? '').trim().toLowerCase();
  const vendorUsedRaw = String(aggregationSource.vendor_used ?? '').trim().toLowerCase();
  if (!VALID_REGION_AGGREGATE_MODE.has(vendorRemainingRaw as VendorRegionAggregateMode)) {
    throw new Error('regionConfig.aggregation.vendor_remaining 无效');
  }
  if (!VALID_REGION_AGGREGATE_MODE.has(vendorUsedRaw as VendorRegionAggregateMode)) {
    throw new Error('regionConfig.aggregation.vendor_used 无效');
  }

  const rawMode = String(middle.mode ?? '').trim();
  if (rawMode !== 'token_usage' && rawMode !== 'reset_date' && rawMode !== 'none') {
    throw new Error('regionConfig.middle.mode 无效');
  }

  const rawEndpointTotalMode = String(source.endpointTotalMode ?? '').trim().toLowerCase();
  if (!VALID_ENDPOINT_TOTAL_MODE.has(rawEndpointTotalMode as EndpointTotalMode)) {
    throw new Error('regionConfig.endpointTotalMode 无效');
  }
  const rawEndpointMetricModes = source.endpointMetricModes;
  const endpointMetricModesSource =
    rawEndpointMetricModes && typeof rawEndpointMetricModes === 'object' && !Array.isArray(rawEndpointMetricModes)
      ? (rawEndpointMetricModes as Record<string, unknown>)
      : {};
  const endpointRemainingModeRaw = String(endpointMetricModesSource.endpoint_remaining ?? 'independent_request').trim().toLowerCase();
  const endpointUsedModeRaw = String(endpointMetricModesSource.endpoint_used ?? 'independent_request').trim().toLowerCase();
  if (!VALID_ENDPOINT_METRIC_MODE.has(endpointRemainingModeRaw as EndpointMetricMode)) {
    throw new Error('regionConfig.endpointMetricModes.endpoint_remaining 无效');
  }
  if (!VALID_ENDPOINT_METRIC_MODE.has(endpointUsedModeRaw as EndpointMetricMode)) {
    throw new Error('regionConfig.endpointMetricModes.endpoint_used 无效');
  }
  if (
    endpointRemainingModeRaw === 'subtract_from_total'
    && endpointUsedModeRaw === 'subtract_from_total'
  ) {
    throw new Error('端点余额与端点已用不能同时设置为减法计算');
  }
  if (
    rawEndpointTotalMode === 'sum_from_parts'
    && (endpointRemainingModeRaw === 'subtract_from_total' || endpointUsedModeRaw === 'subtract_from_total')
  ) {
    throw new Error('端点总额为加和计算时，端点余额/端点已用不能使用减法计算');
  }
  const refreshToken =
    source.refreshToken === null || source.refreshToken === undefined
      ? null
      : normalizeRequestRegionBase(source.refreshToken, 'regionConfig.refreshToken');
  const refreshTokenEnabled = source.refreshTokenEnabled !== false;
  const dailyCheckin =
    source.dailyCheckin === null || source.dailyCheckin === undefined
      ? null
      : normalizeRegionDailyCheckinConfig(source.dailyCheckin, 'regionConfig.dailyCheckin');
  const dailyCheckinEnabled = source.dailyCheckinEnabled === true;
  return syncRegionRefreshFromGlobal({
    version: 1,
    endpointTotalMode: rawEndpointTotalMode as EndpointTotalMode,
    refreshTokenEnabled,
    refreshToken,
    dailyCheckinEnabled,
    dailyCheckin,
    endpointMetricModes: {
      endpoint_remaining: endpointRemainingModeRaw as EndpointMetricMode,
      endpoint_used: endpointUsedModeRaw as EndpointMetricMode,
    },
    aggregation: {
      vendor_remaining: vendorRemainingRaw as VendorRegionAggregateMode,
      vendor_used: vendorUsedRaw as VendorRegionAggregateMode,
    },
    regions: {
      vendor_remaining: normalizeRegionMetricConfig(regions.vendor_remaining, 'regionConfig.regions.vendor_remaining'),
      vendor_used: normalizeRegionMetricConfig(regions.vendor_used, 'regionConfig.regions.vendor_used'),
      endpoint_remaining: normalizeRegionMetricConfig(regions.endpoint_remaining, 'regionConfig.regions.endpoint_remaining'),
      endpoint_used: normalizeRegionMetricConfig(regions.endpoint_used, 'regionConfig.regions.endpoint_used'),
      endpoint_total: normalizeRegionMetricConfig(regions.endpoint_total, 'regionConfig.regions.endpoint_total'),
    },
    middle: {
      mode: rawMode as RegionMiddleMode,
      token_usage: normalizeRegionTokenUsageConfig(middle.token_usage, 'regionConfig.middle.token_usage'),
      reset_date: normalizeRegionResetDateConfig(middle.reset_date, 'regionConfig.middle.reset_date'),
    },
  });
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

let dbInstance: DatabaseSync | null = null;
let tableInitialized = false;

function normalizeRegionConfigFromStoredRow(row: Pick<VendorDefinitionRow, 'vendor_type' | 'region_config_json'>): VendorRegionConfig {
  let parsedRegionRaw: unknown = {};
  try {
    parsedRegionRaw = JSON.parse(row.region_config_json || '{}') as unknown;
  } catch {
    throw new Error(`vendor_type=${row.vendor_type} 的 region_config_json 不是合法 JSON`);
  }
  return normalizeRegionConfig(parsedRegionRaw);
}

function db(): DatabaseSync {
  if (dbInstance) return dbInstance;
  dbInstance = getSqliteConnection();
  if (!tableInitialized) {
    ensureVendorDefinitionsTable(dbInstance);
    tableInitialized = true;
  }
  return dbInstance;
}

export function ensureVendorDefinitionsTable(conn: DatabaseSync): void {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS vendor_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_type TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      description TEXT,
      region_config_json TEXT NOT NULL DEFAULT '{}',
      env_vars_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function mapRow(row: VendorDefinitionRow): VendorDefinition {
  const regionConfig = normalizeRegionConfigFromStoredRow(row);
  const strategies = buildStrategiesFromRegionConfig(regionConfig);

  const envVars = normalizeEnvVarDefinitions(
    row.env_vars_json ? (JSON.parse(row.env_vars_json) as unknown) : [],
  );
  return {
    id: Number(row.id),
    vendorType: String(row.vendor_type),
    displayName: String(row.display_name),
    description: row.description ? String(row.description) : null,
    strategies,
    regionConfig,
    envVars,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function listVendorDefinitions(): VendorDefinition[] {
  const rows = db()
    .prepare('SELECT * FROM vendor_definitions ORDER BY vendor_type ASC')
    .all() as VendorDefinitionRow[];
  return rows.map(mapRow);
}

export function getVendorDefinition(vendorType: string): VendorDefinition | null {
  const normalized = (vendorType || '').trim().toLowerCase();
  if (!normalized) return null;
  const row = db()
    .prepare('SELECT * FROM vendor_definitions WHERE vendor_type = ? COLLATE NOCASE LIMIT 1')
    .get(normalized) as VendorDefinitionRow | undefined;
  return row ? mapRow(row) : null;
}

export function upsertVendorDefinition(input: {
  vendorType: string;
  displayName: string;
  description?: string | null;
  strategies?: StrategyDefinition[] | null;
  regionConfig?: VendorRegionConfig | null;
  envVars?: VendorEnvVarDefinition[] | null;
}): VendorDefinition {
  const vendorType = (input.vendorType || '').trim().toLowerCase();
  if (!vendorType) throw new Error('vendorType 不能为空');
  if (!/^[a-z0-9_-]+$/.test(vendorType)) throw new Error('vendorType 仅允许小写字母、数字、下划线和连字符');

  const displayName = (input.displayName || '').trim();
  if (!displayName) throw new Error('displayName 不能为空');

  const description = input.description?.trim() || null;
  if (!input.regionConfig) {
    throw new Error('regionConfig 不能为空');
  }
  const normalizedRegionConfig = normalizeRegionConfig(input.regionConfig);
  buildStrategiesFromRegionConfig(normalizedRegionConfig);
  const normalizedEnvVars = normalizeEnvVarDefinitions(input.envVars ?? []);
  const regionConfigJson = JSON.stringify(normalizedRegionConfig);
  const envVarsJson = JSON.stringify(normalizedEnvVars);

  db()
    .prepare(`
      INSERT INTO vendor_definitions (vendor_type, display_name, description, region_config_json, env_vars_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(vendor_type)
      DO UPDATE SET
        display_name = excluded.display_name,
        description = excluded.description,
        region_config_json = excluded.region_config_json,
        env_vars_json = excluded.env_vars_json,
        updated_at = datetime('now')
    `)
    .run(vendorType, displayName, description, regionConfigJson, envVarsJson);

  const saved = getVendorDefinition(vendorType);
  if (!saved) throw new Error('保存服务商类型定义失败');
  return saved;
}

export function deleteVendorDefinition(vendorType: string): void {
  const normalized = (vendorType || '').trim().toLowerCase();
  if (!normalized) throw new Error('vendorType 不能为空');

  const existing = getVendorDefinition(normalized);
  if (!existing) throw new Error(`服务商类型定义不存在: ${normalized}`);

  db().prepare('DELETE FROM vendor_definitions WHERE vendor_type = ? COLLATE NOCASE').run(normalized);
}

export function listAvailableVendorTypes(): string[] {
  const rows = db()
    .prepare('SELECT vendor_type FROM vendor_definitions ORDER BY vendor_type ASC')
    .all() as Array<{ vendor_type: string }>;
  return rows.map((row) => String(row.vendor_type));
}

const VENDOR_TYPE_PATTERN = /^[a-z0-9_-]+$/;

export function normalizeVendorTypeText(value: string | null | undefined): string | null {
  const normalized = (value || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (!VENDOR_TYPE_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
}

export function isRegisteredVendorType(vendorType: string | null | undefined): boolean {
  const normalized = normalizeVendorTypeText(vendorType);
  if (!normalized) {
    return false;
  }
  return listAvailableVendorTypes().includes(normalized);
}

export function requireRegisteredVendorType(
  value: string | null | undefined,
  field = 'vendorType',
): string {
  const normalized = normalizeVendorTypeText(value);
  if (!normalized) {
    throw new Error(`${field} 不能为空或格式非法`);
  }
  if (!isRegisteredVendorType(normalized)) {
    throw new Error(`${field} 未注册: ${normalized}`);
  }
  return normalized;
}

export function resolveDefaultVendorType(): string {
  const available = listAvailableVendorTypes();
  if (available.length === 0) {
    throw new Error('未配置任何 vendorType 定义');
  }
  return available[0];
}

export function listRequiredEnvVars(
  vendorType: string,
  scope: VendorEnvVarScope,
): VendorEnvVarDefinition[] {
  const used = listUsedEnvVars(vendorType, scope);
  if (used.length === 0) {
    return [];
  }
  return used.filter((item) => !item.optional);
}

function collectTemplateVarKeysFromValue(
  value: unknown,
  target: Set<string>,
): void {
  if (typeof value === 'string') {
    const pattern = /\$([A-Za-z_][A-Za-z0-9_]*)/g;
    for (const match of value.matchAll(pattern)) {
      const key = normalizeEnvVarKey(match[1], 'template var');
      target.add(key.toLowerCase());
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectTemplateVarKeysFromValue(item, target);
    }
    return;
  }

  if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) {
      collectTemplateVarKeysFromValue(child, target);
    }
  }
}

function collectTemplateVarKeysFromRequest(
  request:
    | RegionMetricConfig
    | RegionTokenUsageConfig
    | RegionResetDateConfig
    | RegionDailyCheckinConfig
    | null
    | undefined,
  target: Set<string>,
): void {
  if (!request) {
    return;
  }
  collectTemplateVarKeysFromValue(request.path, target);
  collectTemplateVarKeysFromValue(request.queryParams, target);
  collectTemplateVarKeysFromValue(request.requestHeaders, target);
  collectTemplateVarKeysFromValue(request.requestBody, target);
  collectTemplateVarKeysFromValue(request.refreshPath, target);
  collectTemplateVarKeysFromValue(request.refreshBodyTemplate, target);
}

function resolveVendorAggregationMode(
  _vendorType: string,
  regionConfig: VendorRegionConfig,
): { vendor_remaining: VendorRegionAggregateMode; vendor_used: VendorRegionAggregateMode } {
  return {
    vendor_remaining: regionConfig.aggregation.vendor_remaining,
    vendor_used: regionConfig.aggregation.vendor_used,
  };
}

function resolveEndpointTotalMode(regionConfig: VendorRegionConfig): EndpointTotalMode {
  return regionConfig.endpointTotalMode;
}

function createManualTotalEnvVarDefinition(): VendorEnvVarDefinition {
  return {
    key: 'totalAmount',
    label: '端点总额',
    scope: 'endpoint',
    meaning: '当前为「手动设置」模式，需要在各个端点中手动独立设置环境变量 totalAmount 作为总额。',
    optional: false,
    defaultValue: null,
  };
}

export function listUsedEnvVars(
  vendorType: string,
  scope: VendorEnvVarScope,
): VendorEnvVarDefinition[] {
  const definition = getVendorDefinition(vendorType);
  if (!definition || !Array.isArray(definition.envVars)) {
    return [];
  }
  const usedKeys = new Set<string>();
  const aggregation = resolveVendorAggregationMode(definition.vendorType, definition.regionConfig);
  const endpointTotalMode = resolveEndpointTotalMode(definition.regionConfig);
  const endpointRemainingMode = definition.regionConfig.endpointMetricModes?.endpoint_remaining ?? 'independent_request';
  const endpointUsedMode = definition.regionConfig.endpointMetricModes?.endpoint_used ?? 'independent_request';

  if (scope === 'vendor') {
    if (aggregation.vendor_remaining === 'independent_request') {
      collectTemplateVarKeysFromRequest(definition.regionConfig.regions.vendor_remaining, usedKeys);
    }
    if (aggregation.vendor_used === 'independent_request') {
      collectTemplateVarKeysFromRequest(definition.regionConfig.regions.vendor_used, usedKeys);
    }
    if (definition.regionConfig.refreshTokenEnabled && definition.regionConfig.refreshToken) {
      collectTemplateVarKeysFromRequest(definition.regionConfig.refreshToken, usedKeys);
    }
    if (definition.regionConfig.dailyCheckinEnabled && definition.regionConfig.dailyCheckin) {
      collectTemplateVarKeysFromRequest(definition.regionConfig.dailyCheckin, usedKeys);
    }
  } else {
    if (endpointRemainingMode === 'independent_request') {
      collectTemplateVarKeysFromRequest(definition.regionConfig.regions.endpoint_remaining, usedKeys);
    }
    if (endpointUsedMode === 'independent_request') {
      collectTemplateVarKeysFromRequest(definition.regionConfig.regions.endpoint_used, usedKeys);
    }
    if (endpointTotalMode === 'independent_request') {
      collectTemplateVarKeysFromRequest(definition.regionConfig.regions.endpoint_total, usedKeys);
    }
    if (definition.regionConfig.middle.mode === 'token_usage') {
      collectTemplateVarKeysFromRequest(definition.regionConfig.middle.token_usage, usedKeys);
    }
    if (definition.regionConfig.middle.mode === 'reset_date') {
      collectTemplateVarKeysFromRequest(definition.regionConfig.middle.reset_date, usedKeys);
    }
    if (definition.regionConfig.refreshTokenEnabled && definition.regionConfig.refreshToken) {
      collectTemplateVarKeysFromRequest(definition.regionConfig.refreshToken, usedKeys);
    }
    if (endpointTotalMode === 'manual_total') {
      usedKeys.add('totalamount');
    }
  }

  if (usedKeys.size === 0) {
    return [];
  }
  const vars = definition.envVars.filter((item) => usedKeys.has(item.key.toLowerCase()));
  if (scope === 'endpoint' && endpointTotalMode === 'manual_total') {
    const exists = vars.some((item) => item.key.toLowerCase() === 'totalamount');
    if (!exists) {
      vars.push(createManualTotalEnvVarDefinition());
    }
  }
  return vars;
}

export function findMissingRequiredEnvVars(
  vendorType: string,
  scope: VendorEnvVarScope,
  envVars: Record<string, string>,
  options?: {
    useEndpointAmountAsManualTotalSource?: boolean;
  },
): VendorEnvVarDefinition[] {
  const required = listRequiredEnvVars(vendorType, scope);
  if (required.length === 0) {
    return [];
  }
  const useEndpointAmountAsManualTotalSource = options?.useEndpointAmountAsManualTotalSource === true;
  return required.filter((item) => {
    const key = item.key.trim().toLowerCase();
    if (scope === 'endpoint' && useEndpointAmountAsManualTotalSource && key === 'totalamount') {
      return false;
    }
    return !envVars[item.key] || !envVars[item.key].trim();
  });
}

export function formatMissingEnvVarLabels(
  items: Array<Pick<VendorEnvVarDefinition, 'key' | 'label'>>,
): string[] {
  return items.map((item) => `${item.label}($${item.key})`);
}

export function getVendorDefinitionDisplayName(vendorType: string): string | null {
  const def = getVendorDefinition(vendorType);
  return def?.displayName ?? null;
}

export function detectVendorApiKind(vendorType: string | null | undefined): VendorApiKind {
  const normalized = (vendorType || '').trim().toLowerCase();
  if (!normalized) {
    return 'unknown';
  }

  const definition = getVendorDefinition(normalized);
  if (!definition) {
    return 'unknown';
  }

  const haystack = [
    definition.vendorType,
    definition.displayName,
    definition.description ?? '',
    ...definition.strategies.map((strategy) => strategy.name),
  ]
    .join(' ')
    .toLowerCase();

  if (haystack.includes('claude') || haystack.includes('anthropic')) {
    return 'claude_code';
  }
  if (haystack.includes('gemini') || haystack.includes('google')) {
    return 'gemini';
  }
  if (
    haystack.includes('codex')
    || haystack.includes('openai')
    || haystack.includes('gpt')
    || haystack.includes('oneapi')
    || haystack.includes('openrouter')
  ) {
    return 'codex';
  }

  return 'unknown';
}
