import { NextResponse } from 'next/server';
import { ensureSystemSchedulerStarted } from '@/lib/system-scheduler';
import { getSystemSettings, upsertSystemSettings } from '@/lib/system-settings';

type UpdatePayload = {
  systemDisplayName?: string | null;
  proxyUrl?: string | null;
  vendorTypeDocs?: Record<string, string | null | undefined> | null;
  includeDisabled?: boolean | null;
  requestTimeoutMs?: number | string | null;
  concurrency?: number | string | null;
  autoRefreshEnabled?: boolean | null;
  autoRefreshIntervalMinutes?: number | string | null;
  autoCleanupAfterRefreshEnabled?: boolean | null;
  dailyCheckinScheduleEnabled?: boolean | null;
  dailyCheckinScheduleTimes?: string[] | null;
  balanceRefreshAnomalyThresholdPercent?: number | string | null;
  balanceRefreshAnomalyVendorIds?: number[] | null;
};

export async function GET(): Promise<Response> {
  try {
    ensureSystemSchedulerStarted();
    const settings = getSystemSettings();
    return NextResponse.json({
      ok: true,
      settings,
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

export async function PUT(request: Request): Promise<Response> {
  try {
    ensureSystemSchedulerStarted();
    const body = (await request.json().catch(() => ({}))) as UpdatePayload;
    const settings = upsertSystemSettings({
      systemDisplayName: body.systemDisplayName,
      proxyUrl: body.proxyUrl,
      vendorTypeDocs: body.vendorTypeDocs,
      includeDisabled: body.includeDisabled,
      requestTimeoutMs: body.requestTimeoutMs,
      concurrency: body.concurrency,
      autoRefreshEnabled: body.autoRefreshEnabled,
      autoRefreshIntervalMinutes: body.autoRefreshIntervalMinutes,
      autoCleanupAfterRefreshEnabled: body.autoCleanupAfterRefreshEnabled,
      dailyCheckinScheduleEnabled: body.dailyCheckinScheduleEnabled,
      dailyCheckinScheduleTimes: body.dailyCheckinScheduleTimes,
      balanceRefreshAnomalyThresholdPercent: body.balanceRefreshAnomalyThresholdPercent,
      balanceRefreshAnomalyVendorIds: body.balanceRefreshAnomalyVendorIds,
    });

    return NextResponse.json({
      ok: true,
      settings,
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
