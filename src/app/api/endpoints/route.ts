import { NextResponse } from 'next/server';
import { logInfo } from '@/lib/logger';
import { listVendorOptions } from '@/lib/vendor-settings';
import { detectVendorApiKind, listAvailableVendorTypes, listUsedEnvVars, listVendorDefinitions } from '@/lib/vendor-definitions';
import { getSystemSettings } from '@/lib/system-settings';
import { recordDailyCheckinAttempt } from '@/lib/daily-checkin-history';
import {
  listQuotaRecordsFromCache,
  refreshAllEndpoints,
  refreshEndpointsByVendor,
  runVendorDailyCheckin,
} from '@/lib/quota/service';
import type { QuotaDebugProbe } from '@/lib/quota/types';

function buildEnvVarsForPanel(
  panelScope: 'vendor' | 'endpoint',
  used: Array<{
    key: string;
    label: string;
    scope: 'vendor' | 'endpoint';
    meaning?: string | null;
    optional?: boolean;
    defaultValue?: string | null;
  }>,
  declared: Array<{
    key: string;
    label: string;
    scope: 'vendor' | 'endpoint';
    meaning?: string | null;
    optional?: boolean;
    defaultValue?: string | null;
  }>,
) {
  const result: Array<{
    key: string;
    label: string;
    scope: 'vendor' | 'endpoint';
    meaning?: string | null;
    optional?: boolean;
    defaultValue?: string | null;
  }> = [];
  const seen = new Set<string>();
  const append = (
    item: {
      key: string;
      label: string;
      scope: 'vendor' | 'endpoint';
      meaning?: string | null;
      optional?: boolean;
      defaultValue?: string | null;
    },
  ) => {
    const key = (item.key || '').trim();
    if (!key) return;
    const lowered = key.toLowerCase();
    if (seen.has(lowered)) return;
    seen.add(lowered);
    result.push({
      ...item,
      scope: panelScope,
    });
  };
  for (const item of used) append(item);
  for (const item of declared) {
    if (item.scope === panelScope) {
      append(item);
    }
  }
  return result;
}

function buildMeta() {
  const systemSettings = getSystemSettings();
  return {
    vendorTypes: listAvailableVendorTypes(),
    vendorTypeDocs: systemSettings.vendorTypeDocs,
    vendorDefinitions: listVendorDefinitions().map((d) => ({
      vendorType: d.vendorType,
      displayName: d.displayName,
      envVars: d.envVars,
      endpointTotalMode: d.regionConfig.endpointTotalMode,
      dailyCheckinEnabled: d.regionConfig.dailyCheckinEnabled === true,
      envVarsByScope: {
        vendor: buildEnvVarsForPanel(
          'vendor',
          listUsedEnvVars(d.vendorType, 'vendor'),
          d.envVars,
        ),
        endpoint: buildEnvVarsForPanel(
          'endpoint',
          listUsedEnvVars(d.vendorType, 'endpoint'),
          d.envVars,
        ),
      },
      aggregation: d.regionConfig.aggregation ?? null,
      apiKind: detectVendorApiKind(d.vendorType),
    })),
    endpoints: listVendorOptions(),
  };
}

function normalizeMessage(value: string | null | undefined): string | null {
  const text = (value || '').trim();
  return text || null;
}

function extractDailyCheckinRawResponse(probes: QuotaDebugProbe[] | null | undefined): string | null {
  if (!Array.isArray(probes) || probes.length === 0) {
    return null;
  }

  const candidate = [...probes]
    .reverse()
    .find((probe) => probe.purpose === 'daily_checkin')
    ?? [...probes].reverse().find((probe) => (probe.strategy || '').includes('daily_checkin'))
    ?? null;

  if (!candidate) {
    return null;
  }

  const preview = (candidate.preview || '').trim();
  return preview || null;
}

export async function GET(): Promise<Response> {
  try {
    const records = await listQuotaRecordsFromCache();

    return NextResponse.json({
      ok: true,
      total: records.length,
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
  let action: string | null = null;
  let vendorId: number | null = null;
  try {
    const body = (await request.json().catch(() => ({}))) as { action?: string; vendorId?: unknown };
    action = typeof body.action === 'string' ? body.action : null;
    vendorId = Number.isInteger(Number(body.vendorId)) ? Number(body.vendorId) : null;

    if (body.action === 'refresh-all') {
      const startedAt = Date.now();
      logInfo('refresh.all', {
        event: 'start',
        trigger: 'manual',
      });
      const records = await refreshAllEndpoints();
      let success = 0;
      let failed = 0;
      let withValue = 0;
      for (const record of records) {
        if (record.result.status === 'ok') {
          success += 1;
        } else {
          failed += 1;
        }
        if (
          typeof record.result.totalUsd === 'number'
          || typeof record.result.usedUsd === 'number'
          || typeof record.result.remainingUsd === 'number'
        ) {
          withValue += 1;
        }
      }
      logInfo('refresh.all', {
        event: 'done',
        trigger: 'manual',
        total: records.length,
        success,
        failed,
        withValue,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({
        ok: true,
        total: records.length,
        generatedAt: new Date().toISOString(),
        refreshed: true,
        meta: buildMeta(),
        records,
      });
    }

    if (body.action === 'refresh-by-vendor') {
      const vendorId = Number(body.vendorId);
      if (!Number.isInteger(vendorId) || vendorId <= 0) {
        return NextResponse.json({ ok: false, message: 'vendorId 非法' }, { status: 400 });
      }

      const startedAt = Date.now();
      logInfo('refresh.vendor', {
        event: 'start',
        trigger: 'manual',
        vendorId,
      });
      const records = await refreshEndpointsByVendor(vendorId);
      let success = 0;
      let failed = 0;
      let withValue = 0;
      for (const record of records) {
        if (record.result.status === 'ok') {
          success += 1;
        } else {
          failed += 1;
        }
        if (
          typeof record.result.totalUsd === 'number'
          || typeof record.result.usedUsd === 'number'
          || typeof record.result.remainingUsd === 'number'
        ) {
          withValue += 1;
        }
      }
      logInfo('refresh.vendor', {
        event: 'done',
        trigger: 'manual',
        vendorId,
        vendorName: records[0]?.vendorName ?? null,
        total: records.length,
        success,
        failed,
        withValue,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({
        ok: true,
        vendorId,
        total: records.length,
        generatedAt: new Date().toISOString(),
        refreshed: true,
        meta: buildMeta(),
        records,
      });
    }

    if (body.action === 'vendor-checkin') {
      const vendorId = Number(body.vendorId);
      if (!Number.isInteger(vendorId) || vendorId <= 0) {
        return NextResponse.json({ ok: false, message: 'vendorId 非法' }, { status: 400 });
      }
      const output = await runVendorDailyCheckin(vendorId);
      const endpointRecord = output.records.find((record) => record.endpointId === output.endpointId) ?? null;
      const vendorName =
        (endpointRecord?.vendorName || '').trim()
        || endpointRecord?.endpointName
        || `Vendor-${vendorId}`;
      const vendorType = (endpointRecord?.vendorType || '').trim();
      const message = normalizeMessage(output.result.message);
      recordDailyCheckinAttempt({
        vendorId,
        vendorName,
        vendorType,
        requestSucceeded: output.result.status === 'ok',
        status: output.result.status,
        message,
        endpointId: output.endpointId,
        checkinDate: output.result.checkinDate,
        source: output.result.source,
        rawResponseText: extractDailyCheckinRawResponse(output.result.debugProbes),
        awardedUsd: output.result.quotaAwarded,
      });
      return NextResponse.json({
        ok: true,
        vendorId,
        endpointId: output.endpointId,
        checkin: output.result,
        total: output.records.length,
        generatedAt: new Date().toISOString(),
        meta: buildMeta(),
        records: output.records,
      });
    }

    return NextResponse.json({ ok: false, message: 'Unsupported action' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (action === 'refresh-all') {
      logInfo('refresh.all', {
        event: 'failed',
        trigger: 'manual',
        stage: 'route',
        message,
      });
    } else if (action === 'refresh-by-vendor') {
      logInfo('refresh.vendor', {
        event: 'failed',
        trigger: 'manual',
        vendorId,
        stage: 'route',
        message,
      });
    } else if (action === 'vendor-checkin') {
      logInfo('checkin.vendor', {
        event: 'failed',
        trigger: 'manual',
        vendorId,
        stage: 'route',
        message,
      });
    }
    return NextResponse.json(
      {
        ok: false,
        message,
      },
      { status: 500 },
    );
  }
}
