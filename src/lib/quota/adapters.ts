import {
  getEndpointSetting,
  getVendorSetting,
  upsertEndpointSetting,
  upsertVendorSetting,
} from '@/lib/vendor-settings';
import { getVendorDefinition } from '@/lib/vendor-definitions';
import {
  executeVendorDailyCheckin,
  executeVendorDefinition,
  type VendorDailyCheckinOutput,
} from '@/lib/quota/config-engine';
import type {
  EndpointIdentity,
  QuotaQueryOutput,
  QuotaResult,
} from '@/lib/quota/types';

type AdapterResult = Omit<QuotaResult, 'checkedAt'>;

type QueryOptions = {
  vendorType?: string | null;
  vendorId?: number | null;
};

const ACCESS_TOKEN_ENV_KEY_ALIASES = new Set([
  'accesstoken',
  'access_token',
  'accesstokenvalue',
  'jwttoken',
  'jwt_token',
  'apitoken',
  'token',
]);

const REFRESH_TOKEN_ENV_KEY_ALIASES = new Set([
  'refreshtoken',
  'refresh_token',
  'refreshtokenvalue',
]);

function mergeRefreshedCredentialEnvVars(
  existing: Record<string, string>,
  refreshedAccessToken: string | null | undefined,
  refreshedRefreshToken: string | null | undefined,
  refreshedEnvVars?: Record<string, string> | null,
): Record<string, string> {
  const next: Record<string, string> = { ...existing };
  const access = (refreshedAccessToken || '').trim();
  const refresh = (refreshedRefreshToken || '').trim();

  if (refreshedEnvVars && typeof refreshedEnvVars === 'object') {
    for (const [rawKey, rawValue] of Object.entries(refreshedEnvVars)) {
      const key = String(rawKey || '').trim();
      const value = String(rawValue || '').trim();
      if (!key || !value) continue;
      next[key] = value;
    }
  }

  if (access) {
    for (const key of Object.keys(next)) {
      if (ACCESS_TOKEN_ENV_KEY_ALIASES.has(key.toLowerCase())) {
        next[key] = access;
      }
    }
    next.AccessToken = access;
    next.JwtToken = access;
  }

  if (refresh) {
    for (const key of Object.keys(next)) {
      if (REFRESH_TOKEN_ENV_KEY_ALIASES.has(key.toLowerCase())) {
        next[key] = refresh;
      }
    }
    next.RefreshToken = refresh;
  }

  return next;
}

function persistRefreshedVendorCredentials(
  vendorId: number | null | undefined,
  refreshedAccessToken: string | null | undefined,
  refreshedCookieValue: string | null | undefined,
  refreshedEnvVars?: Record<string, string> | null,
): void {
  if (!vendorId || vendorId <= 0) {
    return;
  }
  if (!refreshedAccessToken && !refreshedCookieValue && (!refreshedEnvVars || Object.keys(refreshedEnvVars).length === 0)) {
    return;
  }

  try {
    const currentVendor = getVendorSetting(vendorId);
    const mergedEnvVars = mergeRefreshedCredentialEnvVars(
      currentVendor?.envVars ?? {},
      refreshedAccessToken,
      refreshedCookieValue,
      refreshedEnvVars,
    );

    upsertVendorSetting({
      vendorId,
      envVars: mergedEnvVars,
    });
  } catch {
    // Ignore persistence failure; query result remains valid.
  }
}

function persistRefreshedEndpointCredentials(
  endpointId: number | null | undefined,
  refreshedAccessToken: string | null | undefined,
  refreshedCookieValue: string | null | undefined,
  refreshedEnvVars?: Record<string, string> | null,
): void {
  if (!endpointId || endpointId <= 0) {
    return;
  }
  if (!refreshedAccessToken && !refreshedCookieValue && (!refreshedEnvVars || Object.keys(refreshedEnvVars).length === 0)) {
    return;
  }

  try {
    const currentSetting = getEndpointSetting(endpointId);
    if (!currentSetting) {
      return;
    }

    const mergedEnvVars = mergeRefreshedCredentialEnvVars(
      currentSetting.envVars ?? {},
      refreshedAccessToken,
      refreshedCookieValue,
      refreshedEnvVars,
    );

    upsertEndpointSetting({
      endpointId,
      vendorId: currentSetting.vendorId,
      vendorName: currentSetting.vendorName,
      envVars: mergedEnvVars,
    });
  } catch {
    // Ignore persistence failure; query result remains valid.
  }
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

function finalizeResult(result: AdapterResult): QuotaResult {
  return {
    ...result,
    checkedAt: new Date().toISOString(),
  };
}

function resolveEndpointType(provider: EndpointIdentity, options?: QueryOptions): string {
  const fromOption = options?.vendorType?.trim().toLowerCase();
  if (fromOption) {
    return fromOption;
  }

  const fromProvider = provider.vendorType?.trim().toLowerCase();
  if (fromProvider) {
    return fromProvider;
  }

  return '';
}

export async function queryEndpointQuotaWithDebug(
  provider: EndpointIdentity,
  options?: QueryOptions,
): Promise<QuotaQueryOutput> {
  const vendorType = resolveEndpointType(provider, options);
  const definition = getVendorDefinition(vendorType);

  if (!definition) {
    return {
      result: finalizeResult(
        buildUnsupported(
          'none',
          `未找到类型定义: ${vendorType}。请在"类型定义"页面配置该类型的区域查询规则`,
        ),
      ),
      debugProbes: [],
    };
  }

  try {
    const output = await executeVendorDefinition(provider, definition, {
      vendorId: options?.vendorId ?? null,
    });

    persistRefreshedVendorCredentials(
      options?.vendorId ?? null,
      output.refreshedAccessToken,
      output.refreshedCookieValue,
      output.refreshedEnvVars,
    );
    persistRefreshedEndpointCredentials(
      provider.id,
      output.refreshedAccessToken,
      output.refreshedCookieValue,
      output.refreshedEnvVars,
    );

    return output;
  } catch (error) {
    return {
      result: finalizeResult(
        buildUnsupported(
          'region-config',
          `类型定义执行失败: ${error instanceof Error ? error.message : String(error)}`,
        ),
      ),
      debugProbes: [],
    };
  }
}

export async function runVendorDailyCheckinWithDebug(
  provider: EndpointIdentity,
  options?: QueryOptions,
): Promise<VendorDailyCheckinOutput> {
  const vendorType = resolveEndpointType(provider, options);
  const definition = getVendorDefinition(vendorType);

  if (!definition) {
    return {
      status: 'unsupported',
      message: `未找到类型定义: ${vendorType}`,
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

  const output = await executeVendorDailyCheckin(provider, definition);
  persistRefreshedVendorCredentials(
    options?.vendorId ?? null,
    output.refreshedAccessToken,
    output.refreshedCookieValue,
    output.refreshedEnvVars,
  );
  persistRefreshedEndpointCredentials(
    provider.id,
    output.refreshedAccessToken,
    output.refreshedCookieValue,
    output.refreshedEnvVars,
  );
  return output;
}

export async function queryProviderQuota(
  provider: EndpointIdentity,
  options?: QueryOptions,
): Promise<QuotaResult> {
  const output = await queryEndpointQuotaWithDebug(provider, options);
  return output.result;
}
