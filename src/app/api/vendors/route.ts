import { NextResponse } from 'next/server';
import { listVendorOptions, upsertVendorByName } from '@/lib/vendor-settings';

type CreatePayload = {
  name?: string | null;
  vendorType?: string | null;
};

function normalizeName(value: string | null | undefined): string {
  const trimmed = (value || '').trim();
  if (!trimmed) {
    throw new Error('服务商名称不能为空');
  }
  return trimmed;
}

export async function GET(): Promise<Response> {
  try {
    return NextResponse.json({
      ok: true,
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

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as CreatePayload;
    const vendor = upsertVendorByName(normalizeName(body.name), body.vendorType);

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
      { status: 400 },
    );
  }
}
