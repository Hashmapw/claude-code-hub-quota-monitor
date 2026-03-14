import { NextResponse } from 'next/server';
import { getVendorBalanceHistoryHubDailyUsage, normalizeVendorBalanceHistoryRange } from '@/lib/vendor-balance-history';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const vendorIdRaw = url.searchParams.get('vendorId');
    const parsedVendorId = Number(vendorIdRaw);
    const range = normalizeVendorBalanceHistoryRange(url.searchParams.get('range'));
    const vendorId = Number.isInteger(parsedVendorId) && parsedVendorId > 0 ? parsedVendorId : null;
    const hubDailyUsage = await getVendorBalanceHistoryHubDailyUsage(vendorId, range);

    return NextResponse.json({
      ok: true,
      vendorId,
      range,
      hubDailyUsage,
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
