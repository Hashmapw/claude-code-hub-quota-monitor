import { NextResponse } from 'next/server';
import { listVendorOptions } from '@/lib/vendor-settings';
import { refreshEndpointQuota } from '@/lib/quota/service';

export async function POST(
  _request: Request,
  context: { params: Promise<{ endpointId: string }> },
): Promise<Response> {
  try {
    const { endpointId: endpointIdRaw } = await context.params;
    const endpointId = Number(endpointIdRaw);

    if (!Number.isInteger(endpointId) || endpointId <= 0) {
      return NextResponse.json({ ok: false, message: 'endpointId 非法' }, { status: 400 });
    }

    const record = await refreshEndpointQuota(endpointId);

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      endpoints: listVendorOptions(),
      record,
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
