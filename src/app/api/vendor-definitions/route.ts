import { NextResponse } from 'next/server';
import {
  listVendorDefinitions,
  upsertVendorDefinition,
  type VendorEnvVarDefinition,
  type VendorRegionConfig,
} from '@/lib/vendor-definitions';

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

export async function GET(): Promise<Response> {
  try {
    const definitions = listVendorDefinitions();
    return NextResponse.json({ ok: true, definitions });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as {
      vendorType?: string;
      displayName?: string;
      description?: string | null;
      regionConfig?: VendorRegionConfig;
      envVars?: VendorEnvVarDefinition[];
    };

    if (!body.vendorType || !body.displayName) {
      return NextResponse.json({ ok: false, message: 'vendorType 和 displayName 为必填' }, { status: 400 });
    }

    if (!body.regionConfig) {
      return NextResponse.json({ ok: false, message: 'regionConfig 为必填' }, { status: 400 });
    }

    const definition = upsertVendorDefinition({
      vendorType: body.vendorType,
      displayName: body.displayName,
      description: body.description,
      regionConfig: body.regionConfig,
      envVars: body.envVars,
    });

    return NextResponse.json({ ok: true, definition });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = inferValidationStatus(message);
    return NextResponse.json({ ok: false, message }, { status });
  }
}
