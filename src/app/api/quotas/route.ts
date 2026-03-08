import { NextResponse } from 'next/server';
import { listVendorOptions } from '@/lib/vendor-settings';
import { detectVendorApiKind, listAvailableVendorTypes, listVendorDefinitions } from '@/lib/vendor-definitions';
import { getSystemSettings } from '@/lib/system-settings';
import { listQuotaRecordsFromCache, refreshAllEndpoints } from '@/lib/quota/service';

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

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const refresh = url.searchParams.get('refresh') === '1';
    const records = refresh ? await refreshAllEndpoints() : await listQuotaRecordsFromCache();

    return NextResponse.json({
      ok: true,
      total: records.length,
      refreshed: refresh,
      generatedAt: new Date().toISOString(),
      meta: buildMeta(),
      records,
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
    const body = (await request.json().catch(() => ({}))) as { action?: string };
    if (body.action === 'refresh') {
      const records = await refreshAllEndpoints();
      return NextResponse.json({
        ok: true,
        total: records.length,
        generatedAt: new Date().toISOString(),
        meta: buildMeta(),
        records,
      });
    }

    return NextResponse.json({ ok: false, message: 'Unsupported action' }, { status: 400 });
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
