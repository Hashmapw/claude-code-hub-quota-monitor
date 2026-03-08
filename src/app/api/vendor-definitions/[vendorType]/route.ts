import { NextResponse } from 'next/server';
import {
  getVendorDefinition,
  upsertVendorDefinition,
  deleteVendorDefinition,
  type VendorEnvVarDefinition,
  type VendorRegionConfig,
} from '@/lib/vendor-definitions';

type RouteContext = { params: Promise<{ vendorType: string }> };

function inferValidationStatus(message: string): number {
  const lower = message.toLowerCase();
  if (
    lower.includes('不能为空') ||
    lower.includes('仅允许') ||
    lower.includes('必须') ||
    lower.includes('无效') ||
    lower.includes('重复')
  ) {
    return 400;
  }
  return 500;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { vendorType } = await context.params;
    const definition = getVendorDefinition(vendorType);
    if (!definition) {
      return NextResponse.json({ ok: false, message: `未找到类型定义: ${vendorType}` }, { status: 404 });
    }
    return NextResponse.json({ ok: true, definition });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { vendorType } = await context.params;
    const existing = getVendorDefinition(vendorType);
    if (!existing) {
      return NextResponse.json({ ok: false, message: `未找到类型定义: ${vendorType}` }, { status: 404 });
    }

    const body = (await request.json()) as {
      displayName?: string;
      description?: string | null;
      regionConfig?: VendorRegionConfig;
      envVars?: VendorEnvVarDefinition[];
    };
    if (!body.regionConfig) {
      return NextResponse.json({ ok: false, message: 'regionConfig 为必填' }, { status: 400 });
    }

    const definition = upsertVendorDefinition({
      vendorType: existing.vendorType,
      displayName: body.displayName ?? existing.displayName,
      description: body.description !== undefined ? body.description : existing.description,
      regionConfig: body.regionConfig ?? existing.regionConfig,
      envVars: body.envVars ?? existing.envVars,
    });

    return NextResponse.json({ ok: true, definition });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { ok: false, message },
      { status: inferValidationStatus(message) },
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { vendorType } = await context.params;
    deleteVendorDefinition(vendorType);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('不可删除') ? 403 : message.includes('不存在') ? 404 : 500;
    return NextResponse.json({ ok: false, message }, { status });
  }
}
