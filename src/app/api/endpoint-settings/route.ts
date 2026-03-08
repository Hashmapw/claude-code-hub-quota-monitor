import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import {
  getVendorSettingsDatabasePath,
  listVendorOptions,
  listEndpointSettings,
  getEndpointSetting,
  getVendorSetting,
  upsertEndpointSetting,
  setEndpointHidden,
  normalizeEndpointToggles,
} from '@/lib/vendor-settings';
import {
  findMissingRequiredEnvVars,
  formatMissingEnvVarLabels,
  getVendorDefinition,
  listAvailableVendorTypes,
  listVendorDefinitions,
  requireRegisteredVendorType,
  detectVendorApiKind,
} from '@/lib/vendor-definitions';
import { getSystemSettings } from '@/lib/system-settings';

type UpdatePayload = {
  endpointId?: number;
  vendorId?: number | null;
  vendorName?: string | null;
  vendorType?: string | null;
  billingMode?: string | null;
  useVendorGroup?: boolean | number | string | null;
  useVendorUsed?: boolean | number | string | null;
  useVendorRemaining?: boolean | number | string | null;
  useVendorAmount?: boolean | number | string | null;
  useVendorBalance?: boolean | number | string | null;
  envVars?: Record<string, string> | null;
  isHidden?: boolean | number | string | null;
};

function normalizeEndpointId(value: number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const vendorId = Number(value);
  if (!Number.isInteger(vendorId) || vendorId <= 0) {
    throw new Error('vendorId 非法');
  }
  return vendorId;
}

function normalizeEndpointName(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeEnvVars(value: Record<string, string> | null | undefined): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [rawKey, rawVal] of Object.entries(value)) {
    if (typeof rawVal !== 'string') continue;
    const key = rawKey.trim().replace(/^\$+/, '');
    if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    const text = rawVal.trim();
    if (!text) continue;
    result[key] = text;
  }
  return result;
}

function debugSettingsLog(event: string, payload: Record<string, unknown>): void {
  if (!getConfig().debugHttp) {
    return;
  }

  // eslint-disable-next-line no-console
  console.info(
    '[provider-settings-debug]',
    JSON.stringify({
      event,
      ...payload,
      timestamp: new Date().toISOString(),
    }),
  );
}

function buildMeta() {
  const systemSettings = getSystemSettings();
  return {
    vendorTypes: listAvailableVendorTypes(),
    vendorTypeDocs: systemSettings.vendorTypeDocs,
    vendorDefinitions: listVendorDefinitions().map((d) => ({
      vendorType: d.vendorType,
      displayName: d.displayName,
      endpointTotalMode: d.regionConfig.endpointTotalMode,
      dailyCheckinEnabled: d.regionConfig.dailyCheckinEnabled === true,
      aggregation: d.regionConfig.aggregation ?? null,
      apiKind: detectVendorApiKind(d.vendorType),
    })),
    endpoints: listVendorOptions(),
  };
}

export async function GET(): Promise<Response> {
  try {
    return NextResponse.json({
      ok: true,
      ...buildMeta(),
      settings: listEndpointSettings(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as UpdatePayload;
    const endpointId = Number(body.endpointId);

    if (!Number.isInteger(endpointId) || endpointId <= 0) {
      return NextResponse.json({ ok: false, message: 'endpointId 非法' }, { status: 400 });
    }

    const isHideOnlyUpdate =
      body.isHidden !== undefined
      && body.vendorId === undefined
      && body.vendorName === undefined
      && body.vendorType === undefined
      && body.billingMode === undefined
      && body.useVendorGroup === undefined
      && body.useVendorUsed === undefined
      && body.useVendorRemaining === undefined
      && body.useVendorAmount === undefined
      && body.useVendorBalance === undefined
      && body.envVars === undefined;

    if (isHideOnlyUpdate) {
      setEndpointHidden(endpointId, !!body.isHidden);

      return NextResponse.json({
        ok: true,
        setting: getEndpointSetting(endpointId) ?? { endpointId, isHidden: !!body.isHidden },
        ...buildMeta(),
      });
    }

    const existing = getEndpointSetting(endpointId);
    const vendorId = normalizeEndpointId(body.vendorId);
    const linkedVendor = vendorId ? getVendorSetting(vendorId) : null;
    let vendorType: string;
    try {
      vendorType = linkedVendor?.vendorType
        ?? requireRegisteredVendorType(body.vendorType ?? existing?.vendorType);
    } catch (error) {
      return NextResponse.json(
        { ok: false, message: error instanceof Error ? error.message : String(error) },
        { status: 400 },
      );
    }
    const toggles = normalizeEndpointToggles(body, existing);
    const { useVendorGroup, useVendorBalance, useVendorAmount } = toggles;

    const definition = getVendorDefinition(vendorType);
    const vendorRemainingAggregation =
      definition?.regionConfig?.aggregation?.vendor_remaining
      ?? 'independent_request';
    if (useVendorGroup && useVendorBalance && vendorRemainingAggregation === 'endpoint_sum') {
      return NextResponse.json(
        {
          ok: false,
          message: '当前类型的服务商余额来自端点求和，端点不能再跟随服务商余额，避免循环依赖。',
        },
        { status: 400 },
      );
    }

    const nextEnvVars =
      body.envVars === undefined ? (existing?.envVars ?? {}) : normalizeEnvVars(body.envVars);
    const missingRequiredEnvVars = findMissingRequiredEnvVars(vendorType, 'endpoint', nextEnvVars, {
      useEndpointAmountAsManualTotalSource: useVendorAmount,
    });
    if (missingRequiredEnvVars.length > 0) {
      const missingLabels = formatMissingEnvVarLabels(missingRequiredEnvVars);
      return NextResponse.json(
        { ok: false, message: `缺少必填环境变量：${missingLabels.join('、')}` },
        { status: 400 },
      );
    }

    debugSettingsLog('request', {
      endpointId,
      vendorId: body.vendorId ?? null,
      vendorName: body.vendorName ?? null,
      vendorType,
      billingMode: body.billingMode ?? null,
      useVendorGroup: body.useVendorGroup ?? null,
      useVendorUsed: body.useVendorUsed ?? null,
      useVendorRemaining: body.useVendorRemaining ?? null,
      useVendorAmount: body.useVendorAmount ?? null,
      useVendorBalance: body.useVendorBalance ?? null,
      envVars: nextEnvVars,
      dbPath: getVendorSettingsDatabasePath(),
    });

    const setting = upsertEndpointSetting({
      endpointId,
      vendorId,
      vendorName: normalizeEndpointName(body.vendorName),
      vendorType,
      billingMode: body.billingMode,
      useVendorGroup: body.useVendorGroup,
      useVendorUsed: body.useVendorUsed,
      useVendorRemaining: body.useVendorRemaining,
      useVendorAmount: body.useVendorAmount,
      useVendorBalance: body.useVendorBalance,
      envVars: nextEnvVars,
      isHidden: body.isHidden,
    });

    debugSettingsLog('saved', {
      endpointId,
      vendorId: setting.vendorId,
      vendorName: setting.vendorName,
      vendorType: setting.vendorType,
      billingMode: setting.billingMode,
      useVendorGroup: setting.useVendorGroup,
      useVendorUsed: setting.useVendorUsed,
      useVendorRemaining: setting.useVendorRemaining,
      useVendorAmount: setting.useVendorAmount,
      useVendorBalance: setting.useVendorBalance,
      envVars: setting.envVars,
      updatedAt: setting.updatedAt,
      dbPath: getVendorSettingsDatabasePath(),
    });

    return NextResponse.json({
      ok: true,
      setting,
      ...buildMeta(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
