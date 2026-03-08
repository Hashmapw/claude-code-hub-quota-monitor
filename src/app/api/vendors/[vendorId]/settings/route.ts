import { NextResponse } from 'next/server';
import {
  getVendorSetting,
  listVendorOptions,
  upsertVendorSetting,
} from '@/lib/vendor-settings';
import {
  findMissingRequiredEnvVars,
  formatMissingEnvVarLabels,
  requireRegisteredVendorType,
} from '@/lib/vendor-definitions';
import { deleteCachedVendorResult } from '@/lib/quota/vendor-cache';

type UpdatePayload = {
  vendorType?: string | null;
  envVars?: Record<string, string> | null;
};

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


export async function GET(
  _request: Request,
  context: { params: Promise<{ vendorId: string }> },
): Promise<Response> {
  try {
    const { vendorId: vendorIdRaw } = await context.params;
    const vendorId = Number(vendorIdRaw);

    if (!Number.isInteger(vendorId) || vendorId <= 0) {
      return NextResponse.json({ ok: false, message: 'vendorId 非法' }, { status: 400 });
    }

    const vendor = getVendorSetting(vendorId);
    if (!vendor) {
      return NextResponse.json({ ok: false, message: '服务商不存在' }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      vendor,
      vendors: listVendorOptions(),
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

export async function PUT(
  request: Request,
  context: { params: Promise<{ vendorId: string }> },
): Promise<Response> {
  try {
    const { vendorId: vendorIdRaw } = await context.params;
    const vendorId = Number(vendorIdRaw);

    if (!Number.isInteger(vendorId) || vendorId <= 0) {
      return NextResponse.json({ ok: false, message: 'vendorId 非法' }, { status: 400 });
    }

    const body = (await request.json()) as UpdatePayload;

    const existing = getVendorSetting(vendorId);
    if (!existing) {
      return NextResponse.json({ ok: false, message: '服务商不存在' }, { status: 404 });
    }

    let nextVendorType: string;
    try {
      nextVendorType = requireRegisteredVendorType(body.vendorType ?? existing.vendorType);
    } catch (error) {
      return NextResponse.json(
        { ok: false, message: error instanceof Error ? error.message : String(error) },
        { status: 400 },
      );
    }
    const nextEnvVars =
      body.envVars === undefined ? (existing.envVars ?? {}) : normalizeEnvVars(body.envVars);
    const missingRequiredEnvVars = findMissingRequiredEnvVars(nextVendorType, 'vendor', nextEnvVars);
    if (missingRequiredEnvVars.length > 0) {
      const missingLabels = formatMissingEnvVarLabels(missingRequiredEnvVars);
      return NextResponse.json(
        { ok: false, message: `缺少必填环境变量：${missingLabels.join('、')}` },
        { status: 400 },
      );
    }

    const vendor = upsertVendorSetting({
      vendorId,
      vendorType: nextVendorType,
      envVars: nextEnvVars,
    });

    await deleteCachedVendorResult(vendorId);

    return NextResponse.json({
      ok: true,
      vendor,
      vendors: listVendorOptions(),
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
