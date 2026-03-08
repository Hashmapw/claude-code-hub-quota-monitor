import { NextResponse } from 'next/server';
import { listVendorOptions } from '@/lib/vendor-settings';
import { detectVendorApiKind, listAvailableVendorTypes, listVendorDefinitions } from '@/lib/vendor-definitions';
import { getSystemSettings } from '@/lib/system-settings';
import { getQuotaRecordByEndpointId } from '@/lib/quota/service';

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

export async function GET(
  _request: Request,
  context: { params: Promise<{ endpointId: string }> },
): Promise<Response> {
  try {
    const { endpointId: endpointIdRaw } = await context.params;
    const endpointId = Number(endpointIdRaw);

    if (!Number.isInteger(endpointId) || endpointId <= 0) {
      return NextResponse.json({ ok: false, message: 'endpointId 非法' }, { status: 400 });
    }

    const record = await getQuotaRecordByEndpointId(endpointId);
    if (!record) {
      return NextResponse.json({ ok: false, message: '端点不存在' }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      meta: buildMeta(),
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
