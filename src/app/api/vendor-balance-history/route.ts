import { NextResponse } from 'next/server';
import { getVendorBalanceHistoryPayload } from '@/lib/vendor-balance-history';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const vendorIdRaw = url.searchParams.get('vendorId');
    const parsedVendorId = Number(vendorIdRaw);
    const payload = getVendorBalanceHistoryPayload(
      Number.isInteger(parsedVendorId) && parsedVendorId > 0 ? parsedVendorId : null,
      url.searchParams.get('range'),
    );

    return NextResponse.json({
      ok: true,
      ...payload,
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
