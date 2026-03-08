import {
  getJsonWithAuth,
  postJsonWithResolvedAuth,
  putJsonWithResolvedAuth,
  isLikelyHtml,
  summarizeRaw,
  toNumber,
  type RequestAuthOptions,
  type HttpResponse,
} from '@/lib/quota/http';
import type {
  EndpointIdentity,
  QuotaDebugProbe,
  QuotaStatus,
  QuotaQueryOutput,
  QuotaResult,
} from '@/lib/quota/types';
import type {
  VendorDefinition,
  StrategyDefinition,
  StrategyQueryTarget,
  RegionMetricConfig,
  RegionResetDateConfig,
  RegionTokenUsageConfig,
  RegionDailyCheckinConfig,
  EndpointTotalMode,
  EndpointMetricMode,
} from '@/lib/vendor-definitions';

// ---------------------------------------------------------------------------
// Helpers (mirrors adapters.ts patterns)
// ---------------------------------------------------------------------------

type AdapterResult = Omit<QuotaResult, 'checkedAt'>;

type RuntimeCredentials = {
  apiKey: string;
  cookieValue: string | null;
  userId: string | null;
  urlKeyName: string | null;
};

type TemplatePrimitive = string | number | boolean | null | undefined;
type TemplateVars = Record<string, string | number>;

function statusFromCode(status: number): 'ok' | 'unauthorized' | 'network_error' {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 401 || status === 403) return 'unauthorized';
  return 'network_error';
}

function finalizeResult(result: AdapterResult): QuotaResult {
  return { ...result, checkedAt: new Date().toISOString() };
}

function buildUnsupported(strategy: string, message: string, latencyMs = 0): AdapterResult {
  return {
    status: 'unsupported',
    strategy,
    totalUsd: null,
    usedUsd: null,
    remainingUsd: null,
    message,
    latencyMs,
    credentialIssue: null,
  };
}

function buildUnauthorized(
  strategy: string,
  authMethod: 'bearer' | 'cookie',
  statusCode: number,
  rawValue: unknown,
  latencyMs: number,
): AdapterResult {
  const cookieExpired = authMethod === 'cookie';
  return {
    status: 'unauthorized',
    strategy,
    totalUsd: null,
    usedUsd: null,
    remainingUsd: null,
    rawSnippet: summarizeRaw(rawValue),
    message: cookieExpired ? `Cookie 认证失败 (${statusCode})，请更新 Cookie` : `鉴权失败 (${statusCode})`,
    latencyMs,
    credentialIssue: cookieExpired ? 'cookie_expired' : null,
  };
}

function buildParseFailureFromHtml(
  strategy: string,
  authMethod: 'bearer' | 'cookie',
  latencyMs: number,
  rawValue: unknown,
): AdapterResult {
  if (authMethod === 'cookie') {
    return {
      status: 'unauthorized',
      strategy,
      totalUsd: null,
      usedUsd: null,
      remainingUsd: null,
      rawSnippet: summarizeRaw(rawValue),
      message: '返回了登录页面，Cookie 可能失效',
      latencyMs,
      credentialIssue: 'cookie_expired',
    };
  }
  return {
    status: 'parse_error',
    strategy,
    totalUsd: null,
    usedUsd: null,
    remainingUsd: null,
    rawSnippet: summarizeRaw(rawValue),
    message: '返回 HTML，无法解析为 JSON',
    latencyMs,
    credentialIssue: null,
  };
}

function mapQueryTargetToProbePurpose(queryTarget: StrategyQueryTarget | undefined): QuotaDebugProbe['purpose'] {
  if (!queryTarget) return 'amount';
  return queryTarget;
}

function toDebugProbe(
  strategy: string,
  path: string,
  response: HttpResponse,
  extra?: { purpose?: QuotaDebugProbe['purpose']; note?: string },
): QuotaDebugProbe {
  return {
    strategy,
    path,
    status: response.status,
    latencyMs: response.latencyMs,
    contentType: response.contentType,
    preview: summarizeRaw(response.json ?? response.bodyText),
    attempts: response.attempts.map((attempt) => ({
      url: attempt.url,
      method: attempt.method,
      status: attempt.status,
      latencyMs: attempt.latencyMs,
      contentType: attempt.contentType,
      requestHeaders: { ...attempt.requestHeaders },
      requestBodyPreview: attempt.requestBodyPreview,
      bodyPreview: attempt.bodyPreview,
      error: attempt.error,
    })),
    ...(extra?.purpose ? { purpose: extra.purpose } : {}),
    ...(extra?.note ? { note: extra.note } : {}),
  };
}

// ---------------------------------------------------------------------------
// Field extraction & formula
// ---------------------------------------------------------------------------

function extractField(json: unknown, dotPath: string | null | undefined): unknown {
  if (!dotPath || !json) return undefined;

  const parts = dotPath.split('.');
  let current: unknown = json;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;

    // Support array index like "items[0]"
    const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
    if (arrayMatch) {
      const key = arrayMatch[1];
      const idx = Number(arrayMatch[2]);
      current = (current as Record<string, unknown>)[key];
      if (!Array.isArray(current)) return undefined;
      current = current[idx];
    } else {
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }
  }

  return current;
}

function applyFormula(
  rawValue: unknown,
  formula: { type: 'direct' | 'divide'; divisor?: number } | null | undefined,
): number | null {
  const num = toNumber(rawValue);
  if (num === null) return null;

  if (!formula || formula.type === 'direct') return num;

  if (formula.type === 'divide') {
    const divisor = formula.divisor ?? 1;
    if (divisor === 0) return num;
    return num / divisor;
  }

  return num;
}

// ---------------------------------------------------------------------------
// Auth resolution
// ---------------------------------------------------------------------------

function resolveAuth(
  authType: StrategyDefinition['auth'],
  credentials: RuntimeCredentials,
): RequestAuthOptions {
  switch (authType) {
    case 'cookie':
      return {
        authMethod: 'cookie',
        apiKey: credentials.apiKey,
        urlKeyName: null,
        cookieValue: credentials.cookieValue,
        userId: credentials.userId,
      };
    case 'url_key':
      return {
        authMethod: 'url_key',
        apiKey: credentials.apiKey,
        urlKeyName: credentials.urlKeyName ?? 'key',
        cookieValue: null,
        userId: credentials.userId,
      };
    case 'bearer':
    default:
      return {
        authMethod: 'bearer',
        apiKey: credentials.apiKey,
        urlKeyName: null,
        cookieValue: null,
        userId: credentials.userId,
      };
  }
}

// ---------------------------------------------------------------------------
// Template resolution (query/body/headers)
// ---------------------------------------------------------------------------

function toUnixTimestampMilliseconds(date: Date): string {
  return String(date.getTime());
}

function resolveTimeTokens(): TemplateVars {
  const now = new Date();
  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowDate = new Date(todayDate);
  tomorrowDate.setDate(todayDate.getDate() + 1);

  const oneYearAgoDate = new Date(todayDate);
  oneYearAgoDate.setFullYear(todayDate.getFullYear() - 1);

  const formatDate = (date: Date): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  return {
    todayStartMs: toUnixTimestampMilliseconds(todayDate),
    tomorrowStartMs: toUnixTimestampMilliseconds(tomorrowDate),
    oneYearAgoStartMs: toUnixTimestampMilliseconds(oneYearAgoDate),
    todayDate: formatDate(todayDate),
    tomorrowDate: formatDate(tomorrowDate),
    oneYearAgoDate: formatDate(oneYearAgoDate),
    // Legacy compatibility aliases
    fiveYearsAgoStartMs: toUnixTimestampMilliseconds(oneYearAgoDate),
    fiveYearsAgoDate: formatDate(oneYearAgoDate),
  };
}

function normalizeTemplateVariableKey(key: string): string | null {
  const normalized = key.trim().replace(/^\$+/, '');
  if (!normalized) return null;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) return null;
  return normalized;
}

const RESERVED_TEMPLATE_KEYS = new Set([
  'apikey',
  'apikeytoken',
]);

function buildTemplateVars(
  credentials: RuntimeCredentials,
  customVariables?: Record<string, string>,
): TemplateVars {
  const apiKeyToken = credentials.apiKey.trim().replace(/^Bearer\s+/i, '');
  const builtins: TemplateVars = {
    apiKey: credentials.apiKey,
    apiKeyToken,
    cookieValue: credentials.cookieValue ?? '',
    userId: credentials.userId ?? '',
    ...resolveTimeTokens(),
  };
  if (!customVariables || typeof customVariables !== 'object') {
    return builtins;
  }
  const merged: TemplateVars = { ...builtins };
  for (const [key, value] of Object.entries(builtins)) {
    const lowered = key.toLowerCase();
    if (!(lowered in merged)) {
      merged[lowered] = value;
    }
  }
  for (const [rawKey, rawValue] of Object.entries(customVariables)) {
    const key = normalizeTemplateVariableKey(rawKey);
    if (!key) continue;
    if (RESERVED_TEMPLATE_KEYS.has(key.toLowerCase())) continue;
    if (typeof rawValue !== 'string') continue;
    const text = rawValue.trim();
    if (!text) continue;
    merged[key] = text;
    const lowered = key.toLowerCase();
    if (!(lowered in merged)) {
      merged[lowered] = text;
    }
  }
  return merged;
}

function resolveTemplateTokenValue(vars: TemplateVars, key: string): TemplatePrimitive | null {
  if (key in vars) {
    return vars[key];
  }
  const lowered = key.toLowerCase();
  if (lowered in vars) {
    return vars[lowered];
  }
  return null;
}

function resolveTemplateString(raw: string, vars: TemplateVars): TemplatePrimitive {
  const exact = raw.trim();
  if (exact.startsWith('$')) {
    const key = exact.slice(1);
    const resolved = resolveTemplateTokenValue(vars, key);
    if (resolved !== null) {
      return resolved;
    }
  }

  return raw.replace(/\$[A-Za-z_][A-Za-z0-9_]*/g, (token) => {
    const key = token.slice(1);
    const resolved = resolveTemplateTokenValue(vars, key);
    if (resolved === null) {
      return token;
    }
    return String(resolved);
  });
}

function resolveTemplateValue(value: unknown, vars: TemplateVars): unknown {
  if (typeof value === 'string') {
    return resolveTemplateString(value, vars);
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveTemplateValue(item, vars));
  }

  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = resolveTemplateValue(v, vars);
    }
    return result;
  }

  return value;
}

function resolveRequestBody(
  template: Record<string, unknown> | null | undefined,
  vars: TemplateVars,
): Record<string, unknown> | undefined {
  if (!template) return undefined;
  const resolved = resolveTemplateValue(template, vars);
  if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) {
    return undefined;
  }
  return resolved as Record<string, unknown>;
}

function resolveQueryParams(
  params: Record<string, string | number | boolean> | null | undefined,
  vars: TemplateVars,
): Record<string, string | number | boolean> | undefined {
  if (!params) return undefined;

  const result: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(params)) {
    const resolved = resolveTemplateValue(v, vars);
    if (typeof resolved === 'string' || typeof resolved === 'number' || typeof resolved === 'boolean') {
      result[k] = resolved;
    }
  }
  return result;
}

function resolveRequestHeaders(
  headers: Record<string, string> | null | undefined,
  vars: TemplateVars,
): Record<string, string> | undefined {
  if (!headers) return undefined;

  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const resolved = resolveTemplateValue(v, vars);
    if (resolved === null || resolved === undefined) continue;
    result[k] = String(resolved);
  }
  return result;
}

function buildPathWithQuery(
  path: string,
  queryParams: Record<string, string | number | boolean> | undefined,
): string {
  if (!queryParams || Object.keys(queryParams).length === 0) {
    return path;
  }

  const questionIndex = path.indexOf('?');
  const pathname = questionIndex >= 0 ? path.slice(0, questionIndex) : path;
  const queryString = questionIndex >= 0 ? path.slice(questionIndex + 1) : '';
  const params = new URLSearchParams(queryString);

  for (const [key, value] of Object.entries(queryParams)) {
    if (value === null || value === undefined || value === '') continue;
    params.set(key, String(value));
  }

  const serialized = params.toString();
  return serialized ? `${pathname}?${serialized}` : pathname;
}

// ---------------------------------------------------------------------------
// Strategy path validation
// ---------------------------------------------------------------------------

function validateStrategyPath(path: string): boolean {
  if (!path.startsWith('/')) return false;
  if (path.includes('://')) return false;
  return true;
}

const ACCESS_TOKEN_ENV_KEY = 'accesstoken';
const REFRESH_TOKEN_ENV_KEY = 'refreshtoken';

function pickMappedCredentialValue(
  envUpdates: Record<string, string>,
  key: typeof ACCESS_TOKEN_ENV_KEY | typeof REFRESH_TOKEN_ENV_KEY,
): string | null {
  for (const [rawKey, rawValue] of Object.entries(envUpdates)) {
    if (rawKey.trim().toLowerCase() !== key) {
      continue;
    }
    const value = rawValue.trim();
    if (value) {
      return value;
    }
  }
  return null;
}

type RefreshableRequest = {
  name: string;
  auth: StrategyDefinition['auth'];
  baseUrlReplacements?: UrlReplacementRule[];
  autoHandle403Intercept?: boolean;
  refreshOnUnauth?: boolean;
  refreshPath?: string;
  refreshBodyTemplate?: Record<string, string>;
  refreshResponseMappings?: RefreshResponseMapping[];
  requestHeaders?: Record<string, string>;
};

type UrlReplacementRule = {
  search: string;
  replace: string;
};

type RequestRegionConfig = {
  auth: StrategyDefinition['auth'];
  method: StrategyDefinition['method'];
  path: string;
  baseUrlReplacements?: UrlReplacementRule[];
  queryParams?: Record<string, string | number | boolean>;
  requestHeaders?: Record<string, string>;
  requestBody?: Record<string, unknown> | null;
  autoHandle403Intercept?: boolean;
  refreshOnUnauth?: boolean;
  refreshPath?: string;
  refreshBodyTemplate?: Record<string, string>;
  refreshResponseMappings?: RefreshResponseMapping[];
};

type RefreshResponseMapping = {
  field: string;
  envVarKey: string;
  formula?: { type: 'direct' | 'divide'; divisor?: number } | null;
};

export type VendorDailyCheckinOutput = {
  status: QuotaStatus;
  message: string | null;
  checkinDate: string | null;
  quotaAwarded: number | null;
  source: string | null;
  fieldPaths: {
    checkinDate: string | null;
    quotaAwarded: string | null;
  };
  debugProbes: QuotaDebugProbe[];
  refreshedAccessToken: string | null;
  refreshedCookieValue: string | null;
  refreshedEnvVars?: Record<string, string>;
};

function mergeRuntimeTemplateVars(
  current: Record<string, string> | undefined,
  refreshedAccessToken: string | null | undefined,
  refreshedRefreshToken: string | null | undefined,
  envUpdates: Record<string, string>,
): Record<string, string> {
  const next: Record<string, string> = { ...(current ?? {}) };

  for (const [rawKey, rawValue] of Object.entries(envUpdates)) {
    const key = String(rawKey || '').trim();
    const value = String(rawValue || '').trim();
    if (!key || !value) continue;
    next[key] = value;
  }

  const access = (refreshedAccessToken || '').trim().replace(/^Bearer\s+/i, '').trim();
  const refresh = (refreshedRefreshToken || '').trim().replace(/^Bearer\s+/i, '').trim();

  if (access) {
    next.AccessToken = access;
  }

  if (refresh) {
    next.RefreshToken = refresh;
  }

  return next;
}

function applyBaseUrlReplacements(baseUrl: string, rules?: UrlReplacementRule[]): string {
  if (!rules || rules.length === 0) return baseUrl;
  let next = baseUrl;
  for (const rule of rules) {
    const search = (rule.search ?? '').trim();
    if (!search) continue;
    next = next.split(search).join(rule.replace ?? '');
  }
  return next;
}

function extractRefreshFieldValue(payload: unknown, fieldPath: string): unknown {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }
  return extractField(payload as Record<string, unknown>, fieldPath);
}

function resolveRefreshMappedValue(
  rawValue: unknown,
  formula: { type: 'direct' | 'divide'; divisor?: number } | null | undefined,
): string | null {
  if (rawValue === null || rawValue === undefined) {
    return null;
  }

  if (formula?.type === 'divide') {
    const num = toNumber(rawValue);
    if (num === null) return null;
    const divisor = formula.divisor ?? 1;
    const value = divisor === 0 ? num : num / divisor;
    if (!Number.isFinite(value)) return null;
    return String(value);
  }

  if (typeof rawValue === 'string') {
    const text = rawValue.trim();
    return text || null;
  }
  if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
    return String(rawValue);
  }
  return null;
}

function extractRefreshEnvUpdates(
  payload: unknown,
  mappings: RefreshResponseMapping[] | undefined,
): Record<string, string> {
  if (!Array.isArray(mappings) || mappings.length === 0) {
    return {};
  }
  const next: Record<string, string> = {};
  for (const mapping of mappings) {
    const field = String(mapping.field ?? '').trim();
    const envVarKey = String(mapping.envVarKey ?? '').trim();
    if (!field || !envVarKey) continue;
    const raw = extractRefreshFieldValue(payload, field);
    const value = resolveRefreshMappedValue(raw, mapping.formula);
    if (value === null) continue;
    next[envVarKey] = value;
  }
  return next;
}

async function tryRefreshCredentials(
  provider: EndpointIdentity,
  request: RefreshableRequest,
  credentials: RuntimeCredentials,
  fallbackRefreshConfig: RequestRegionConfig | null,
  templateVariables?: Record<string, string>,
): Promise<{ updated: RuntimeCredentials; probe: QuotaDebugProbe | null; error: AdapterResult | null; envUpdates: Record<string, string> }> {
  if (!request.refreshOnUnauth) {
    return { updated: credentials, probe: null, error: null, envUpdates: {} };
  }

  const refreshRequest: RequestRegionConfig | null = fallbackRefreshConfig
    ? {
        ...fallbackRefreshConfig,
      }
    : request.refreshPath
      ? {
          auth: request.auth,
          method: 'POST',
          path: request.refreshPath,
          baseUrlReplacements: request.baseUrlReplacements,
          requestHeaders: request.requestHeaders,
          requestBody: request.refreshBodyTemplate ?? {},
          refreshResponseMappings: request.refreshResponseMappings,
          autoHandle403Intercept: request.autoHandle403Intercept !== false,
        }
      : null;

  if (!refreshRequest) {
    return { updated: credentials, probe: null, error: null, envUpdates: {} };
  }

  if (!validateStrategyPath(refreshRequest.path)) {
    return {
      updated: credentials,
      probe: null,
      error: buildUnsupported(request.name, `refreshPath 无效: ${refreshRequest.path}`),
      envUpdates: {},
    };
  }

  try {
    const refreshAuth = resolveAuth(refreshRequest.auth, credentials);
    const vars = buildTemplateVars(credentials, templateVariables ?? provider.templateVariables);
    const refreshBaseUrl = applyBaseUrlReplacements(provider.baseUrl, refreshRequest.baseUrlReplacements);
    const refreshResolvedPath = buildPathWithQuery(
      refreshRequest.path,
      resolveQueryParams(refreshRequest.queryParams, vars),
    );
    const refreshHeaders = resolveRequestHeaders(refreshRequest.requestHeaders, vars);
    const refreshExecutionOptions = {
      autoHandle403Intercept: refreshRequest.autoHandle403Intercept !== false,
    };
    const refreshBody = resolveRequestBody(refreshRequest.requestBody ?? null, vars) ?? {};
    const response =
      refreshRequest.method === 'GET'
        ? await getJsonWithAuth(
            refreshBaseUrl,
            refreshResolvedPath,
            refreshAuth,
            refreshHeaders,
            credentials.userId,
            refreshExecutionOptions,
          )
        : refreshRequest.method === 'PUT'
          ? await putJsonWithResolvedAuth(
              refreshBaseUrl,
              refreshResolvedPath,
              refreshBody,
              refreshAuth,
              refreshHeaders,
              credentials.userId,
              refreshExecutionOptions,
            )
          : await postJsonWithResolvedAuth(
              refreshBaseUrl,
              refreshResolvedPath,
              refreshBody,
              refreshAuth,
              refreshHeaders,
              credentials.userId,
              refreshExecutionOptions,
            );

    const probe = {
      ...toDebugProbe(`${request.name}-refresh`, refreshResolvedPath, response),
      purpose: 'refresh' as const,
      note: '认证失败后触发的 token 刷新请求',
    };

    const httpStatus = statusFromCode(response.status);
    if (httpStatus !== 'ok') {
      return {
        updated: credentials,
        probe,
        error: buildUnauthorized(
          `${request.name}-refresh`,
          refreshRequest.auth === 'cookie' ? 'cookie' : 'bearer',
          response.status,
          response.json ?? response.bodyText,
          response.latencyMs,
        ),
        envUpdates: {},
      };
    }

    if (isLikelyHtml(response.bodyText, response.contentType)) {
      return {
        updated: credentials,
        probe,
        error: buildParseFailureFromHtml(
          `${request.name}-refresh`,
          request.auth === 'cookie' ? 'cookie' : 'bearer',
          response.latencyMs,
          response.bodyText,
        ),
        envUpdates: {},
      };
    }

    const payload = response.json;
    const mappedEnvUpdates = extractRefreshEnvUpdates(payload, refreshRequest.refreshResponseMappings);
    const refreshedCookie = pickMappedCredentialValue(mappedEnvUpdates, REFRESH_TOKEN_ENV_KEY);

    if (Object.keys(mappedEnvUpdates).length === 0) {
      return {
        updated: credentials,
        probe,
        error: buildUnsupported(
          `${request.name}-refresh`,
          '刷新响应未命中 refreshResponseMappings 中声明的字段映射',
          response.latencyMs,
        ),
        envUpdates: {},
      };
    }

    return {
      updated: {
        ...credentials,
        cookieValue: refreshedCookie ?? credentials.cookieValue,
      },
      probe,
      error: null,
      envUpdates: mappedEnvUpdates,
    };
  } catch (error) {
    return {
      updated: credentials,
      probe: null,
      error: {
        status: 'network_error',
        strategy: `${request.name}-refresh`,
        totalUsd: null,
        usedUsd: null,
        remainingUsd: null,
        message: error instanceof Error ? error.message : String(error),
        latencyMs: 0,
        credentialIssue: null,
      },
      envUpdates: {},
    };
  }
}

// ---------------------------------------------------------------------------
// Core entry point
// ---------------------------------------------------------------------------

export async function executeVendorDefinition(
  provider: EndpointIdentity,
  definition: VendorDefinition,
  options?: { vendorId?: number | null },
): Promise<QuotaQueryOutput> {
  const collectedProbes: QuotaDebugProbe[] = [];
  let lastFailure: AdapterResult | null = null;
  let runtimeCredentials: RuntimeCredentials = {
    apiKey: provider.apiKey,
    cookieValue: provider.cookieValue ?? null,
    userId: provider.userId ?? null,
    urlKeyName: provider.urlKeyName ?? null,
  };
  let runtimeTemplateVariables: Record<string, string> | undefined = provider.templateVariables
    ? { ...provider.templateVariables }
    : undefined;
  let refreshedAccessToken: string | null = null;
  let refreshedCookieValue: string | null = null;
  const refreshedEnvVars: Record<string, string> = {};

  let tokenUsed: number | null = null;
  let tokenAvailable: number | null = null;
  let lastCreditReset: string | null = null;
  const sourceByMetric: Partial<Record<'vendor_remaining' | 'vendor_used' | 'endpoint_remaining' | 'endpoint_used' | 'endpoint_total', string>> = {};
  const fieldPathByMetric: Partial<Record<'vendor_remaining' | 'vendor_used' | 'endpoint_remaining' | 'endpoint_used' | 'endpoint_total', string | null>> = {};
  let tokenUsedSource: string | null = null;
  let tokenAvailableSource: string | null = null;
  let lastCreditResetSource: string | null = null;
  let tokenUsedFieldPath: string | null = null;
  let tokenAvailableFieldPath: string | null = null;
  let lastCreditResetFieldPath: string | null = null;
  let lastRawSnippet = '';
  let maxLatency = 0;
  let vendorRemaining: number | null = null;
  let vendorUsed: number | null = null;
  let endpointRemaining: number | null = null;
  let endpointUsed: number | null = null;
  let endpointTotal: number | null = null;
  const region = definition.regionConfig;

  const queryRegion = async (
    name: string,
    purpose: QuotaDebugProbe['purpose'],
    request: RequestRegionConfig,
  ): Promise<{ data: unknown; resolvedPath: string; response: HttpResponse } | null> => {
    if (!validateStrategyPath(request.path)) {
      lastFailure = buildUnsupported(name, `区域路径无效: ${request.path}`);
      return null;
    }

    const authMethod = request.auth === 'cookie' ? ('cookie' as const) : ('bearer' as const);

    const executeOnce = async (
      credentials: RuntimeCredentials,
    ): Promise<{ resolvedPath: string; response: HttpResponse }> => {
      const auth = resolveAuth(request.auth, credentials);
      const vars = buildTemplateVars(credentials, runtimeTemplateVariables);
      const requestBaseUrl = applyBaseUrlReplacements(provider.baseUrl, request.baseUrlReplacements);
      const resolvedPath = buildPathWithQuery(request.path, resolveQueryParams(request.queryParams, vars));
      const requestHeaders = resolveRequestHeaders(request.requestHeaders, vars);

      if (request.method === 'GET') {
        const response = await getJsonWithAuth(
          requestBaseUrl,
          resolvedPath,
          auth,
          requestHeaders,
          credentials.userId,
          {
            autoHandle403Intercept: request.autoHandle403Intercept !== false,
          },
        );
        return { resolvedPath, response };
      }

      const body = resolveRequestBody(request.requestBody, vars) ?? {};
      const response = request.method === 'PUT'
        ? await putJsonWithResolvedAuth(
            requestBaseUrl,
            resolvedPath,
            body,
            auth,
            requestHeaders,
            credentials.userId,
            {
              autoHandle403Intercept: request.autoHandle403Intercept !== false,
            },
          )
        : await postJsonWithResolvedAuth(
            requestBaseUrl,
            resolvedPath,
            body,
            auth,
            requestHeaders,
            credentials.userId,
            {
              autoHandle403Intercept: request.autoHandle403Intercept !== false,
            },
          );
      return { resolvedPath, response };
    };

    try {
      let { resolvedPath, response } = await executeOnce(runtimeCredentials);
      let probe = toDebugProbe(name, resolvedPath, response, {
        purpose,
        note: '区域配置请求',
      });
      let httpStatus = statusFromCode(response.status);

      if (
        response.status === 401
        && request.refreshOnUnauth
        && (request.refreshPath || (region.refreshTokenEnabled && region.refreshToken))
      ) {
        const refresh = await tryRefreshCredentials(
          provider,
          {
            name,
            auth: request.auth,
            baseUrlReplacements: request.baseUrlReplacements,
            refreshOnUnauth: request.refreshOnUnauth,
            refreshPath: request.refreshPath,
            refreshBodyTemplate: request.refreshBodyTemplate,
            refreshResponseMappings: request.refreshResponseMappings,
            requestHeaders: request.requestHeaders,
            autoHandle403Intercept: request.autoHandle403Intercept,
          },
          runtimeCredentials,
          region.refreshTokenEnabled ? region.refreshToken : null,
          runtimeTemplateVariables,
        );
        if (refresh.probe) {
          collectedProbes.push(refresh.probe);
        }
        if (!refresh.error) {
          const mappedRefreshAccess = pickMappedCredentialValue(refresh.envUpdates, ACCESS_TOKEN_ENV_KEY);
          const mappedRefreshCookie = pickMappedCredentialValue(refresh.envUpdates, REFRESH_TOKEN_ENV_KEY);
          runtimeCredentials = refresh.updated;
          if (mappedRefreshAccess) {
            refreshedAccessToken = mappedRefreshAccess;
          }
          if (mappedRefreshCookie) {
            refreshedCookieValue = mappedRefreshCookie;
          }
          runtimeTemplateVariables = mergeRuntimeTemplateVars(
            runtimeTemplateVariables,
            mappedRefreshAccess,
            mappedRefreshCookie,
            refresh.envUpdates,
          );
          for (const [key, value] of Object.entries(refresh.envUpdates)) {
            const trimmedKey = key.trim();
            const trimmedValue = value.trim();
            if (!trimmedKey || !trimmedValue) continue;
            refreshedEnvVars[trimmedKey] = trimmedValue;
          }
          const retried = await executeOnce(runtimeCredentials);
          resolvedPath = retried.resolvedPath;
          response = retried.response;
          probe = toDebugProbe(`${name}-retry`, resolvedPath, response, {
            purpose,
            note: '刷新 token 后重试',
          });
          httpStatus = statusFromCode(response.status);
        } else {
          lastFailure = refresh.error;
        }
      }

      collectedProbes.push(probe);
      maxLatency = Math.max(maxLatency, response.latencyMs);
      lastRawSnippet = summarizeRaw(response.json ?? response.bodyText);

      if (httpStatus === 'unauthorized') {
        lastFailure = buildUnauthorized(name, authMethod, response.status, response.json ?? response.bodyText, response.latencyMs);
        return null;
      }
      if (httpStatus === 'network_error') {
        lastFailure = buildUnsupported(name, `${resolvedPath} 返回 ${response.status}`, response.latencyMs);
        return null;
      }
      if (isLikelyHtml(response.bodyText, response.contentType)) {
        lastFailure = buildParseFailureFromHtml(name, authMethod, response.latencyMs, response.bodyText);
        return null;
      }

      let data = response.json;
      return { data, resolvedPath, response };
    } catch (error) {
      lastFailure = {
        status: 'network_error',
        strategy: name,
        totalUsd: null,
        usedUsd: null,
        remainingUsd: null,
        message: error instanceof Error ? error.message : String(error),
        latencyMs: 0,
        credentialIssue: null,
      };
      return null;
    }
  };

  const readMetricRegion = async (
    metricKey: 'vendor_remaining' | 'vendor_used' | 'endpoint_remaining' | 'endpoint_used' | 'endpoint_total',
    config: RegionMetricConfig | null,
  ): Promise<number | null> => {
    if (!config) return null;
    fieldPathByMetric[metricKey] = config.field ?? null;
    const queried = await queryRegion(`region-${metricKey}`, 'amount', config);
    if (!queried) return null;
    const raw = extractField(queried.data, config.field);
    const value = applyFormula(raw, config.formula);
    if (value === null) {
      const keys =
        queried.data && typeof queried.data === 'object'
          ? Object.keys(queried.data as Record<string, unknown>).slice(0, 8).join(',')
          : '';
      lastFailure = buildUnsupported(
        `region-${metricKey}`,
        `${queried.resolvedPath} 未命中字段${config.field ?? '(空)'}${keys ? `(${keys})` : ''}`,
        queried.response.latencyMs,
      );
      return null;
    }
    sourceByMetric[metricKey] = `${definition.displayName} ${queried.resolvedPath}`;
    return value;
  };

  const endpointTotalMode: EndpointTotalMode =
    region.endpointTotalMode === 'sum_from_parts' || region.endpointTotalMode === 'manual_total'
      ? region.endpointTotalMode
      : 'independent_request';
  const endpointRemainingMode: EndpointMetricMode =
    region.endpointMetricModes?.endpoint_remaining === 'subtract_from_total'
      ? 'subtract_from_total'
      : 'independent_request';
  const endpointUsedMode: EndpointMetricMode =
    region.endpointMetricModes?.endpoint_used === 'subtract_from_total'
      ? 'subtract_from_total'
      : 'independent_request';
  const vendorRemainingAggregateMode = region.aggregation?.vendor_remaining ?? 'independent_request';
  const vendorUsedAggregateMode = region.aggregation?.vendor_used ?? 'endpoint_sum';
  vendorRemaining =
    vendorRemainingAggregateMode === 'endpoint_sum'
      ? null
      : await readMetricRegion('vendor_remaining', region.regions.vendor_remaining);
  vendorUsed =
    vendorUsedAggregateMode === 'endpoint_sum'
      ? null
      : await readMetricRegion('vendor_used', region.regions.vendor_used);
  endpointRemaining =
    endpointRemainingMode === 'independent_request'
      ? await readMetricRegion('endpoint_remaining', region.regions.endpoint_remaining)
      : null;
  endpointUsed =
    endpointUsedMode === 'independent_request'
      ? await readMetricRegion('endpoint_used', region.regions.endpoint_used)
      : null;
  if (endpointTotalMode === 'independent_request') {
    endpointTotal = await readMetricRegion('endpoint_total', region.regions.endpoint_total);
  } else if (endpointTotalMode === 'sum_from_parts') {
    sourceByMetric.endpoint_total = `${definition.displayName} 端点余额 + 端点已用`;
    endpointTotal =
      endpointRemaining !== null && endpointUsed !== null
        ? endpointRemaining + endpointUsed
        : null;
    if (endpointTotal === null) {
      const missingParts: string[] = [];
      if (endpointRemaining === null) {
        missingParts.push('端点余额');
      }
      if (endpointUsed === null) {
        missingParts.push('端点已用');
      }
      if (missingParts.length > 0) {
        sourceByMetric.endpoint_total = `${definition.displayName} 端点余额 + 端点已用（缺少${missingParts.join('、')}）`;
      }
    }
  } else {
    const templateVars = buildTemplateVars(runtimeCredentials, runtimeTemplateVariables);
    const rawTotalAmount = templateVars.totalAmount;
    fieldPathByMetric.endpoint_total = '$totalAmount';
    endpointTotal = toNumber(rawTotalAmount);
    const manualStatus = endpointTotal === null ? 422 : 200;
    const manualPreview = summarizeRaw({
      totalAmount: rawTotalAmount ?? null,
      parsedTotalAmount: endpointTotal,
    });
    collectedProbes.push({
      strategy: 'region-endpoint_total-manual',
      path: 'env://$totalAmount',
      status: manualStatus,
      latencyMs: 0,
      contentType: 'application/json',
      preview: manualPreview,
      attempts: [
        {
          url: 'env://$totalAmount',
          status: manualStatus,
          latencyMs: 0,
          contentType: 'application/json',
          requestHeaders: {},
          bodyPreview: manualPreview,
          ...(endpointTotal === null ? { error: '环境变量 $totalAmount 未提供或不是数字' } : {}),
        },
      ],
      purpose: 'amount',
      note: '手动设置模式：端点总额直接读取环境变量 $totalAmount',
    });
    if (endpointTotal === null) {
      const rawText = typeof rawTotalAmount === 'string' ? rawTotalAmount.trim() : String(rawTotalAmount ?? '').trim();
      sourceByMetric.endpoint_total = rawText
        ? `${definition.displayName} $totalAmount（非数字）`
        : `${definition.displayName} $totalAmount（未提供）`;
    } else {
      sourceByMetric.endpoint_total = `${definition.displayName} $totalAmount`;
    }
  }

  const applySubtractMetric = (
    metricKey: 'endpoint_remaining' | 'endpoint_used',
    expressionLabel: string,
    expressionFieldPath: string,
    minuend: number | null,
    minuendLabel: string,
    subtrahend: number | null,
    subtrahendLabel: string,
  ): number | null => {
    sourceByMetric[metricKey] = `${definition.displayName} ${expressionLabel}`;
    fieldPathByMetric[metricKey] = expressionFieldPath;
    if (minuend !== null && subtrahend !== null) {
      return minuend - subtrahend;
    }
    const missingParts: string[] = [];
    if (minuend === null) {
      missingParts.push(minuendLabel);
    }
    if (subtrahend === null) {
      missingParts.push(subtrahendLabel);
    }
    sourceByMetric[metricKey] = `${definition.displayName} ${expressionLabel}（缺少${missingParts.join('、')}）`;
    if (!lastFailure) {
      lastFailure = buildUnsupported(
        `region-${metricKey}-subtract`,
        `${definition.displayName} ${expressionLabel} 失败：缺少${missingParts.join('、')}`,
      );
    }
    return null;
  };

  if (endpointRemainingMode === 'subtract_from_total') {
    endpointRemaining = applySubtractMetric(
      'endpoint_remaining',
      '端点总额 - 端点已用',
      '$endpointTotal - $endpointUsed',
      endpointTotal,
      '端点总额',
      endpointUsed,
      '端点已用',
    );
  }

  if (endpointUsedMode === 'subtract_from_total') {
    endpointUsed = applySubtractMetric(
      'endpoint_used',
      '端点总额 - 端点余额',
      '$endpointTotal - $endpointRemaining',
      endpointTotal,
      '端点总额',
      endpointRemaining,
      '端点余额',
    );
  }

  if (region.middle.mode === 'token_usage' && region.middle.token_usage) {
    const tokenConfig: RegionTokenUsageConfig = region.middle.token_usage;
    tokenUsedFieldPath = tokenConfig.usedField ?? null;
    tokenAvailableFieldPath = tokenConfig.remainingField ?? null;
    const queried = await queryRegion('region-middle-token_usage', 'token_usage', tokenConfig);
    if (queried) {
      const rawUsed = extractField(queried.data, tokenConfig.usedField);
      const rawRemaining = extractField(queried.data, tokenConfig.remainingField);
      tokenUsed = applyFormula(rawUsed, tokenConfig.usedFormula);
      tokenAvailable = applyFormula(rawRemaining, tokenConfig.remainingFormula);
      if (tokenUsed !== null) {
        tokenUsedSource = `${definition.displayName} ${queried.resolvedPath}`;
      }
      if (tokenAvailable !== null) {
        tokenAvailableSource = `${definition.displayName} ${queried.resolvedPath}`;
      }
    }
  }

  if (region.middle.mode === 'reset_date' && region.middle.reset_date) {
    const resetConfig: RegionResetDateConfig = region.middle.reset_date;
    lastCreditResetFieldPath = resetConfig.resetField ?? null;
    const queried = await queryRegion('region-middle-reset_date', 'reset_date', resetConfig);
    if (queried) {
      const reset = extractField(queried.data, resetConfig.resetField);
      if (reset !== null && reset !== undefined) {
        lastCreditReset = String(reset);
        lastCreditResetSource = `${definition.displayName} ${queried.resolvedPath}`;
      }
    }
  }

  const totalUsd = endpointTotal;
  const usedUsd = endpointUsed;
  const remainingUsd = endpointRemaining;

  if (totalUsd !== null || usedUsd !== null || remainingUsd !== null) {
    return {
      result: finalizeResult({
        status: 'ok',
        strategy: 'region-config',
        totalUsd,
        usedUsd,
        remainingUsd,
        totalSource: sourceByMetric.endpoint_total ?? null,
        regionMetrics: {
          vendorUsedUsd: vendorUsed,
          vendorRemainingUsd: vendorRemaining,
          endpointUsedUsd: endpointUsed,
          endpointRemainingUsd: endpointRemaining,
          endpointTotalUsd: endpointTotal,
        },
        regionSources: {
          vendorUsed: sourceByMetric.vendor_used ?? null,
          vendorRemaining: sourceByMetric.vendor_remaining ?? null,
          endpointUsed: sourceByMetric.endpoint_used ?? null,
          endpointRemaining: sourceByMetric.endpoint_remaining ?? null,
          endpointTotal: sourceByMetric.endpoint_total ?? null,
          tokenUsed: tokenUsedSource,
          tokenAvailable: tokenAvailableSource,
          lastCreditReset: lastCreditResetSource,
        },
        regionFieldPaths: {
          vendorUsed: fieldPathByMetric.vendor_used ?? null,
          vendorRemaining: fieldPathByMetric.vendor_remaining ?? null,
          endpointUsed: fieldPathByMetric.endpoint_used ?? null,
          endpointRemaining: fieldPathByMetric.endpoint_remaining ?? null,
          endpointTotal: fieldPathByMetric.endpoint_total ?? null,
          tokenUsed: tokenUsedFieldPath,
          tokenAvailable: tokenAvailableFieldPath,
          lastCreditReset: lastCreditResetFieldPath,
          aggregationMode: JSON.stringify({
            vendor_remaining: vendorRemainingAggregateMode,
            vendor_used: vendorUsedAggregateMode,
          }),
          endpointTotalMode,
        },
        usedSource: sourceByMetric.endpoint_used ?? sourceByMetric.vendor_used ?? null,
        remainingSource: sourceByMetric.endpoint_remaining ?? sourceByMetric.vendor_remaining ?? null,
        rawSnippet: lastRawSnippet,
        latencyMs: maxLatency || null,
        credentialIssue: null,
        ...(tokenUsed !== null ? { tokenUsed } : {}),
        ...(tokenAvailable !== null ? { tokenAvailable } : {}),
        ...(lastCreditReset !== null ? { lastCreditReset } : {}),
      }),
      debugProbes: collectedProbes,
      refreshedAccessToken,
      refreshedCookieValue,
      ...(Object.keys(refreshedEnvVars).length > 0 ? { refreshedEnvVars: { ...refreshedEnvVars } } : {}),
    };
  }

  const fallback = lastFailure ?? buildUnsupported('none', `${definition.displayName} 区域配置均未命中有效值`);
  return {
    result: finalizeResult({
      ...fallback,
      totalSource: sourceByMetric.endpoint_total ?? null,
      regionMetrics: {
        vendorUsedUsd: vendorUsed,
        vendorRemainingUsd: vendorRemaining,
        endpointUsedUsd: endpointUsed,
        endpointRemainingUsd: endpointRemaining,
        endpointTotalUsd: endpointTotal,
      },
      regionSources: {
        vendorUsed: sourceByMetric.vendor_used ?? null,
        vendorRemaining: sourceByMetric.vendor_remaining ?? null,
        endpointUsed: sourceByMetric.endpoint_used ?? null,
        endpointRemaining: sourceByMetric.endpoint_remaining ?? null,
        endpointTotal: sourceByMetric.endpoint_total ?? null,
        tokenUsed: tokenUsedSource,
        tokenAvailable: tokenAvailableSource,
        lastCreditReset: lastCreditResetSource,
      },
      regionFieldPaths: {
        vendorUsed: fieldPathByMetric.vendor_used ?? null,
        vendorRemaining: fieldPathByMetric.vendor_remaining ?? null,
        endpointUsed: fieldPathByMetric.endpoint_used ?? null,
        endpointRemaining: fieldPathByMetric.endpoint_remaining ?? null,
        endpointTotal: fieldPathByMetric.endpoint_total ?? null,
        tokenUsed: tokenUsedFieldPath,
        tokenAvailable: tokenAvailableFieldPath,
        lastCreditReset: lastCreditResetFieldPath,
        aggregationMode: JSON.stringify({
          vendor_remaining: vendorRemainingAggregateMode,
          vendor_used: vendorUsedAggregateMode,
        }),
        endpointTotalMode,
      },
      ...(tokenUsed !== null ? { tokenUsed } : {}),
      ...(tokenAvailable !== null ? { tokenAvailable } : {}),
      ...(lastCreditReset !== null ? { lastCreditReset } : {}),
    }),
    debugProbes: collectedProbes,
    refreshedAccessToken,
    refreshedCookieValue,
    ...(Object.keys(refreshedEnvVars).length > 0 ? { refreshedEnvVars: { ...refreshedEnvVars } } : {}),
  };
}

export async function executeVendorDailyCheckin(
  provider: EndpointIdentity,
  definition: VendorDefinition,
): Promise<VendorDailyCheckinOutput> {
  const request = definition.regionConfig.dailyCheckinEnabled
    ? definition.regionConfig.dailyCheckin
    : null;
  if (!request) {
    return {
      status: 'unsupported',
      message: '当前类型未启用每日签到功能',
      checkinDate: null,
      quotaAwarded: null,
      source: null,
      fieldPaths: {
        checkinDate: null,
        quotaAwarded: null,
      },
      debugProbes: [],
      refreshedAccessToken: null,
      refreshedCookieValue: null,
    };
  }

  if (!validateStrategyPath(request.path)) {
    return {
      status: 'unsupported',
      message: `每日签到路径无效: ${request.path}`,
      checkinDate: null,
      quotaAwarded: null,
      source: null,
      fieldPaths: {
        checkinDate: request.dateField ?? null,
        quotaAwarded: request.awardedField ?? null,
      },
      debugProbes: [],
      refreshedAccessToken: null,
      refreshedCookieValue: null,
    };
  }

  const collectedProbes: QuotaDebugProbe[] = [];
  let runtimeCredentials: RuntimeCredentials = {
    apiKey: provider.apiKey,
    cookieValue: provider.cookieValue ?? null,
    userId: provider.userId ?? null,
    urlKeyName: provider.urlKeyName ?? null,
  };
  let runtimeTemplateVariables: Record<string, string> | undefined = provider.templateVariables
    ? { ...provider.templateVariables }
    : undefined;
  let refreshedAccessToken: string | null = null;
  let refreshedCookieValue: string | null = null;
  const refreshedEnvVars: Record<string, string> = {};

  const executeOnce = async (
    credentials: RuntimeCredentials,
  ): Promise<{ resolvedPath: string; response: HttpResponse }> => {
    const auth = resolveAuth(request.auth, credentials);
    const vars = buildTemplateVars(credentials, runtimeTemplateVariables);
    const requestBaseUrl = applyBaseUrlReplacements(provider.baseUrl, request.baseUrlReplacements);
    const resolvedPath = buildPathWithQuery(request.path, resolveQueryParams(request.queryParams, vars));
    const requestHeaders = resolveRequestHeaders(request.requestHeaders, vars);

    if (request.method === 'GET') {
      const response = await getJsonWithAuth(
        requestBaseUrl,
        resolvedPath,
        auth,
        requestHeaders,
        credentials.userId,
        {
          autoHandle403Intercept: request.autoHandle403Intercept !== false,
        },
      );
      return { resolvedPath, response };
    }

    const body = resolveRequestBody(request.requestBody, vars) ?? {};
    const response = request.method === 'PUT'
      ? await putJsonWithResolvedAuth(
          requestBaseUrl,
          resolvedPath,
          body,
          auth,
          requestHeaders,
          credentials.userId,
          {
            autoHandle403Intercept: request.autoHandle403Intercept !== false,
          },
        )
      : await postJsonWithResolvedAuth(
          requestBaseUrl,
          resolvedPath,
          body,
          auth,
          requestHeaders,
          credentials.userId,
          {
            autoHandle403Intercept: request.autoHandle403Intercept !== false,
          },
        );
    return { resolvedPath, response };
  };

  try {
    let { resolvedPath, response } = await executeOnce(runtimeCredentials);
    let probe = toDebugProbe('region-daily_checkin', resolvedPath, response, {
      purpose: 'daily_checkin',
      note: '每日签到请求',
    });
    let httpStatus = statusFromCode(response.status);

    if (
      response.status === 401
      && request.refreshOnUnauth
      && (request.refreshPath || (definition.regionConfig.refreshTokenEnabled && definition.regionConfig.refreshToken))
    ) {
      const refresh = await tryRefreshCredentials(
        provider,
        {
          name: 'region-daily_checkin',
          auth: request.auth,
          baseUrlReplacements: request.baseUrlReplacements,
          autoHandle403Intercept: request.autoHandle403Intercept,
          refreshOnUnauth: request.refreshOnUnauth,
          refreshPath: request.refreshPath,
          refreshBodyTemplate: request.refreshBodyTemplate,
          refreshResponseMappings: request.refreshResponseMappings,
          requestHeaders: request.requestHeaders,
        },
        runtimeCredentials,
        definition.regionConfig.refreshTokenEnabled ? definition.regionConfig.refreshToken : null,
        runtimeTemplateVariables,
      );
      if (refresh.probe) {
        collectedProbes.push(refresh.probe);
      }
      if (!refresh.error) {
        const mappedRefreshAccess = pickMappedCredentialValue(refresh.envUpdates, ACCESS_TOKEN_ENV_KEY);
        const mappedRefreshCookie = pickMappedCredentialValue(refresh.envUpdates, REFRESH_TOKEN_ENV_KEY);
        runtimeCredentials = refresh.updated;
        if (mappedRefreshAccess) {
          refreshedAccessToken = mappedRefreshAccess;
        }
        if (mappedRefreshCookie) {
          refreshedCookieValue = mappedRefreshCookie;
        }
        runtimeTemplateVariables = mergeRuntimeTemplateVars(
          runtimeTemplateVariables,
          mappedRefreshAccess,
          mappedRefreshCookie,
          refresh.envUpdates,
        );
        for (const [key, value] of Object.entries(refresh.envUpdates)) {
          const trimmedKey = key.trim();
          const trimmedValue = value.trim();
          if (!trimmedKey || !trimmedValue) continue;
          refreshedEnvVars[trimmedKey] = trimmedValue;
        }
        const retried = await executeOnce(runtimeCredentials);
        resolvedPath = retried.resolvedPath;
        response = retried.response;
        probe = toDebugProbe('region-daily_checkin-retry', resolvedPath, response, {
          purpose: 'daily_checkin',
          note: '刷新 token 后重试每日签到',
        });
        httpStatus = statusFromCode(response.status);
      }
    }

    collectedProbes.push(probe);

    if (httpStatus === 'unauthorized') {
      return {
        status: 'unauthorized',
        message: `每日签到鉴权失败 (${response.status})`,
        checkinDate: null,
        quotaAwarded: null,
        source: `${definition.displayName} ${resolvedPath}`,
        fieldPaths: {
          checkinDate: request.dateField ?? null,
          quotaAwarded: request.awardedField ?? null,
        },
        debugProbes: collectedProbes,
        refreshedAccessToken,
        refreshedCookieValue,
        ...(Object.keys(refreshedEnvVars).length > 0 ? { refreshedEnvVars: { ...refreshedEnvVars } } : {}),
      };
    }

    if (httpStatus === 'network_error') {
      return {
        status: 'network_error',
        message: `每日签到请求失败：HTTP ${response.status}`,
        checkinDate: null,
        quotaAwarded: null,
        source: `${definition.displayName} ${resolvedPath}`,
        fieldPaths: {
          checkinDate: request.dateField ?? null,
          quotaAwarded: request.awardedField ?? null,
        },
        debugProbes: collectedProbes,
        refreshedAccessToken,
        refreshedCookieValue,
        ...(Object.keys(refreshedEnvVars).length > 0 ? { refreshedEnvVars: { ...refreshedEnvVars } } : {}),
      };
    }

    if (isLikelyHtml(response.bodyText, response.contentType)) {
      return {
        status: 'parse_error',
        message: '每日签到返回 HTML，无法解析为 JSON',
        checkinDate: null,
        quotaAwarded: null,
        source: `${definition.displayName} ${resolvedPath}`,
        fieldPaths: {
          checkinDate: request.dateField ?? null,
          quotaAwarded: request.awardedField ?? null,
        },
        debugProbes: collectedProbes,
        refreshedAccessToken,
        refreshedCookieValue,
        ...(Object.keys(refreshedEnvVars).length > 0 ? { refreshedEnvVars: { ...refreshedEnvVars } } : {}),
      };
    }

    const data = response.json;

    const rawDate = extractField(data, request.dateField);
    const dateFieldHit = rawDate !== null && rawDate !== undefined;
    const checkinDate = dateFieldHit ? String(rawDate) : null;

    const rawAwarded = extractField(data, request.awardedField);
    const awardedFieldHit = rawAwarded !== null && rawAwarded !== undefined;
    // Daily checkin commonly returns boolean success flags; coerce true/false -> 1/0 before formula.
    const coercedAwarded = typeof rawAwarded === 'boolean' ? (rawAwarded ? 1 : 0) : rawAwarded;
    const quotaAwarded = applyFormula(coercedAwarded, request.awardedFormula);
    const source = `${definition.displayName} ${resolvedPath}`;
    const missing: string[] = [];
    if (!dateFieldHit) {
      missing.push('签到日期');
    }
    if (!awardedFieldHit || quotaAwarded === null) {
      missing.push('签到奖励');
    }

    return {
      status: missing.length === 2 ? 'parse_error' : 'ok',
      message: missing.length > 0 ? `每日签到响应字段未命中：${missing.join('、')}` : null,
      checkinDate,
      quotaAwarded,
      source,
      fieldPaths: {
        checkinDate: request.dateField ?? null,
        quotaAwarded: request.awardedField ?? null,
      },
      debugProbes: collectedProbes,
      refreshedAccessToken,
      refreshedCookieValue,
      ...(Object.keys(refreshedEnvVars).length > 0 ? { refreshedEnvVars: { ...refreshedEnvVars } } : {}),
    };
  } catch (error) {
    return {
      status: 'network_error',
      message: error instanceof Error ? error.message : String(error),
      checkinDate: null,
      quotaAwarded: null,
      source: null,
      fieldPaths: {
        checkinDate: request.dateField ?? null,
        quotaAwarded: request.awardedField ?? null,
      },
      debugProbes: collectedProbes,
      refreshedAccessToken,
      refreshedCookieValue,
      ...(Object.keys(refreshedEnvVars).length > 0 ? { refreshedEnvVars: { ...refreshedEnvVars } } : {}),
    };
  }
}
