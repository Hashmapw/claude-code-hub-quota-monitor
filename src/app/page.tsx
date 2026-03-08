export const dynamic = 'force-dynamic';

import { cookies } from 'next/headers';
import { QuotaDashboard, type QuotaApiResponse } from '@/components/quota-dashboard';
import { GROUP_COLLAPSE_COOKIE_KEY, parseCollapsedGroupsCookie } from '@/lib/group-collapse-state';
import { listVendorOptions } from '@/lib/vendor-settings';
import { listAvailableVendorTypes, listUsedEnvVars, listVendorDefinitions } from '@/lib/vendor-definitions';
import { getSystemSettings } from '@/lib/system-settings';
import { listQuotaRecordsFromCache } from '@/lib/quota/service';

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
    })),
    endpoints: listVendorOptions(),
  };
}

async function fetchInitialData(): Promise<QuotaApiResponse> {
  try {
    const records = await listQuotaRecordsFromCache();
    return {
      ok: true,
      total: records.length,
      generatedAt: new Date().toISOString(),
      meta: buildMeta(),
      records,
    };
  } catch {
    return {
      ok: true,
      total: 0,
      generatedAt: new Date().toISOString(),
      meta: buildMeta(),
      records: [],
    };
  }
}

export default async function HomePage() {
  const cookieStore = await cookies();
  const collapseCookie = parseCollapsedGroupsCookie(
    cookieStore.get(GROUP_COLLAPSE_COOKIE_KEY)?.value,
  );
  const data = await fetchInitialData();
  return (
    <QuotaDashboard
      initialData={data}
      initialCollapsedGroups={collapseCookie.groups}
      initialCollapsedGroupsReady={collapseCookie.hasCookieValue}
    />
  );
}
