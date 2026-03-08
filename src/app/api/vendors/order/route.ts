import { NextResponse } from 'next/server';
import { listVendorOptions, updateVendorDisplayOrder } from '@/lib/vendor-settings';

type UpdateOrderPayload = {
  orderedVendorIds?: number[] | null;
};

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as UpdateOrderPayload;
    if (!Array.isArray(body.orderedVendorIds)) {
      return NextResponse.json(
        { ok: false, message: 'orderedVendorIds 必须是数组' },
        { status: 400 },
      );
    }

    updateVendorDisplayOrder(body.orderedVendorIds);

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
