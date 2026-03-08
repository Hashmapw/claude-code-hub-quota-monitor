import { NextResponse } from 'next/server';
import { getEndpointById } from '@/lib/db';
import { getEndpointSetting } from '@/lib/vendor-settings';
import { getCachedDebugSnapshot } from '@/lib/quota/debug-cache';
import { getCachedVendorResult } from '@/lib/quota/vendor-cache';

function hasFiniteAmount(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
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

    const provider = await getEndpointById(endpointId);
    if (!provider) {
      return NextResponse.json({ ok: false, message: '端点不存在' }, { status: 404 });
    }

    const setting = getEndpointSetting(endpointId);
    const endpointQuota = setting?.vendorId ? await getCachedVendorResult(setting.vendorId) : null;
    const snapshot = await getCachedDebugSnapshot(endpointId);
    const vendorUsedUsd =
      endpointQuota?.status === 'ok'
        ? endpointQuota.regionMetrics?.vendorUsedUsd ?? endpointQuota.usedUsd ?? null
        : endpointQuota?.staleLock?.usedUsd ?? null;
    const vendorRemainingUsd =
      endpointQuota?.status === 'ok'
        ? endpointQuota.regionMetrics?.vendorRemainingUsd ?? endpointQuota.remainingUsd ?? null
        : endpointQuota?.staleLock?.remainingUsd ?? null;
    const vendorTotalUsd =
      (setting?.useVendorAmount ?? false) && hasFiniteAmount(vendorUsedUsd) && hasFiniteAmount(vendorRemainingUsd)
        ? vendorUsedUsd + vendorRemainingUsd
        : null;

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      endpoint: {
        id: provider.id,
        name: provider.name,
        url: provider.url,
        vendorId: setting?.vendorId ?? null,
        vendorName: setting?.vendorName ?? null,
        vendorType: setting?.vendorType ?? null,
        billingMode: setting?.billingMode ?? 'usage',
        useVendorAmount: setting?.useVendorAmount ?? false,
        vendorTotalUsd,
        vendorBalanceUsd: endpointQuota?.remainingUsd ?? null,
        vendorBalanceCheckedAt: endpointQuota?.checkedAt ?? null,
        vendorBalanceStrategy: endpointQuota?.strategy ?? null,
      },
      snapshotGeneratedAt: snapshot?.generatedAt ?? null,
      resultStatus: snapshot?.resultStatus ?? null,
      resultStrategy: snapshot?.resultStrategy ?? null,
      resultMessage: snapshot?.resultMessage ?? null,
      resultTotalUsd: snapshot?.resultTotalUsd ?? null,
      resultUsedUsd: snapshot?.resultUsedUsd ?? null,
      resultRemainingUsd: snapshot?.resultRemainingUsd ?? null,
      resultStaleLock: snapshot?.resultStaleLock ?? null,
      resultTokenUsed: snapshot?.resultTokenUsed ?? null,
      resultTokenAvailable: snapshot?.resultTokenAvailable ?? null,
      resultLastCreditReset: snapshot?.resultLastCreditReset ?? null,
      resultTotalSource: snapshot?.resultTotalSource ?? null,
      resultUsedSource: snapshot?.resultUsedSource ?? null,
      resultRemainingSource: snapshot?.resultRemainingSource ?? null,
      resultRegionMetrics: snapshot?.resultRegionMetrics ?? null,
      resultRegionSources: snapshot?.resultRegionSources ?? null,
      resultRegionFieldPaths: snapshot?.resultRegionFieldPaths ?? null,
      resultDailyCheckinDate: snapshot?.resultDailyCheckinDate ?? null,
      resultDailyCheckinAwarded: snapshot?.resultDailyCheckinAwarded ?? null,
      resultDailyCheckinSource: snapshot?.resultDailyCheckinSource ?? null,
      resultDailyCheckinStatus: snapshot?.resultDailyCheckinStatus ?? null,
      resultDailyCheckinMessage: snapshot?.resultDailyCheckinMessage ?? null,
      probes: snapshot?.probes ?? [],
      message: snapshot
        ? undefined
        : '暂无快照详情，请先点击该端点"刷新"后再查看详情。',
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
