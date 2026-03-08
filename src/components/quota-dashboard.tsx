'use client';

import {
  Activity,
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleCheckBig,
  CircleX,
  Clock,
  Copy,
  DollarSign,
  ExternalLink,
  EyeOff,
  KeyRound,
  Loader2,
  Pencil,
  PieChart,
  RefreshCw,
  Search,
  Timer,
  X,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AnimatedStatCard } from '@/components/ui/animated-stat-card';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { withBasePath } from '@/lib/client/base-path';
import {
  GROUP_COLLAPSE_COOKIE_KEY,
  GROUP_COLLAPSE_STORAGE_KEY,
  parseCollapsedGroupStateRaw,
  serializeCollapsedGroupsCookieValue,
  type CollapsedGroupMap,
} from '@/lib/group-collapse-state';
import { toast } from '@/lib/toast';
import { cn, formatDateTime, formatUsd, resolveDefaultVendorType } from '@/lib/utils';
import { setCookieAlerts } from '@/lib/client/cookie-alert-store';

type VendorOption = {
  id: number;
  name: string;
  vendorType: VendorType | null;
  envVars: Record<string, string>;
  displayOrder?: number | null;
  updatedAt: string | null;
};

type VendorType = string;
type BillingMode = 'usage' | 'duration';

const CREATE_VENDOR_VALUE = '__create__';
const UNGROUPED_VENDOR_VALUE = '__ungrouped__';
const UNTYPED_VENDOR_VALUE = '__missing_vendor_type__';
const DASHBOARD_AUTO_RELOAD_INTERVAL_MS = 60_000;
const TOAST_BOTTOM_OFFSET_CSS_VAR = '--toast-bottom-offset';

type QuotaRecord = {
  endpointId: number;
  endpointName: string;
  endpointUrl: string;
  endpointConsoleUrl: string | null;
  endpointApiKey: string;
  endpointType: string | null;
  endpointVendorId: number | null;
  isEnabled: boolean;
  vendorId: number | null;
  vendorName: string | null;
  vendorType: VendorType;
  billingMode: BillingMode;
  useVendorGroup: boolean;
  useVendorUsed: boolean;
  useVendorRemaining: boolean;
  useVendorAmount: boolean;
  useVendorBalance: boolean;
  endpointEnvVars?: Record<string, string>;
  isHidden: boolean;
  vendorBalanceUsd: number | null;
  vendorTotalUsd: number | null;
  vendorBalanceCheckedAt: string | null;
  vendorBalanceStrategy: string | null;
  result: {
    status: string;
    strategy: string;
    totalUsd: number | null;
    usedUsd: number | null;
    remainingUsd: number | null;
    staleLock?: {
      reason: 'refresh_error';
      lockedAt: string;
      previousCheckedAt: string | null;
      totalUsd?: number | null;
      usedUsd?: number | null;
      remainingUsd?: number | null;
    } | null;
    regionMetrics?: {
      vendorUsedUsd?: number | null;
      vendorRemainingUsd?: number | null;
      endpointUsedUsd?: number | null;
      endpointRemainingUsd?: number | null;
      endpointTotalUsd?: number | null;
    };
    usedSource?: string | null;
    remainingSource?: string | null;
    checkedAt: string | null;
    latencyMs: number | null;
    message?: string;
    rawSnippet?: string;
    credentialIssue?: 'cookie_expired' | null;
    tokenUsed?: number | null;
    tokenAvailable?: number | null;
    lastCreditReset?: string | null;
  };
};

export type QuotaApiResponse = {
  ok: boolean;
  total: number;
  generatedAt: string;
  meta: {
    vendorTypes: string[];
    vendorTypeDocs?: Record<string, string>;
    vendorDefinitions?: Array<{
      vendorType: string;
      displayName: string;
      endpointTotalMode?: EndpointTotalMode;
      dailyCheckinEnabled?: boolean;
      envVars?: Array<{
        key: string;
        label: string;
        scope: 'vendor' | 'endpoint';
        meaning?: string | null;
        optional?: boolean;
        defaultValue?: string | null;
      }>;
      envVarsByScope?: {
        vendor?: Array<{
          key: string;
          label: string;
          scope: 'vendor' | 'endpoint';
          meaning?: string | null;
          optional?: boolean;
          defaultValue?: string | null;
        }>;
        endpoint?: Array<{
          key: string;
          label: string;
          scope: 'vendor' | 'endpoint';
          meaning?: string | null;
          optional?: boolean;
          defaultValue?: string | null;
        }>;
      };
      aggregation?: {
        vendor_remaining: 'independent_request' | 'endpoint_sum';
        vendor_used: 'independent_request' | 'endpoint_sum';
      } | null;
      apiKind?: EndpointApiKind;
    }>;
    endpoints: VendorOption[];
    strategies?: string[];
  };
  records: QuotaRecord[];
};

type RefreshAllTaskState = {
  id: string;
  total: number;
  completed: number;
  withValue: number;
  failed: number;
  currentEndpointName: string | null;
  status: 'running' | 'completed' | 'failed';
  message: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

type AutoCleanupOnPageLoadResponse = {
  ok: boolean;
  attempted?: boolean;
  message?: string;
  deletedEndpoints?: number;
  deletedVendors?: number;
};

type DebugAttempt = {
  url: string;
  method?: 'GET' | 'POST' | 'PUT';
  status: number;
  latencyMs: number;
  contentType: string | null;
  requestHeaders: Record<string, string>;
  requestBodyPreview?: string;
  bodyPreview?: string;
  error?: string;
};

type DebugProbe = {
  strategy: string;
  path: string;
  status: number;
  latencyMs: number;
  contentType: string | null;
  preview: string;
  attempts: DebugAttempt[];
  purpose?: 'amount' | 'token_usage' | 'reset_date' | 'identity' | 'compat_deprecated' | 'refresh' | 'daily_checkin' | 'other';
  note?: string;
};

type DebugResponse = {
  ok: boolean;
  generatedAt: string;
  endpoint: {
    id: number;
    name: string;
    url: string;
    vendorType: VendorType;
    billingMode: BillingMode;
    vendorId: number | null;
    vendorName: string | null;
    useVendorAmount: boolean;
    vendorTotalUsd: number | null;
    vendorBalanceUsd: number | null;
    vendorBalanceCheckedAt: string | null;
    vendorBalanceStrategy: string | null;
  };
  snapshotGeneratedAt: string | null;
  resultStatus: string | null;
  resultStrategy: string | null;
  resultMessage?: string | null;
  resultTotalUsd?: number | null;
  resultUsedUsd?: number | null;
  resultRemainingUsd?: number | null;
  resultStaleLock?: {
    reason: 'refresh_error';
    lockedAt: string;
    previousCheckedAt: string | null;
    totalUsd?: number | null;
    usedUsd?: number | null;
    remainingUsd?: number | null;
  } | null;
  resultTokenUsed?: number | null;
  resultTokenAvailable?: number | null;
  resultLastCreditReset?: string | null;
  resultTotalSource?: string | null;
  resultUsedSource?: string | null;
  resultRemainingSource?: string | null;
  resultRegionMetrics?: {
    vendorUsedUsd?: number | null;
    vendorRemainingUsd?: number | null;
    endpointUsedUsd?: number | null;
    endpointRemainingUsd?: number | null;
    endpointTotalUsd?: number | null;
  } | null;
  resultRegionSources?: {
    vendorUsed?: string | null;
    vendorRemaining?: string | null;
    endpointUsed?: string | null;
    endpointRemaining?: string | null;
    endpointTotal?: string | null;
    tokenUsed?: string | null;
    tokenAvailable?: string | null;
    lastCreditReset?: string | null;
    dailyCheckinDate?: string | null;
    dailyCheckinAwarded?: string | null;
  } | null;
  resultRegionFieldPaths?: {
    vendorUsed?: string | null;
    vendorRemaining?: string | null;
    endpointUsed?: string | null;
    endpointRemaining?: string | null;
    endpointTotal?: string | null;
    tokenUsed?: string | null;
    tokenAvailable?: string | null;
    lastCreditReset?: string | null;
    dailyCheckinDate?: string | null;
    dailyCheckinAwarded?: string | null;
  } | null;
  resultDailyCheckinDate?: string | null;
  resultDailyCheckinAwarded?: number | null;
  resultDailyCheckinSource?: string | null;
  resultDailyCheckinStatus?: string | null;
  resultDailyCheckinMessage?: string | null;
  probes: DebugProbe[];
  message?: string;
};

type VendorSettingsResponse = {
  ok: boolean;
  message?: string;
  vendor?: {
    id: number;
    name: string;
    vendorType: VendorType;
    envVars: Record<string, string>;
    updatedAt: string | null;
  };
  vendors?: VendorOption[];
};

type DetailViewMode = 'endpoint' | 'vendor';

type VendorDetailContext = {
  vendorName: string;
  usedMode: VendorAggregateMode;
  remainingMode: VendorAggregateMode;
  usedValue: number | null;
  usedStale: boolean;
  remainingValue: number | null;
  remainingStale: boolean;
};

const STATUS_LABELS: Record<string, string> = {
  ok: '正常',
  unauthorized: '鉴权失败',
  unsupported: '暂不支持',
  network_error: '网络错误',
  parse_error: '解析失败',
  not_checked: '未查询',
};

const STATUS_FILTER_OPTIONS = ['all', 'ok', 'error'] as const;
type StatusFilterValue = (typeof STATUS_FILTER_OPTIONS)[number];
const BILLING_FILTER_OPTIONS = ['all', 'usage', 'duration'] as const;
type BillingFilterValue = (typeof BILLING_FILTER_OPTIONS)[number];
const API_KIND_FILTER_OPTIONS = ['all', 'codex', 'claude_code', 'gemini'] as const;
type ApiKindFilterValue = (typeof API_KIND_FILTER_OPTIONS)[number];

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function statusFilterLabel(status: StatusFilterValue): string {
  if (status === 'all') {
    return '全部';
  }
  if (status === 'error') {
    return '异常';
  }
  return statusLabel(status);
}

function billingFilterLabel(mode: BillingFilterValue): string {
  if (mode === 'all') {
    return '全部';
  }
  if (mode === 'duration') {
    return '时长';
  }
  return '按量';
}

function apiKindFilterLabel(kind: ApiKindFilterValue): string {
  if (kind === 'all') {
    return '全部';
  }
  if (kind === 'claude_code') {
    return 'ClaudeCode';
  }
  if (kind === 'gemini') {
    return 'Gemini';
  }
  if (kind === 'codex') {
    return 'Codex';
  }
  return kind;
}

function normalizeBillingModeValue(mode: string | null | undefined): BillingMode {
  const normalized = (mode || '').trim().toLowerCase();
  if (normalized === 'duration' || normalized === 'monthly') {
    return 'duration';
  }
  return 'usage';
}

function buildVendorDefinitionLabelMap(
  defs: Array<{ vendorType: string; displayName: string }> | undefined,
): Record<string, string> {
  if (!defs) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const definition of defs) {
    const key = (definition.vendorType || '').trim().toLowerCase();
    if (!key) {
      continue;
    }
    const name = (definition.displayName || '').trim();
    if (name) {
      result[key] = name;
    }
  }
  return result;
}


type EnvVarScope = 'vendor' | 'endpoint';
type EndpointTotalMode = 'independent_request' | 'sum_from_parts' | 'manual_total';
type EnvVarDef = {
  key: string;
  label: string;
  scope: EnvVarScope;
  meaning?: string | null;
  optional?: boolean;
  defaultValue?: string | null;
};
type VendorAggregateMode = 'independent_request' | 'endpoint_sum';
type VendorAggregation = {
  vendor_remaining: VendorAggregateMode;
  vendor_used: VendorAggregateMode;
};

function buildVendorEnvVarMap(
  defs:
    | Array<{
        vendorType: string;
        envVars?: EnvVarDef[];
        envVarsByScope?: {
          vendor?: EnvVarDef[];
          endpoint?: EnvVarDef[];
        };
      }>
    | undefined,
): Record<string, EnvVarDef[]> {
  if (!defs) return {};
  const result: Record<string, EnvVarDef[]> = {};
  for (const item of defs) {
    const vendorType = (item.vendorType || '').trim().toLowerCase();
    if (!vendorType) continue;
    const scopedVars = item.envVarsByScope;
    const vars = scopedVars
      ? [
        ...(Array.isArray(scopedVars.vendor) ? scopedVars.vendor.map((v) => ({ ...v, scope: 'vendor' as const })) : []),
        ...(Array.isArray(scopedVars.endpoint) ? scopedVars.endpoint.map((v) => ({ ...v, scope: 'endpoint' as const })) : []),
      ]
      : (Array.isArray(item.envVars) ? item.envVars : []);
    result[vendorType] = vars
      .filter((v) => v && typeof v.key === 'string' && typeof v.label === 'string')
      .map((v) => ({
        key: v.key,
        label: v.label,
        scope: v.scope === 'vendor' ? 'vendor' : 'endpoint',
        meaning: typeof v.meaning === 'string' ? v.meaning : null,
        optional: v.optional === true,
        defaultValue: typeof v.defaultValue === 'string' ? v.defaultValue : null,
      }));
  }
  return result;
}

function buildVendorAggregationMap(
  defs:
    | Array<{
        vendorType: string;
        aggregation?: {
          vendor_remaining: VendorAggregateMode;
          vendor_used: VendorAggregateMode;
        } | null;
      }>
    | undefined,
): Record<string, VendorAggregation> {
  if (!defs) return {};
  const result: Record<string, VendorAggregation> = {};
  for (const item of defs) {
    const vendorType = (item.vendorType || '').trim().toLowerCase();
    if (!vendorType) continue;
    const source = item.aggregation;
    const defaultRemainingMode: VendorAggregateMode = 'independent_request';
    result[vendorType] = {
      vendor_remaining:
        source?.vendor_remaining === 'endpoint_sum' ? 'endpoint_sum' : defaultRemainingMode,
      vendor_used: source?.vendor_used === 'independent_request' ? 'independent_request' : 'endpoint_sum',
    };
  }
  return result;
}

function buildVendorEndpointTotalModeMap(
  defs:
    | Array<{
        vendorType: string;
        endpointTotalMode?: EndpointTotalMode;
      }>
    | undefined,
): Record<string, EndpointTotalMode> {
  if (!defs) return {};
  const result: Record<string, EndpointTotalMode> = {};
  for (const item of defs) {
    const vendorType = (item.vendorType || '').trim().toLowerCase();
    if (!vendorType) continue;
    const raw = (item.endpointTotalMode || '').trim().toLowerCase();
    result[vendorType] =
      raw === 'manual_total' || raw === 'sum_from_parts' || raw === 'independent_request'
        ? (raw as EndpointTotalMode)
        : 'independent_request';
  }
  return result;
}

function buildVendorDailyCheckinEnabledMap(
  defs:
    | Array<{
        vendorType: string;
        dailyCheckinEnabled?: boolean;
      }>
    | undefined,
): Record<string, boolean> {
  if (!defs) return {};
  const result: Record<string, boolean> = {};
  for (const item of defs) {
    const vendorType = (item.vendorType || '').trim().toLowerCase();
    if (!vendorType) continue;
    result[vendorType] = item.dailyCheckinEnabled === true;
  }
  return result;
}

function buildVendorApiKindMap(
  defs:
    | Array<{
        vendorType: string;
        apiKind?: EndpointApiKind;
      }>
    | undefined,
): Record<string, VendorApiKindInfo> {
  if (!defs) {
    return {};
  }
  const result: Record<string, VendorApiKindInfo> = {};
  for (const item of defs) {
    const vendorType = (item.vendorType || '').trim().toLowerCase();
    if (!vendorType) {
      continue;
    }
    const kind = item.apiKind === 'claude_code' || item.apiKind === 'gemini' || item.apiKind === 'codex'
      ? item.apiKind
      : 'unknown';
    result[vendorType] = {
      kind,
      hasFallbackSignal: item.apiKind === undefined,
    };
  }
  return result;
}

function listRequiredEnvVars(
  envVarMap: Record<string, EnvVarDef[]>,
  vendorType: string,
  scope: EnvVarScope,
  endpointTotalMode?: EndpointTotalMode,
): EnvVarDef[] {
  const defs = envVarMap[(vendorType || '').toLowerCase()] ?? [];
  const scoped = defs.filter((item) => item.scope === scope);
  if (scope !== 'endpoint') {
    return scoped;
  }
  if (endpointTotalMode === 'manual_total') {
    return scoped;
  }
  return scoped.filter((item) => item.key.trim().toLowerCase() !== 'totalamount');
}

function findMissingRequiredEnvVars(
  requiredEnvVars: EnvVarDef[],
  envVars: Record<string, string>,
): EnvVarDef[] {
  return requiredEnvVars.filter((item) => !item.optional && !(envVars[item.key] || '').trim());
}

function formatMissingEnvVarLabels(items: Array<Pick<EnvVarDef, 'key' | 'label'>>): string[] {
  return items.map((item) => `${item.label}($${item.key})`);
}

function isTotalAmountEnvVar(item: Pick<EnvVarDef, 'key'>): boolean {
  return item.key.trim().toLowerCase() === 'totalamount';
}

function normalizeEnvVarValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

type SharedEnvVarEntry = {
  value: string;
  source: 'vendor' | 'endpoint';
};

function autoResizeTextarea(element: HTMLTextAreaElement | null): void {
  if (!element) {
    return;
  }
  element.style.height = 'auto';
  element.style.height = `${Math.max(element.scrollHeight, 36)}px`;
}

function vendorTypeLabel(value: string, labelMap?: Record<string, string>): string {
  if (value === UNTYPED_VENDOR_VALUE) {
    return '未配置类型';
  }
  const normalized = (value || '').trim().toLowerCase();
  if (!normalized) {
    return '未配置类型';
  }
  if (labelMap?.[normalized]) {
    return labelMap[normalized];
  }
  return value;
}

function strategyDisplayName(strategy: string): string {
  const normalized = (strategy || '').trim().toLowerCase();
  if (!normalized) {
    return '-';
  }
  return strategy;
}

function strategyChannelLabel(strategy: string): 'APIKey' | 'Cookie' | '鉴权凭据' {
  const normalized = strategyDisplayName(strategy).trim().toLowerCase().replace(/\s+/g, '');
  if (normalized.includes('accesstoken')) {
    return '鉴权凭据';
  }
  if (normalized.includes('cookie')) {
    return 'Cookie';
  }
  return 'APIKey';
}

function strategyChannelTone(strategy: string): string {
  const channel = strategyChannelLabel(strategy);
  if (channel === 'Cookie') {
    return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300';
  }
  if (channel === '鉴权凭据') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300';
  }
  return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300';
}

type EndpointApiKind = 'codex' | 'claude_code' | 'gemini' | 'unknown';

type VendorApiKindInfo = {
  kind: EndpointApiKind;
  hasFallbackSignal: boolean;
};

function detectEndpointApiKind(
  record: Pick<QuotaRecord, 'endpointName' | 'endpointUrl' | 'endpointType' | 'vendorType'>,
  vendorApiKindMap?: Record<string, VendorApiKindInfo>,
): { kind: EndpointApiKind; fromFallback: boolean } {
  const vendorKey = (record.vendorType || '').trim().toLowerCase();
  const fromDefinition = vendorKey ? vendorApiKindMap?.[vendorKey] : undefined;
  if (fromDefinition && fromDefinition.kind !== 'unknown') {
    return { kind: fromDefinition.kind, fromFallback: false };
  }

  const endpointType = (record.endpointType || '').trim().toLowerCase();

  if (endpointType) {
    if (endpointType.includes('claude') || endpointType.includes('anthropic')) {
      return { kind: 'claude_code', fromFallback: true };
    }
    if (endpointType.includes('gemini') || endpointType.includes('google')) {
      return { kind: 'gemini', fromFallback: true };
    }
    if (
      endpointType.includes('codex') ||
      endpointType.includes('openai') ||
      endpointType.includes('gpt') ||
      endpointType.includes('oneapi') ||
      endpointType.includes('openrouter')
    ) {
      return { kind: 'codex', fromFallback: true };
    }
  }

  const haystack = `${record.endpointName || ''} ${record.endpointUrl || ''}`.toLowerCase();

  if (haystack.includes('claude') || haystack.includes('anthropic')) {
    return { kind: 'claude_code', fromFallback: true };
  }

  if (haystack.includes('gemini') || haystack.includes('google')) {
    return { kind: 'gemini', fromFallback: true };
  }

  const codexKeywords = [
    'codex',
    'openai',
    'chatgpt',
    'gpt',
    'oai',
    'anyrouter',
    'openrouter',
    'oneapi',
  ];

  if (codexKeywords.some((keyword) => haystack.includes(keyword))) {
    return { kind: 'codex', fromFallback: true };
  }

  return { kind: 'unknown', fromFallback: true };
}

function endpointApiKindLabel(kind: EndpointApiKind): string {
  if (kind === 'claude_code') {
    return 'Claude Code';
  }
  if (kind === 'gemini') {
    return 'Gemini';
  }
  if (kind === 'codex') {
    return 'Codex';
  }
  return '未知类型';
}

function endpointApiKindTone(kind: EndpointApiKind): {
  iconWrap: string;
  textTag: string;
} {
  if (kind === 'claude_code') {
    return {
      iconWrap: 'bg-orange-500/15',
      textTag: 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300',
    };
  }

  if (kind === 'gemini') {
    return {
      iconWrap: 'bg-emerald-500/15',
      textTag: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
    };
  }

  if (kind === 'codex') {
    return {
      iconWrap: 'bg-blue-500/15',
      textTag: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300',
    };
  }

  return {
    iconWrap: 'bg-muted',
    textTag: 'border-border bg-muted/40 text-muted-foreground',
  };
}

function ClaudeGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
      <path
        d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"
        fill="#D97757"
        fillRule="nonzero"
      />
    </svg>
  );
}


function CodexGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true" fill="currentColor" fillRule="evenodd">
      <path d="M21.55 10.004a5.416 5.416 0 00-.478-4.501c-1.217-2.09-3.662-3.166-6.05-2.66A5.59 5.59 0 0010.831 1C8.39.995 6.224 2.546 5.473 4.838A5.553 5.553 0 001.76 7.496a5.487 5.487 0 00.691 6.5 5.416 5.416 0 00.477 4.502c1.217 2.09 3.662 3.165 6.05 2.66A5.586 5.586 0 0013.168 23c2.443.006 4.61-1.546 5.361-3.84a5.553 5.553 0 003.715-2.66 5.488 5.488 0 00-.693-6.497v.001zm-8.381 11.558a4.199 4.199 0 01-2.675-.954c.034-.018.093-.05.132-.074l4.44-2.53a.71.71 0 00.364-.623v-6.176l1.877 1.069c.02.01.033.029.036.05v5.115c-.003 2.274-1.87 4.118-4.174 4.123zM4.192 17.78a4.059 4.059 0 01-.498-2.763c.032.02.09.055.131.078l4.44 2.53c.225.13.504.13.73 0l5.42-3.088v2.138a.068.068 0 01-.027.057L9.9 19.288c-1.999 1.136-4.552.46-5.707-1.51h-.001zM3.023 8.216A4.15 4.15 0 015.198 6.41l-.002.151v5.06a.711.711 0 00.364.624l5.42 3.087-1.876 1.07a.067.067 0 01-.063.005l-4.489-2.559c-1.995-1.14-2.679-3.658-1.53-5.63h.001zm15.417 3.54l-5.42-3.088L14.896 7.6a.067.067 0 01.063-.006l4.489 2.557c1.998 1.14 2.683 3.662 1.529 5.633a4.163 4.163 0 01-2.174 1.807V12.38a.71.71 0 00-.363-.623zm1.867-2.773a6.04 6.04 0 00-.132-.078l-4.44-2.53a.731.731 0 00-.729 0l-5.42 3.088V7.325a.068.068 0 01.027-.057L14.1 4.713c2-1.137 4.555-.46 5.707 1.513.487.833.664 1.809.499 2.757h.001zm-11.741 3.81l-1.877-1.068a.065.065 0 01-.036-.051V6.559c.001-2.277 1.873-4.122 4.181-4.12.976 0 1.92.338 2.671.954-.034.018-.092.05-.131.073l-4.44 2.53a.71.71 0 00-.365.623l-.003 6.173v.002zm1.02-2.168L12 9.25l2.414 1.375v2.75L12 14.75l-2.415-1.375v-2.75z" />
    </svg>
  );
}

function GeminiGlyph() {
  const gradientPrefix = useId().replace(/:/g, '_');
  const fill0 = `${gradientPrefix}-gemini-fill-0`;
  const fill1 = `${gradientPrefix}-gemini-fill-1`;
  const fill2 = `${gradientPrefix}-gemini-fill-2`;

  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
      <path
        d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z"
        fill="#3186FF"
      />
      <path
        d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z"
        fill={`url(#${fill0})`}
      />
      <path
        d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z"
        fill={`url(#${fill1})`}
      />
      <path
        d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z"
        fill={`url(#${fill2})`}
      />
      <defs>
        <linearGradient id={fill0} x1="7" y1="15.5" x2="11" y2="12" gradientUnits="userSpaceOnUse">
          <stop stopColor="#08B962" />
          <stop offset="1" stopColor="#08B962" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={fill1} x1="8" y1="5.5" x2="11.5" y2="11" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F94543" />
          <stop offset="1" stopColor="#F94543" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={fill2} x1="3.5" y1="13.5" x2="17.5" y2="12" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FABC12" />
          <stop offset="0.46" stopColor="#FABC12" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function EndpointApiKindBadge({ record, vendorApiKindMap }: { record: QuotaRecord; vendorApiKindMap: Record<string, VendorApiKindInfo> }) {
  const { kind, fromFallback } = detectEndpointApiKind(record, vendorApiKindMap);
  const label = endpointApiKindLabel(kind);
  const tone = endpointApiKindTone(kind);

  const title =
    kind === 'claude_code'
      ? 'Claude · Anthropic 官方 API'
      : kind === 'gemini'
        ? 'Gemini · Google Gemini API'
        : kind === 'codex'
          ? 'Codex · Codex CLI API'
          : '未知类型';

  const ariaLabel = kind === 'claude_code' ? 'Claude' : kind === 'gemini' ? 'Gemini' : kind === 'codex' ? 'Codex' : '未知';

  return (
    <div className="inline-flex items-center gap-1.5">
      {kind === 'unknown' ? <CircleX className="h-4 w-4 flex-shrink-0 text-gray-400" /> : null}
      <div
        className={cn('flex h-6 w-6 flex-shrink-0 items-center justify-center rounded', tone.iconWrap)}
        title={title}
        aria-label={ariaLabel}
      >
        {kind === 'claude_code' ? <ClaudeGlyph /> : null}
        {kind === 'codex' ? <CodexGlyph /> : null}
        {kind === 'gemini' ? <GeminiGlyph /> : null}
        {kind === 'unknown' ? <CircleX className="h-3.5 w-3.5 text-gray-500" /> : null}
      </div>
      <span className={cn('inline-flex items-center rounded-sm border px-1.5 py-0.5 text-xs font-medium leading-none', tone.textTag)}>{label}</span>
    </div>
  );
}

function latencyToneClass(latencyMs: number | null): string {
  if (latencyMs === null || !Number.isFinite(latencyMs)) {
    return 'text-muted-foreground';
  }
  if (latencyMs < 500) {
    return 'text-emerald-600 dark:text-emerald-400';
  }
  if (latencyMs < 1500) {
    return 'text-amber-600 dark:text-amber-400';
  }
  return 'text-red-600 dark:text-red-400';
}

function maskApiKey(value: string | null | undefined): string {
  const normalized = (value || '').trim();
  if (!normalized) {
    return '-';
  }

  if (normalized.startsWith('sk-')) {
    const prefix = 'sk-';
    const rest = normalized.slice(3);
    if (rest.length <= 8) {
      return normalized;
    }
    return `${prefix}${rest.slice(0, 4)}****${rest.slice(-4)}`;
  }

  if (normalized.length <= 8) {
    return `${normalized.slice(0, 2)}****`;
  }

  return `${normalized.slice(0, 4)}****${normalized.slice(-4)}`;
}

function debugStatusTone(status: number): string {
  if (status >= 200 && status < 300) {
    return 'text-emerald-600 dark:text-emerald-400';
  }
  if (status === 401 || status === 403) {
    return 'text-red-600 dark:text-red-400';
  }
  if (status === 598 || status === 599) {
    return 'text-orange-600 dark:text-orange-400';
  }
  if (status >= 500) {
    return 'text-orange-600 dark:text-orange-400';
  }
  return 'text-muted-foreground';
}

function debugStatusText(status: number): string {
  if (status === 598 || status === 599) {
    return `HTTP ${status}（网络失败/超时）`;
  }
  return `HTTP ${status}`;
}

type ExtractionState = 'success' | 'failed' | 'not_run';

function extractionStateLabel(state: ExtractionState): string {
  if (state === 'success') return '已命中';
  if (state === 'failed') return '请求失败/未命中';
  return '未配置/未执行';
}

function extractionStateTone(state: ExtractionState): string {
  if (state === 'success') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300';
  }
  if (state === 'failed') {
    return 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300';
  }
  return 'border-border bg-muted/40 text-muted-foreground';
}

function probePurposeLabel(purpose: DebugProbe['purpose']): string {
  if (purpose === 'amount') return '金额/额度';
  if (purpose === 'token_usage') return 'Token 使用量';
  if (purpose === 'reset_date') return '重置日期';
  if (purpose === 'identity') return '身份识别';
  if (purpose === 'compat_deprecated') return '兼容接口(废弃)';
  if (purpose === 'refresh') return '刷新令牌';
  if (purpose === 'daily_checkin') return '每日签到';
  if (purpose === 'other') return '辅助探测';
  return '未标注';
}

function probePurposeTone(purpose: DebugProbe['purpose']): string {
  if (purpose === 'amount') return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300';
  if (purpose === 'token_usage') return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300';
  if (purpose === 'reset_date') return 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300';
  if (purpose === 'identity') return 'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-300';
  if (purpose === 'compat_deprecated') return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300';
  if (purpose === 'refresh') return 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 dark:border-fuchsia-500/30 dark:bg-fuchsia-500/10 dark:text-fuchsia-300';
  if (purpose === 'daily_checkin') return 'border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-500/30 dark:bg-teal-500/10 dark:text-teal-300';
  return 'border-border bg-muted text-muted-foreground';
}

function formatResponsePreview(text: string): string {
  const trimmed = (text || '').trim();
  if (!trimmed) {
    return '-';
  }

  const parseCandidates = [trimmed, trimmed.endsWith('...') ? trimmed.slice(0, -3).trim() : ''].filter(Boolean);

  for (const candidate of parseCandidates) {
    try {
      const parsed = JSON.parse(candidate);
      return JSON.stringify(parsed, null, 2);
    } catch {
      // Keep trying fallback candidates.
    }
  }

  return trimmed;
}

function pickPrimaryAttempt(probe: DebugProbe): DebugAttempt | null {
  if (!Array.isArray(probe.attempts) || probe.attempts.length === 0) {
    return null;
  }

  // Prioritize the final successful/selected attempt that matches probe status.
  for (let index = probe.attempts.length - 1; index >= 0; index -= 1) {
    const attempt = probe.attempts[index];
    if (attempt.status === probe.status) {
      return attempt;
    }
  }

  return probe.attempts[probe.attempts.length - 1];
}

function attemptOutcomeText(probe: DebugProbe): string {
  const attemptCount = Array.isArray(probe.attempts) && probe.attempts.length > 0 ? probe.attempts.length : 1;
  const success = probe.status >= 200 && probe.status < 300;
  return success ? `尝试${attemptCount}次成功` : `尝试${attemptCount}次失败`;
}

function isUnauthorizedStatus(status: number): boolean {
  return status === 401 || status === 403;
}

function isNoisyAutoMessagePart(part: string): boolean {
  const text = part.trim();
  if (!text) {
    return true;
  }

  // Drop noisy "path + status" summaries for network failures (details are shown in attempts anyway).
  // Examples:
  // - /api/usage/token/ 返回 598
  // - /v1/dashboard/billing/usage?... 返回 598
  // - 调试：/api/usage/token/: HTTP 598 ...
  if (
    (text.includes('/api/usage/token/') || text.includes('/v1/dashboard/billing/usage')) &&
    (text.includes('返回 598') || text.includes('返回 599') || text.includes('HTTP 598') || text.includes('HTTP 599'))
  ) {
    return true;
  }

  if (
    text.startsWith('调试：') &&
    (text.includes('HTTP 598') || text.includes('HTTP 599') || text.includes('返回 598') || text.includes('返回 599'))
  ) {
    return true;
  }

  return (
    text.includes('已自动识别 New-Api-User=') ||
    text.includes('余额来自 /api/user/self') ||
    text.includes('余额已切换为服务商级 /api/user/self 缓存结果') ||
    text.includes('已用额度仍来自 usage 接口')
  );
}

function sanitizeDetailMessage(message: string | null | undefined): string | null {
  const text = (message || '').trim();
  if (!text) {
    return null;
  }

  const parts = text
    .split('；')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !isNoisyAutoMessagePart(part));

  if (parts.length === 0) {
    return null;
  }

  return parts.join('；');
}

function resolveHost(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

function resolveApexDomain(host: string | null): string | null {
  if (!host) {
    return null;
  }

  const parts = host.split('.').filter(Boolean);
  if (parts.length < 2) {
    return host;
  }

  return `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
}

function isAttemptFromEndpointHost(attemptUrl: string, endpointHost: string | null): boolean {
  if (!endpointHost) {
    return true;
  }

  const attemptHost = resolveHost(attemptUrl);
  if (!attemptHost) {
    return true;
  }

  if (attemptHost === endpointHost) {
    return true;
  }

  // Allow subdomain/parent-domain match so endpoint url like api.example.com
  // can still show attempts from example.com (or vice versa) after URL normalization.
  if (attemptHost.endsWith(`.${endpointHost}`) || endpointHost.endsWith(`.${attemptHost}`)) {
    return true;
  }

  // Allow sibling subdomains under the same apex domain (api.example.com vs www.example.com).
  const attemptApex = resolveApexDomain(attemptHost);
  const endpointApex = resolveApexDomain(endpointHost);
  return Boolean(attemptApex && endpointApex && attemptApex === endpointApex);
}

function filterProbeByEndpointHost(probe: DebugProbe, endpointHost: string | null): DebugProbe | null {
  if (!endpointHost) {
    return probe;
  }

  if (probe.purpose === 'refresh') {
    return probe;
  }

  // AICodeMirror actively probes multiple hosts (api/root/www); keep all probes visible.
  if (probe.strategy === 'AICodeMirror') {
    return probe;
  }

  const filteredAttempts = Array.isArray(probe.attempts)
    ? probe.attempts.filter((attempt) => isAttemptFromEndpointHost(attempt.url, endpointHost))
    : [];

  const pathHost = resolveHost(probe.path);
  if (pathHost && pathHost !== endpointHost && filteredAttempts.length === 0) {
    return null;
  }

  return {
    ...probe,
    attempts: filteredAttempts,
  };
}

function statusToneClass(status: string): string {
  const styles: Record<string, string> = {
    ok: 'border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300',
    unauthorized: 'border-red-200 bg-red-100 text-red-700 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300',
    unsupported: 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-500/30 dark:bg-slate-500/15 dark:text-slate-300',
    network_error: 'border-orange-200 bg-orange-100 text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/15 dark:text-orange-300',
    parse_error: 'border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300',
    not_checked: 'border-blue-200 bg-blue-100 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-300',
  };

  return styles[status] ?? 'border-border/50 bg-muted text-muted-foreground';
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn('inline-flex h-5 w-fit items-center rounded-md border px-2 text-xs font-medium leading-none', statusToneClass(status))}>
      {status === 'ok' ? <CheckCircle2 className="mr-1 h-3 w-3" /> : null}
      {status === 'unauthorized' ? <XCircle className="mr-1 h-3 w-3" /> : null}
      {(status === 'unsupported' || status === 'parse_error' || status === 'network_error') ? (
        <AlertCircle className="mr-1 h-3 w-3" />
      ) : null}
      {status === 'not_checked' ? <Clock className="mr-1 h-3 w-3" /> : null}
      {statusLabel(status)}
    </span>
  );
}

function BillingModeBadge({ mode }: { mode: BillingMode | null | undefined }) {
  const isDuration = normalizeBillingModeValue(mode) === 'duration';
  return (
    <span
      className={cn(
        'inline-flex h-5 w-fit items-center rounded-md border px-2 text-xs font-medium leading-none',
        isDuration
          ? 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300'
          : 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300',
      )}
    >
      {isDuration ? '时长' : '按量'}
    </span>
  );
}

function EndpointEnabledBadge({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <CircleCheckBig className="h-4 w-4 text-green-500 flex-shrink-0" aria-label="渠道已启用" />
  ) : (
    <CircleX className="h-4 w-4 text-gray-400 flex-shrink-0" aria-label="渠道已禁用" />
  );
}

function hasFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function resolveUsdMetricDisplay(
  result: QuotaRecord['result'],
  field: 'totalUsd' | 'usedUsd' | 'remainingUsd',
): { value: number | null; stale: boolean } {
  const current = result[field];
  if (hasFiniteNumber(current)) {
    return { value: current, stale: false };
  }

  const stale = result.staleLock?.[field];
  if (hasFiniteNumber(stale)) {
    return { value: stale, stale: true };
  }

  return { value: null, stale: false };
}

function MetricItem({
  value,
  tone,
  stale = false,
  icon: Icon,
}: {
  value: string;
  tone?: string;
  stale?: boolean;
  icon?: typeof DollarSign;
}) {
  return (
    <span className={cn('inline-flex items-center gap-1 font-mono text-xs', tone || 'text-muted-foreground')}>
      {Icon ? <Icon className="h-3 w-3" /> : null}
      <span className={stale ? 'line-through decoration-2 opacity-80' : ''}>{value}</span>
    </span>
  );
}

function TokenProgressBar({ tokenUsed, tokenAvailable }: { tokenUsed?: number | null; tokenAvailable?: number | null }) {
  if (tokenUsed == null && tokenAvailable == null) return null;
  const used = Math.abs(tokenUsed ?? 0);
  const available = Math.max(0, tokenAvailable ?? 0);
  const total = used + available;
  
  // 0/0 -> 黄色
  if (total === 0) {
    return (
      <div className="flex h-8 min-w-[220px] items-center justify-center gap-1.5 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
        <PieChart className="h-3.5 w-3.5" />
        <span>无限额度</span>
      </div>
    );
  }

  const usedPct = (used / total) * 100;
  const isExhausted = available <= 0;

  return (
    <div className={cn(
      "flex h-8 min-w-[220px] items-center justify-center gap-2 rounded-xl border px-3 text-[10px] font-bold uppercase tracking-wider",
      isExhausted 
        ? "border-red-500/20 bg-red-500/10 text-red-500" 
        : "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
    )}>
      <PieChart className="h-3.5 w-3.5" />
      <div className="flex items-center gap-1.5">
        <span className="opacity-70">Token</span>
        <span className="font-mono">{used.toLocaleString()}</span>
        <div className="h-1 w-10 overflow-hidden rounded-full bg-muted/40 shadow-inner">
          <div 
            className={cn("h-full transition-all duration-500", isExhausted ? "bg-red-500" : "bg-emerald-500")} 
            style={{ width: `${Math.max(2, usedPct)}%` }} 
          />
        </div>
        <span className="font-mono">{available > 0 ? available.toLocaleString() : 'MAX'}</span>
      </div>
    </div>
  );
}

function UsageProgressBar({ used, total }: { used: number; total: number }) {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) {
    return <div className="h-1 w-full rounded-full bg-muted" />;
  }

  const safeUsed = Math.max(0, used);
  const usedPercentage = Math.min(100, (safeUsed / total) * 100);

  return (
    <div className="relative h-1 w-full overflow-hidden rounded-full bg-emerald-500/80">
      <div className="absolute left-0 top-0 h-full bg-red-500/80 transition-all" style={{ width: `${usedPercentage}%` }} />
    </div>
  );
}

function summarizeGroupName(vendorName: string): string {
  const name = vendorName.trim();
  return name || '未分组';
}

function parseFieldPathKeys(path: string | null | undefined): string[] {
  const normalized = (path || '').trim();
  if (!normalized) return [];
  const result: string[] = [];
  for (const rawPart of normalized.split('.')) {
    const part = rawPart.trim();
    if (!part) continue;
    const base = part.replace(/\[\d+\]/g, '');
    if (!base) continue;
    result.push(base);
  }
  return result;
}

function extractApiPathFromSourceText(source: string | null | undefined): string | null {
  const text = (source || '').trim();
  if (!text) return null;
  const match = text.match(/(\/[A-Za-z0-9._~\-/%]+(?:\?[^\s]+)?)/);
  return match ? match[1] : null;
}

function CodeViewer({
  label,
  data,
  maxHeight = '320px',
  highlightJsonPath,
}: {
  label: string;
  data: string | object | null | undefined;
  maxHeight?: string;
  highlightJsonPath?: string | null;
}) {
  const [copied, setCopied] = useState(false);

  if (data === null || data === undefined || data === '') return null;

  let content = '';
  let type: 'json' | 'html' | 'text' = 'text';
  let isEmptyObj = false;

  if (typeof data === 'object') {
    if (Object.keys(data).length === 0) {
      isEmptyObj = true;
      content = '{}';
    } else {
      try {
        content = JSON.stringify(data, null, 2);
        type = 'json';
      } catch {
        content = String(data);
      }
    }
  } else {
    const text = String(data).trim();
    if (!text) return null;

    if ((text.startsWith('{') || text.startsWith('[')) && (text.endsWith('}') || text.endsWith(']'))) {
      try {
        const parsed = JSON.parse(text);
        content = JSON.stringify(parsed, null, 2);
        type = 'json';
      } catch {
        content = text;
      }
    } else if ((text.startsWith('<') && text.endsWith('>')) || text.toLowerCase().startsWith('<!doctype html')) {
      content = text;
      type = 'html';
    } else {
      content = text;
    }
  }

  if (isEmptyObj) return null;

  const highlightKeys = new Set(parseFieldPathKeys(highlightJsonPath).map((item) => item.toLowerCase()));

  const renderContent = (): React.ReactNode => {
    if (type !== 'json' || highlightKeys.size === 0) {
      return content;
    }

    const lines = content.split('\n');
    return lines.map((line, index) => {
      const suffix = index < lines.length - 1 ? '\n' : '';
      const matched = line.match(/^(\s*)"([^"]+)"(\s*:.*)$/);
      if (!matched) {
        return <span key={`line-${index}`}>{line}{suffix}</span>;
      }
      const [, leading, key, tail] = matched;
      const hit = highlightKeys.has(key.toLowerCase());
      return (
        <span key={`line-${index}`}>
          {leading}
          <span className={hit ? 'text-red-500 font-bold bg-red-500/10 px-0.5 rounded' : ''}>{`"${key}"`}</span>
          {tail}
          {suffix}
        </span>
      );
    });
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-border/40 bg-card/40 shadow-sm transition-all hover:shadow-md dark:bg-white/[0.01]">
      <div className="flex items-center justify-between border-b border-border/40 bg-muted/30 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">{label}</span>
          {type === 'json' && (
            <span className="rounded-md bg-blue-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 border border-blue-500/20">
              JSON
            </span>
          )}
          {type === 'html' && (
            <span className="rounded-md bg-orange-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-orange-600 dark:text-orange-400 border border-orange-500/20">
              HTML
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] font-medium text-muted-foreground/60">
            {content.length > 1024 ? `${(content.length / 1024).toFixed(1)} KB` : `${content.length} B`}
          </span>
          <div className="h-3 w-px bg-border/40" />
          <button
            onClick={handleCopy}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-background/50 hover:bg-background transition-all border border-border/40 hover:border-border/80 shadow-sm"
            title="复制内容"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <Copy className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </button>
        </div>
      </div>
      <div className="relative group flex">
        <div className={cn(
          "w-1 shrink-0 transition-opacity group-hover:opacity-100",
          type === 'json' ? "bg-blue-500/40" : type === 'html' ? "bg-orange-500/40" : "bg-border/60"
        )} />
        <div
          className="flex-1 overflow-auto bg-transparent p-4 scrollbar-hide"
          style={{ maxHeight }}
        >
          <pre className="font-mono text-[11px] leading-relaxed text-foreground/90 whitespace-pre-wrap break-all selection:bg-primary/20">
            {renderContent()}
          </pre>
        </div>
      </div>
    </div>
  );
}

function InlineCopyButton({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={cn("inline-flex items-center justify-center rounded p-1 transition-colors hover:bg-muted/80", className)}
      title="复制"
    >
      {copied ? (
        <Check className="h-3 w-3 text-emerald-500" />
      ) : (
        <Copy className="h-3 w-3 text-muted-foreground hover:text-foreground" />
      )}
    </button>
  );
}

function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-state={checked ? 'checked' : 'unchecked'}
      disabled={disabled}
      id={id}
      onClick={() => !disabled && onCheckedChange(!checked)}
      className={cn(
        "peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-input focus-visible:border-ring focus-visible:ring-ring/50 dark:data-[state=unchecked]:bg-input/80 inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:ring-[3px] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
      )}
    >
      <span
        data-state={checked ? 'checked' : 'unchecked'}
        data-slot="switch-thumb"
        className={cn(
          "bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0"
        )}
      />
    </button>
  );
}

export function QuotaDashboard({
  initialData,
  initialCollapsedGroups = {},
  initialCollapsedGroupsReady = false,
}: {
  initialData: QuotaApiResponse;
  initialCollapsedGroups?: CollapsedGroupMap;
  initialCollapsedGroupsReady?: boolean;
}) {
  const [data, setData] = useState(initialData);
  const vendorDefinitionLabelMap = useMemo(
    () => buildVendorDefinitionLabelMap(data.meta.vendorDefinitions),
    [data.meta.vendorDefinitions],
  );
  const vendorEnvVarMap = useMemo(
    () => buildVendorEnvVarMap(data.meta.vendorDefinitions),
    [data.meta.vendorDefinitions],
  );
  const vendorAggregationMap = useMemo(
    () => buildVendorAggregationMap(data.meta.vendorDefinitions),
    [data.meta.vendorDefinitions],
  );
  const vendorEndpointTotalModeMap = useMemo(
    () => buildVendorEndpointTotalModeMap(data.meta.vendorDefinitions),
    [data.meta.vendorDefinitions],
  );
  const vendorDailyCheckinEnabledMap = useMemo(
    () => buildVendorDailyCheckinEnabledMap(data.meta.vendorDefinitions),
    [data.meta.vendorDefinitions],
  );
  const vendorApiKindMap = useMemo(
    () => buildVendorApiKindMap(data.meta.vendorDefinitions),
    [data.meta.vendorDefinitions],
  );
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [refreshAllTask, setRefreshAllTask] = useState<RefreshAllTaskState | null>(null);
  const [refreshAllTaskVisible, setRefreshAllTaskVisible] = useState(false);
  const [refreshingRows, setRefreshingRows] = useState<Record<number, boolean>>({});
  const [refreshingVendors, setRefreshingVendors] = useState<Record<number, boolean>>({});
  const [checkingInVendors, setCheckingInVendors] = useState<Record<number, boolean>>({});
  const vendorCheckinEndpointRef = useRef<Record<number, number>>({});
  const [collapsedGroups, setCollapsedGroups] = useState<CollapsedGroupMap>(initialCollapsedGroups);
  const [collapseStateReady, setCollapseStateReady] = useState(initialCollapsedGroupsReady);
  const [savingSetting, setSavingSetting] = useState(false);
  const [showHiddenList, setShowHiddenList] = useState(false);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('all');
  const [billingFilter, setBillingFilter] = useState<BillingFilterValue>('all');
  const [apiKindFilter, setApiKindFilter] = useState<ApiKindFilterValue>('all');

  const [editingRecord, setEditingRecord] = useState<QuotaRecord | null>(null);
  const [vendorDraft, setVendorDraft] = useState('');
  const [vendorCreateName, setVendorCreateName] = useState('');
  const [useVendorUsedDraft, setUseEndpointUsedDraft] = useState(true);
  const [useVendorRemainingDraft, setUseVendorRemainingDraft] = useState(true);
  const [useVendorAmountDraft, setUseEndpointAmountDraft] = useState(false);
  const [useVendorBalanceDraft, setUseEndpointBalanceDraft] = useState(false);
  const [billingModeDraft, setBillingModeDraft] = useState<BillingMode>('usage');
  const [endpointEnvVarsDraft, setEndpointEnvVarsDraft] = useState<Record<string, string>>({});

  const [editingVendorId, setEditingVendorId] = useState<number | null>(null);
  const [editingVendorName, setEditingVendorName] = useState('');
  const [creatingNewVendor, setCreatingNewVendor] = useState(false);
  const [newVendorNameDraft, setNewVendorNameDraft] = useState('');
  const [vendorSettingLoading, setVendorSettingLoading] = useState(false);
  const [savingVendorSetting, setSavingVendorSetting] = useState(false);
  const [vendorSettingError, setVendorSettingError] = useState<string | null>(null);
  const [vendorTypeSettingDraft, setVendorTypeSettingDraft] = useState<VendorType>(() =>
    resolveDefaultVendorType(initialData.meta.vendorTypes, initialData.meta.vendorDefinitions),
  );
  const [vendorEnvVarsDraft, setVendorEnvVarsDraft] = useState<Record<string, string>>({});
  const refreshAllTaskRef = useRef<RefreshAllTaskState | null>(null);
  const refreshAllEventSourceRef = useRef<EventSource | null>(null);
  const refreshAllHideTimerRef = useRef<number | null>(null);
  const refreshAllTaskContainerRef = useRef<HTMLDivElement | null>(null);
  const autoCleanupOnLoadTriggeredRef = useRef(false);

  const setRefreshAllTaskState = (task: RefreshAllTaskState | null) => {
    refreshAllTaskRef.current = task;
    setRefreshAllTask(task);
  };

  const clearRefreshAllStream = () => {
    if (refreshAllEventSourceRef.current) {
      refreshAllEventSourceRef.current.close();
      refreshAllEventSourceRef.current = null;
    }
  };

  const clearRefreshAllHideTimer = () => {
    if (refreshAllHideTimerRef.current !== null) {
      window.clearTimeout(refreshAllHideTimerRef.current);
      refreshAllHideTimerRef.current = null;
    }
  };

  const scheduleRefreshAllHide = (delayMs = 2600) => {
    clearRefreshAllHideTimer();
    refreshAllHideTimerRef.current = window.setTimeout(() => {
      setRefreshAllTaskVisible(false);
      setRefreshAllTaskState(null);
      refreshAllHideTimerRef.current = null;
    }, delayMs);
  };

  useEffect(() => {
    return () => {
      clearRefreshAllHideTimer();
      clearRefreshAllStream();
    };
  }, []);

  useEffect(() => {
    if (autoCleanupOnLoadTriggeredRef.current) {
      return;
    }
    autoCleanupOnLoadTriggeredRef.current = true;

    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(withBasePath('/api/system-settings/cleanup/on-page-load'), {
          method: 'POST',
        });
        const body = (await response.json().catch(() => ({}))) as AutoCleanupOnPageLoadResponse;
        if (cancelled) {
          return;
        }
        if (!response.ok || !body.ok) {
          if (body.attempted !== false) {
            toast.warning('自动数据维护失败', body.message || '页面刷新后自动维护执行失败');
          }
          return;
        }
        if (!body.attempted) {
          return;
        }

        const deletedEndpoints = Math.max(0, Number(body.deletedEndpoints ?? 0));
        const deletedVendors = Math.max(0, Number(body.deletedVendors ?? 0));
        if (deletedEndpoints === 0 && deletedVendors === 0) {
          return;
        }
        toast.success('自动数据维护完成', `清理端点 ${deletedEndpoints} 条 · 服务商 ${deletedVendors} 个`);
      } catch (error) {
        if (cancelled) {
          return;
        }
        toast.warning('自动数据维护失败', error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const clearOffset = () => {
      root.style.removeProperty(TOAST_BOTTOM_OFFSET_CSS_VAR);
    };

    if (!refreshAllTaskVisible || !refreshAllTask || !refreshAllTaskContainerRef.current) {
      clearOffset();
      return clearOffset;
    }

    const panel = refreshAllTaskContainerRef.current;
    const syncOffset = () => {
      const rect = panel.getBoundingClientRect();
      const gap = 16;
      const offset = Math.max(0, Math.ceil(rect.height + gap));
      root.style.setProperty(TOAST_BOTTOM_OFFSET_CSS_VAR, `${offset}px`);
    };

    syncOffset();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        syncOffset();
      });
      resizeObserver.observe(panel);
    }

    window.addEventListener('resize', syncOffset);

    return () => {
      window.removeEventListener('resize', syncOffset);
      resizeObserver?.disconnect();
      clearOffset();
    };
  }, [refreshAllTask, refreshAllTaskVisible]);

  useEffect(() => {
    if (collapseStateReady) {
      return;
    }
    if (typeof window === 'undefined') {
      setCollapseStateReady(true);
      return;
    }
    try {
      const raw = window.localStorage.getItem(GROUP_COLLAPSE_STORAGE_KEY);
      const next = parseCollapsedGroupStateRaw(raw);
      setCollapsedGroups(next);
    } catch {
    } finally {
      setCollapseStateReady(true);
    }
  }, [collapseStateReady]);

  useEffect(() => {
    if (!collapseStateReady) {
      return;
    }
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(GROUP_COLLAPSE_STORAGE_KEY, JSON.stringify(collapsedGroups));
      const cookieValue = serializeCollapsedGroupsCookieValue(collapsedGroups);
      document.cookie = `${GROUP_COLLAPSE_COOKIE_KEY}=${cookieValue}; Path=/; Max-Age=31536000; SameSite=Lax`;
    } catch {
    }
  }, [collapsedGroups, collapseStateReady]);

  const toggleGroupCollapsed = (groupName: string) => {
    setCollapseStateReady(true);
    setCollapsedGroups((current) => ({
      ...current,
      [groupName]: !Boolean(current[groupName]),
    }));
  };


  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);
  const [isDrawerActive, setIsDrawerActive] = useState(false);
  const [detailViewMode, setDetailViewMode] = useState<DetailViewMode>('endpoint');
  const [detailVendorContext, setDetailVendorContext] = useState<VendorDetailContext | null>(null);
  const [detailTargetRecord, setDetailTargetRecord] = useState<QuotaRecord | null>(null);
  const [detailData, setDetailData] = useState<DebugResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [copiedKeyEndpointId, setCopiedKeyEndpointId] = useState<number | null>(null);

  const visibleRecords = useMemo(
    () => data.records.filter((record) => !record.isHidden),
    [data.records],
  );

  const summary = useMemo(() => {
    let durationRemainingToday = 0;
    let usageUsedTotal = 0;
    let usageTotal = 0;

    const recordsByVendor = new Map<number, QuotaRecord[]>();
    for (const record of visibleRecords) {
      const vendorId = Number(record.vendorId);
      if (!Number.isInteger(vendorId) || vendorId <= 0) {
        continue;
      }
      const existing = recordsByVendor.get(vendorId);
      if (existing) {
        existing.push(record);
      } else {
        recordsByVendor.set(vendorId, [record]);
      }
    }

    // 包月今日剩余按“服务商余额”统计：每个服务商只计一次，避免多端点重复累计。
    for (const records of recordsByVendor.values()) {
      const hasDurationEndpoint = records.some((record) => normalizeBillingModeValue(record.billingMode) === 'duration');
      if (!hasDurationEndpoint) {
        continue;
      }

      const groupVendorType = (records[0]?.vendorType || UNTYPED_VENDOR_VALUE).trim().toLowerCase();
      const groupAggregation: VendorAggregation =
        vendorAggregationMap[groupVendorType] ?? {
          vendor_remaining: 'independent_request',
          vendor_used: 'endpoint_sum',
        };

      const latestRemainingRecord = records
        .filter(
          (record) =>
            record.result.status === 'ok' &&
            typeof (record.result.regionMetrics?.vendorRemainingUsd ?? record.result.remainingUsd) === 'number' &&
            Number.isFinite(record.result.regionMetrics?.vendorRemainingUsd ?? record.result.remainingUsd),
        )
        .sort((left, right) =>
          String(right.result.checkedAt || '').localeCompare(String(left.result.checkedAt || '')),
        )[0] ?? null;
      const latestRemainingStaleRecord = records
        .filter((record) => hasFiniteNumber(record.result.staleLock?.remainingUsd))
        .sort((left, right) =>
          String(right.result.staleLock?.lockedAt || right.result.checkedAt || '')
            .localeCompare(String(left.result.staleLock?.lockedAt || left.result.checkedAt || '')),
        )[0] ?? null;
      const endpointSumRemainingRecords = records
        .filter(
          (record) =>
            record.useVendorRemaining &&
            record.result.status === 'ok' &&
            typeof (record.result.regionMetrics?.endpointRemainingUsd ?? record.result.remainingUsd) === 'number' &&
            Number.isFinite(record.result.regionMetrics?.endpointRemainingUsd ?? record.result.remainingUsd),
        );
      const endpointSumRemaining = endpointSumRemainingRecords.reduce(
        (sum, record) => sum + (record.result.regionMetrics?.endpointRemainingUsd ?? record.result.remainingUsd ?? 0),
        0,
      );
      const endpointSumRemainingStaleRecords = records.filter(
        (record) => record.useVendorRemaining && hasFiniteNumber(record.result.staleLock?.remainingUsd),
      );
      const endpointSumRemainingStale = endpointSumRemainingStaleRecords.reduce(
        (sum, record) => sum + (record.result.staleLock?.remainingUsd ?? 0),
        0,
      );

      const groupBalanceMetric = groupAggregation.vendor_remaining === 'endpoint_sum'
        ? (
            endpointSumRemainingRecords.length > 0
              ? { value: endpointSumRemaining, stale: false }
              : endpointSumRemainingStaleRecords.length > 0
                ? { value: endpointSumRemainingStale, stale: true }
                : null
          )
        : (
            hasFiniteNumber(latestRemainingRecord?.result.regionMetrics?.vendorRemainingUsd ?? latestRemainingRecord?.result.remainingUsd)
              ? {
                  value: latestRemainingRecord!.result.regionMetrics?.vendorRemainingUsd ?? latestRemainingRecord!.result.remainingUsd ?? 0,
                  stale: false,
                }
              : hasFiniteNumber(latestRemainingStaleRecord?.result.staleLock?.remainingUsd)
                ? { value: latestRemainingStaleRecord!.result.staleLock!.remainingUsd ?? 0, stale: true }
                : null
          );

      if (groupBalanceMetric && hasFiniteNumber(groupBalanceMetric.value)) {
        durationRemainingToday += groupBalanceMetric.value;
      }
    }

    // 按量使用比例按“服务商余额 / (服务商余额 + 服务商已用)”统计：仅统计存在按量端点的服务商，且每个服务商只计一次。
    for (const records of recordsByVendor.values()) {
      const usageRecords = records.filter((record) => normalizeBillingModeValue(record.billingMode) !== 'duration');
      if (usageRecords.length === 0) {
        continue;
      }

      const groupVendorType = (records[0]?.vendorType || UNTYPED_VENDOR_VALUE).trim().toLowerCase();
      const groupAggregation: VendorAggregation =
        vendorAggregationMap[groupVendorType] ?? {
          vendor_remaining: 'independent_request',
          vendor_used: 'endpoint_sum',
        };

      const latestUsedRecord = usageRecords
        .filter(
          (record) =>
            record.result.status === 'ok' &&
            typeof (record.result.regionMetrics?.vendorUsedUsd ?? record.result.usedUsd) === 'number' &&
            Number.isFinite(record.result.regionMetrics?.vendorUsedUsd ?? record.result.usedUsd),
        )
        .sort((left, right) =>
          String(right.result.checkedAt || '').localeCompare(String(left.result.checkedAt || '')),
        )[0] ?? null;
      const latestUsedStaleRecord = usageRecords
        .filter((record) => hasFiniteNumber(record.result.staleLock?.usedUsd))
        .sort((left, right) =>
          String(right.result.staleLock?.lockedAt || right.result.checkedAt || '')
            .localeCompare(String(left.result.staleLock?.lockedAt || left.result.checkedAt || '')),
        )[0] ?? null;
      const endpointSumUsedRecords = usageRecords.filter(
        (record) =>
          record.useVendorUsed &&
          record.result.status === 'ok' &&
          typeof (record.result.regionMetrics?.endpointUsedUsd ?? record.result.usedUsd) === 'number' &&
          Number.isFinite(record.result.regionMetrics?.endpointUsedUsd ?? record.result.usedUsd),
      );
      const endpointSumUsed = endpointSumUsedRecords.reduce(
        (sum, record) => sum + (record.result.regionMetrics?.endpointUsedUsd ?? record.result.usedUsd ?? 0),
        0,
      );
      const endpointSumUsedStaleRecords = usageRecords.filter(
        (record) => record.useVendorUsed && hasFiniteNumber(record.result.staleLock?.usedUsd),
      );
      const endpointSumUsedStale = endpointSumUsedStaleRecords.reduce(
        (sum, record) => sum + (record.result.staleLock?.usedUsd ?? 0),
        0,
      );
      const groupUsedMetric = groupAggregation.vendor_used === 'endpoint_sum'
        ? (
            endpointSumUsedRecords.length > 0
              ? { value: endpointSumUsed, stale: false }
              : endpointSumUsedStaleRecords.length > 0
                ? { value: endpointSumUsedStale, stale: true }
                : null
          )
        : (
            hasFiniteNumber(latestUsedRecord?.result.regionMetrics?.vendorUsedUsd ?? latestUsedRecord?.result.usedUsd)
              ? {
                  value: latestUsedRecord!.result.regionMetrics?.vendorUsedUsd ?? latestUsedRecord!.result.usedUsd ?? 0,
                  stale: false,
                }
              : hasFiniteNumber(latestUsedStaleRecord?.result.staleLock?.usedUsd)
                ? { value: latestUsedStaleRecord!.result.staleLock!.usedUsd ?? 0, stale: true }
                : null
          );

      const latestRemainingRecord = usageRecords
        .filter(
          (record) =>
            record.result.status === 'ok' &&
            typeof (record.result.regionMetrics?.vendorRemainingUsd ?? record.result.remainingUsd) === 'number' &&
            Number.isFinite(record.result.regionMetrics?.vendorRemainingUsd ?? record.result.remainingUsd),
        )
        .sort((left, right) =>
          String(right.result.checkedAt || '').localeCompare(String(left.result.checkedAt || '')),
        )[0] ?? null;
      const latestRemainingStaleRecord = usageRecords
        .filter((record) => hasFiniteNumber(record.result.staleLock?.remainingUsd))
        .sort((left, right) =>
          String(right.result.staleLock?.lockedAt || right.result.checkedAt || '')
            .localeCompare(String(left.result.staleLock?.lockedAt || left.result.checkedAt || '')),
        )[0] ?? null;
      const endpointSumRemainingRecords = usageRecords
        .filter(
          (record) =>
            record.useVendorRemaining &&
            record.result.status === 'ok' &&
            typeof (record.result.regionMetrics?.endpointRemainingUsd ?? record.result.remainingUsd) === 'number' &&
            Number.isFinite(record.result.regionMetrics?.endpointRemainingUsd ?? record.result.remainingUsd),
        );
      const endpointSumRemaining = endpointSumRemainingRecords.reduce(
        (sum, record) => sum + (record.result.regionMetrics?.endpointRemainingUsd ?? record.result.remainingUsd ?? 0),
        0,
      );
      const endpointSumRemainingStaleRecords = usageRecords.filter(
        (record) => record.useVendorRemaining && hasFiniteNumber(record.result.staleLock?.remainingUsd),
      );
      const endpointSumRemainingStale = endpointSumRemainingStaleRecords.reduce(
        (sum, record) => sum + (record.result.staleLock?.remainingUsd ?? 0),
        0,
      );
      const groupBalanceMetric = groupAggregation.vendor_remaining === 'endpoint_sum'
        ? (
            endpointSumRemainingRecords.length > 0
              ? { value: endpointSumRemaining, stale: false }
              : endpointSumRemainingStaleRecords.length > 0
                ? { value: endpointSumRemainingStale, stale: true }
                : null
          )
        : (
            hasFiniteNumber(latestRemainingRecord?.result.regionMetrics?.vendorRemainingUsd ?? latestRemainingRecord?.result.remainingUsd)
              ? {
                  value: latestRemainingRecord!.result.regionMetrics?.vendorRemainingUsd ?? latestRemainingRecord!.result.remainingUsd ?? 0,
                  stale: false,
                }
              : hasFiniteNumber(latestRemainingStaleRecord?.result.staleLock?.remainingUsd)
                ? { value: latestRemainingStaleRecord!.result.staleLock!.remainingUsd ?? 0, stale: true }
                : null
          );

      const groupUsedValue = groupUsedMetric && hasFiniteNumber(groupUsedMetric.value)
        ? Math.max(groupUsedMetric.value, 0)
        : 0;
      const groupRemainingValue = groupBalanceMetric && hasFiniteNumber(groupBalanceMetric.value)
        ? Math.max(groupBalanceMetric.value, 0)
        : 0;
      const groupUsageTotal = groupRemainingValue + groupUsedValue;

      if (groupUsageTotal > 0) {
        usageUsedTotal += groupUsedValue;
        usageTotal += groupUsageTotal;
      }
    }

    const latencyValues = visibleRecords
      .map((record) => record.result.latencyMs)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

    const avgLatency =
      latencyValues.length > 0
        ? Math.round(latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length)
        : 0;

    const usageRatio = usageTotal > 0 ? ((usageTotal - usageUsedTotal) / usageTotal) * 100 : 0;

    return { durationRemainingToday, usageRatio, avgLatency };
  }, [vendorAggregationMap, visibleRecords]);

  const refreshAllProgressPercent = useMemo(() => {
    if (!refreshAllTask) {
      return 0;
    }
    if (refreshAllTask.total <= 0) {
      return refreshAllTask.status === 'running' ? 0 : 100;
    }
    return Math.max(0, Math.min(100, (refreshAllTask.completed / refreshAllTask.total) * 100));
  }, [refreshAllTask]);

  const refreshAllSuccessCount = useMemo(() => {
    if (!refreshAllTask) {
      return 0;
    }
    return Math.max(0, refreshAllTask.completed - refreshAllTask.failed);
  }, [refreshAllTask]);

  const notifyRefreshAllCompleted = useCallback((task: RefreshAllTaskState) => {
    const success = Math.max(0, task.completed - task.failed);
    toast.success('全部刷新完成', `成功 ${success}/${task.total} · 失败 ${task.failed}`);
  }, []);

  const buildSharedEnvVarValueMap = (
    vendorId: number | null,
    excludeEndpointId?: number | null,
  ): Map<string, SharedEnvVarEntry> => {
    const shared = new Map<string, SharedEnvVarEntry>();
    if (!Number.isInteger(vendorId) || (vendorId ?? 0) <= 0) {
      return shared;
    }

    const vendorOption = data.meta.endpoints.find((endpoint) => endpoint.id === vendorId) ?? null;
    if (vendorOption?.envVars && typeof vendorOption.envVars === 'object') {
      for (const [rawKey, rawValue] of Object.entries(vendorOption.envVars)) {
        const key = rawKey.trim();
        const value = normalizeEnvVarValue(rawValue);
        if (!key || !value) continue;
        const lowered = key.toLowerCase();
        if (!shared.has(lowered)) {
          shared.set(lowered, { value, source: 'vendor' });
        }
      }
    }

    for (const record of data.records) {
      if (record.vendorId !== vendorId) continue;
      if (excludeEndpointId && record.endpointId === excludeEndpointId) continue;
      const envVars = record.endpointEnvVars ?? {};
      for (const [rawKey, rawValue] of Object.entries(envVars)) {
        const key = rawKey.trim();
        const value = normalizeEnvVarValue(rawValue);
        if (!key || !value) continue;
        const lowered = key.toLowerCase();
        if (!shared.has(lowered)) {
          shared.set(lowered, { value, source: 'endpoint' });
        }
      }
    }

    return shared;
  };

  const mergeSharedEnvVarDefaults = (
    current: Record<string, string>,
    candidateKeys: string[],
    vendorId: number | null,
    excludeEndpointId?: number | null,
  ): Record<string, string> => {
    const shared = buildSharedEnvVarValueMap(vendorId, excludeEndpointId);
    if (shared.size === 0) {
      return { ...(current ?? {}) };
    }

    const next: Record<string, string> = { ...(current ?? {}) };
    const keys = new Set<string>([...Object.keys(next), ...candidateKeys]);
    for (const key of keys) {
      const normalizedKey = key.trim();
      if (!normalizedKey) continue;
      const existing = normalizeEnvVarValue(next[normalizedKey]);
      if (existing) continue;
      const sharedEntry = shared.get(normalizedKey.toLowerCase());
      if (sharedEntry) {
        next[normalizedKey] = sharedEntry.value;
      }
    }

    return next;
  };

  const mergeVendorEnvVarDefaults = (
    current: Record<string, string>,
    candidateKeys: string[],
    vendorEnvVars: Record<string, string> | null | undefined,
  ): Record<string, string> => {
    const next: Record<string, string> = { ...(current ?? {}) };
    if (!vendorEnvVars || typeof vendorEnvVars !== 'object') {
      return next;
    }

    const vendorMap = new Map<string, string>();
    for (const [rawKey, rawValue] of Object.entries(vendorEnvVars)) {
      const key = rawKey.trim();
      const value = normalizeEnvVarValue(rawValue);
      if (!key || !value) {
        continue;
      }
      const lowered = key.toLowerCase();
      if (!vendorMap.has(lowered)) {
        vendorMap.set(lowered, value);
      }
    }

    if (vendorMap.size === 0) {
      return next;
    }

    const keys = new Set<string>([...Object.keys(next), ...candidateKeys]);
    for (const key of keys) {
      const normalizedKey = key.trim();
      if (!normalizedKey) {
        continue;
      }
      const existing = normalizeEnvVarValue(next[normalizedKey]);
      if (existing) {
        continue;
      }
      const matchedValue = vendorMap.get(normalizedKey.toLowerCase());
      if (matchedValue) {
        next[normalizedKey] = matchedValue;
      }
    }

    return next;
  };

  const statusCountMap = useMemo((): Record<StatusFilterValue, number> => {
    const okCount = visibleRecords.filter((record) => record.result.status === 'ok').length;
    return {
      all: visibleRecords.length,
      ok: okCount,
      error: visibleRecords.length - okCount,
    };
  }, [visibleRecords]);

  const filteredRecords = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    return data.records.filter((record) => {
      if (record.isHidden) {
        return false;
      }

      if (statusFilter === 'ok' && record.result.status !== 'ok') {
        return false;
      }
      if (statusFilter === 'error' && record.result.status === 'ok') {
        return false;
      }

      const normalizedBillingMode = normalizeBillingModeValue(record.billingMode);
      if (billingFilter !== 'all' && normalizedBillingMode !== billingFilter) {
        return false;
      }
      const endpointApiKind = detectEndpointApiKind(record, vendorApiKindMap).kind;
      if (apiKindFilter !== 'all' && endpointApiKind !== apiKindFilter) {
        return false;
      }

      if (!keyword) {
        return true;
      }

      return (
        record.endpointName.toLowerCase().includes(keyword) ||
        record.endpointUrl.toLowerCase().includes(keyword) ||
        (record.vendorName ?? '').toLowerCase().includes(keyword)
      );
    });
  }, [apiKindFilter, billingFilter, data.records, search, statusFilter, vendorApiKindMap]);

  const groupedRecords = useMemo(() => {
    const groups = new Map<string, QuotaRecord[]>();
    const vendorDisplayOrderMap = new Map<number, number | null>();
    for (const vendor of data.meta.endpoints) {
      vendorDisplayOrderMap.set(
        vendor.id,
        typeof vendor.displayOrder === 'number' && Number.isFinite(vendor.displayOrder)
          ? vendor.displayOrder
          : null,
      );
    }

    for (const record of filteredRecords) {
      const groupName = summarizeGroupName(record.vendorName ?? '');
      if (!groups.has(groupName)) {
        groups.set(groupName, []);
      }
      groups.get(groupName)!.push(record);
    }

    const resolveGroupDisplayOrder = (records: QuotaRecord[]): number | null => {
      const vendorId = records.find((record) => Number.isInteger(record.vendorId) && Number(record.vendorId) > 0)?.vendorId ?? null;
      if (!vendorId) {
        return null;
      }
      return vendorDisplayOrderMap.get(Number(vendorId)) ?? null;
    };

    const result = Array.from(groups.entries()).sort((left, right) => {
      if (left[0] === '未分组') {
        return -1;
      }
      if (right[0] === '未分组') {
        return 1;
      }
      const leftDisplayOrder = resolveGroupDisplayOrder(left[1]);
      const rightDisplayOrder = resolveGroupDisplayOrder(right[1]);
      const leftHasOrder = typeof leftDisplayOrder === 'number' && Number.isFinite(leftDisplayOrder);
      const rightHasOrder = typeof rightDisplayOrder === 'number' && Number.isFinite(rightDisplayOrder);
      if (leftHasOrder && rightHasOrder && leftDisplayOrder !== rightDisplayOrder) {
        return Number(leftDisplayOrder) - Number(rightDisplayOrder);
      }
      if (leftHasOrder && !rightHasOrder) {
        return -1;
      }
      if (!leftHasOrder && rightHasOrder) {
        return 1;
      }
      return left[0].localeCompare(right[0], 'zh-CN');
    });

    for (const [, records] of result) {
      records.sort((left, right) => {
        const lp = left.useVendorUsed || left.useVendorRemaining ? 0 : 1;
        const rp = right.useVendorUsed || right.useVendorRemaining ? 0 : 1;
        if (lp !== rp) return lp - rp;
        const le = left.isEnabled ? 0 : 1;
        const re = right.isEnabled ? 0 : 1;
        if (le !== re) return le - re;
        return left.endpointId - right.endpointId;
      });
    }

    return result;
  }, [data.meta.endpoints, filteredRecords, vendorAggregationMap, vendorDailyCheckinEnabledMap]);

  const filteredDetailProbes = useMemo(() => {
    if (!detailData) {
      return [] as DebugProbe[];
    }

    const endpointHost = resolveHost(detailData.endpoint.url);
    const list: DebugProbe[] = [];
    for (const probe of detailData.probes) {
      const filteredProbe = filterProbeByEndpointHost(probe, endpointHost);
      if (!filteredProbe) {
        continue;
      }
      list.push(filteredProbe);
    }
    return list;
  }, [detailData]);

  const detailFieldRows = useMemo(() => {
    if (!detailData) {
      return [] as Array<{
        key: string;
        label: string;
        apiPath: string;
        extractionPath: string;
        valueText: string;
        valueStale: boolean;
        sourceText: string;
        state: ExtractionState;
        probe: DebugProbe | null;
      }>;
    }

    const selectProbe = (
      purpose: DebugProbe['purpose'],
      _pathHint: string | null,
      strategyPrefix?: string,
    ): DebugProbe | null => {
      const candidates = filteredDetailProbes.filter((probe) => probe.purpose === purpose);
      if (candidates.length === 0) {
        return null;
      }
      if (strategyPrefix) {
        const byStrategy = candidates.filter((probe) => {
          const name = (probe.strategy || '').trim();
          return name === strategyPrefix || name.startsWith(`${strategyPrefix}-`);
        });
        if (byStrategy.length > 0) {
          return byStrategy[byStrategy.length - 1];
        }
      }
      return null;
    };

    const regionMetrics = detailData.resultRegionMetrics ?? null;
    const regionSources = detailData.resultRegionSources ?? null;
    const regionFieldPaths = detailData.resultRegionFieldPaths ?? null;
    const toNumberOrNull = (value: unknown): number | null =>
      typeof value === 'number' && Number.isFinite(value) ? value : null;
    const staleLock = detailData.resultStaleLock ?? null;
    const staleFor = (field: 'totalUsd' | 'usedUsd' | 'remainingUsd'): number | null =>
      toNumberOrNull(staleLock?.[field]);
    const endpointUsed = toNumberOrNull(regionMetrics?.endpointUsedUsd);
    const endpointRemaining = toNumberOrNull(regionMetrics?.endpointRemainingUsd);
    const endpointTotal = toNumberOrNull(regionMetrics?.endpointTotalUsd) ?? toNumberOrNull(detailData.resultTotalUsd);
    const tokenUsed = toNumberOrNull(detailData.resultTokenUsed);
    const tokenAvailable = toNumberOrNull(detailData.resultTokenAvailable);
    const lastCreditReset = (detailData.resultLastCreditReset || '').trim() || null;

    const buildState = (
      valueExists: boolean,
      hasSource: boolean,
      probe: DebugProbe | null,
    ): ExtractionState => {
      if (valueExists) return 'success';
      if (hasSource || probe) return 'failed';
      return 'not_run';
    };

    const rows: Array<{
      key: string;
      label: string;
      apiPath: string;
      extractionPath: string;
      valueText: string;
      valueStale: boolean;
      sourceText: string;
      state: ExtractionState;
      probe: DebugProbe | null;
    }> = [];

    if (detailViewMode === 'vendor') {
      const vendorRemainingSourceRaw = (regionSources?.vendorRemaining || detailData.resultRemainingSource || '').trim();
      const vendorRemainingFieldPath = (regionFieldPaths?.vendorRemaining || '').trim();
      const vendorRemainingProbe = detailVendorContext?.remainingMode === 'endpoint_sum'
        ? null
        : selectProbe('amount', null, 'region-vendor_remaining');
      const vendorRemainingValueFromQuery = toNumberOrNull(regionMetrics?.vendorRemainingUsd);
      const vendorRemainingFromContext =
        hasFiniteNumber(detailVendorContext?.remainingValue)
          ? detailVendorContext.remainingValue
          : null;
      const vendorRemainingValue = detailVendorContext?.remainingMode === 'endpoint_sum'
        ? vendorRemainingFromContext
        : vendorRemainingValueFromQuery;
      const vendorRemainingStaleFromLock = vendorRemainingValue === null ? staleFor('remainingUsd') : null;
      const vendorRemainingStale = detailVendorContext?.remainingMode === 'endpoint_sum'
        ? Boolean(detailVendorContext?.remainingStale)
        : vendorRemainingStaleFromLock !== null;
      const vendorRemainingSource = detailVendorContext?.remainingMode === 'endpoint_sum'
        ? '服务商余额 = 端点余额求和'
        : (vendorRemainingSourceRaw || '-');
      rows.push({
        key: 'vendor_remaining',
        label: '服务商余额',
        apiPath:
          detailVendorContext?.remainingMode === 'endpoint_sum'
            ? '-'
            : (extractApiPathFromSourceText(vendorRemainingSourceRaw) || vendorRemainingProbe?.path || '-'),
        extractionPath:
          detailVendorContext?.remainingMode === 'endpoint_sum'
            ? '-'
            : (vendorRemainingFieldPath || '-'),
        valueText:
          vendorRemainingValue !== null
            ? `$${formatUsd(vendorRemainingValue)}`
            : vendorRemainingStaleFromLock !== null
              ? `$${formatUsd(vendorRemainingStaleFromLock)}`
              : '-',
        valueStale: vendorRemainingStale,
        sourceText: vendorRemainingSource,
        state: buildState(
          vendorRemainingValue !== null && !vendorRemainingStale,
          Boolean(vendorRemainingSourceRaw) || detailVendorContext?.remainingMode === 'endpoint_sum' || vendorRemainingStale,
          vendorRemainingProbe,
        ),
        probe: vendorRemainingProbe,
      });

      const vendorUsedSourceRaw = (regionSources?.vendorUsed || detailData.resultUsedSource || '').trim();
      const vendorUsedFieldPath = (regionFieldPaths?.vendorUsed || '').trim();
      const vendorUsedProbe = detailVendorContext?.usedMode === 'endpoint_sum'
        ? null
        : selectProbe('amount', null, 'region-vendor_used');
      const vendorUsedValueFromQuery = toNumberOrNull(regionMetrics?.vendorUsedUsd);
      const vendorUsedFromContext =
        hasFiniteNumber(detailVendorContext?.usedValue)
          ? detailVendorContext.usedValue
          : null;
      const vendorUsedValue = detailVendorContext?.usedMode === 'endpoint_sum'
        ? vendorUsedFromContext
        : vendorUsedValueFromQuery;
      const vendorUsedStaleFromLock = vendorUsedValue === null ? staleFor('usedUsd') : null;
      const vendorUsedStale = detailVendorContext?.usedMode === 'endpoint_sum'
        ? Boolean(detailVendorContext?.usedStale)
        : vendorUsedStaleFromLock !== null;
      const vendorUsedSource = detailVendorContext?.usedMode === 'endpoint_sum'
        ? '服务商已用 = 端点已用求和'
        : (vendorUsedSourceRaw || '-');
      rows.push({
        key: 'vendor_used',
        label: '服务商已用',
        apiPath:
          detailVendorContext?.usedMode === 'endpoint_sum'
            ? '-'
            : (extractApiPathFromSourceText(vendorUsedSourceRaw) || vendorUsedProbe?.path || '-'),
        extractionPath:
          detailVendorContext?.usedMode === 'endpoint_sum'
            ? '-'
            : (vendorUsedFieldPath || '-'),
        valueText:
          vendorUsedValue !== null
            ? `$${formatUsd(vendorUsedValue)}`
            : vendorUsedStaleFromLock !== null
              ? `$${formatUsd(vendorUsedStaleFromLock)}`
              : '-',
        valueStale: vendorUsedStale,
        sourceText: vendorUsedSource,
        state: buildState(
          vendorUsedValue !== null && !vendorUsedStale,
          Boolean(vendorUsedSourceRaw) || detailVendorContext?.usedMode === 'endpoint_sum' || vendorUsedStale,
          vendorUsedProbe,
        ),
        probe: vendorUsedProbe,
      });

      const dailyCheckinProbe = selectProbe('daily_checkin', null, 'region-daily_checkin');
      const dailyCheckinStatus = (detailData.resultDailyCheckinStatus || '').trim().toLowerCase();
      const dailyCheckinMessage = (detailData.resultDailyCheckinMessage || '').trim();
      const dailyCheckinDateSourceRaw = (regionSources?.dailyCheckinDate || detailData.resultDailyCheckinSource || '').trim();
      const dailyCheckinDateFieldPath = (regionFieldPaths?.dailyCheckinDate || '').trim();
      const dailyCheckinDateValue = (detailData.resultDailyCheckinDate || '').trim() || null;
      const dailyCheckinDateSource = dailyCheckinMessage
        ? `${dailyCheckinDateSourceRaw || '-'}（${dailyCheckinMessage}）`
        : (dailyCheckinDateSourceRaw || '-');
      const dailyCheckinAwardedSourceRaw = (regionSources?.dailyCheckinAwarded || detailData.resultDailyCheckinSource || '').trim();
      const dailyCheckinAwardedFieldPath = (regionFieldPaths?.dailyCheckinAwarded || '').trim();
      const dailyCheckinAwardedValue = toNumberOrNull(detailData.resultDailyCheckinAwarded);
      const dailyCheckinAwardedSource = dailyCheckinMessage
        ? `${dailyCheckinAwardedSourceRaw || '-'}（${dailyCheckinMessage}）`
        : (dailyCheckinAwardedSourceRaw || '-');
      const hasDailyCheckinData =
        Boolean(dailyCheckinDateValue)
        || dailyCheckinAwardedValue !== null
        || Boolean(dailyCheckinDateSourceRaw)
        || Boolean(dailyCheckinAwardedSourceRaw)
        || Boolean(dailyCheckinProbe)
        || Boolean(dailyCheckinMessage)
        || Boolean(dailyCheckinStatus);
      if (hasDailyCheckinData) {
        const checkinFailed = dailyCheckinStatus !== '' && dailyCheckinStatus !== 'ok';
        const checkinStatusText = STATUS_LABELS[dailyCheckinStatus] || dailyCheckinStatus || '-';
        const awardedText = dailyCheckinAwardedValue === null ? '-' : dailyCheckinAwardedValue.toLocaleString();
        const valueParts = [
          `状态：${checkinStatusText}`,
          `日期：${dailyCheckinDateValue || '-'}`,
          `奖励：${awardedText}`,
        ];
        const sourceParts = [
          `日期来源：${dailyCheckinDateSource}`,
          `奖励来源：${dailyCheckinAwardedSource}`,
        ];
        const extractionPathParts = [
          `date: ${dailyCheckinDateFieldPath || '-'}`,
          `awarded: ${dailyCheckinAwardedFieldPath || '-'}`,
        ];

        rows.push({
          key: 'daily_checkin',
          label: '每日签到',
          apiPath:
            extractApiPathFromSourceText(dailyCheckinDateSourceRaw)
            || extractApiPathFromSourceText(dailyCheckinAwardedSourceRaw)
            || dailyCheckinProbe?.path
            || '-',
          extractionPath: extractionPathParts.join(' | '),
          valueText: valueParts.join(' | '),
          valueStale: false,
          sourceText: sourceParts.join(' | '),
          state: checkinFailed
            ? 'failed'
            : buildState(
              Boolean(dailyCheckinDateValue) || dailyCheckinAwardedValue !== null,
              Boolean(dailyCheckinDateSourceRaw) || Boolean(dailyCheckinAwardedSourceRaw) || Boolean(dailyCheckinMessage) || dailyCheckinStatus === 'ok',
              dailyCheckinProbe,
            ),
          probe: dailyCheckinProbe,
        });
      }

      return rows;
    }

    const endpointUsedSource = (regionSources?.endpointUsed || detailData.resultUsedSource || '').trim();
    const endpointUsedApiPath = extractApiPathFromSourceText(endpointUsedSource);
    const endpointUsedProbe = selectProbe('amount', endpointUsedApiPath, 'region-endpoint_used');
    const endpointUsedFieldPath = (regionFieldPaths?.endpointUsed || '').trim();
    const endpointUsedStale = endpointUsed === null ? staleFor('usedUsd') : null;
    rows.push({
      key: 'endpoint_used',
      label: '端点已用',
      apiPath: endpointUsedApiPath || endpointUsedProbe?.path || '-',
      extractionPath: endpointUsedFieldPath || '-',
      valueText:
        endpointUsed !== null
          ? `$${formatUsd(endpointUsed)}`
          : endpointUsedStale !== null
            ? `$${formatUsd(endpointUsedStale)}`
            : '-',
      valueStale: endpointUsedStale !== null,
      sourceText: endpointUsedSource || '-',
      state: buildState(endpointUsed !== null, Boolean(endpointUsedSource) || endpointUsedStale !== null, endpointUsedProbe),
      probe: endpointUsedProbe,
    });

    const endpointRemainingSource = (regionSources?.endpointRemaining || detailData.resultRemainingSource || '').trim();
    const endpointRemainingApiPath = extractApiPathFromSourceText(endpointRemainingSource);
    const endpointRemainingProbe = selectProbe('amount', endpointRemainingApiPath, 'region-endpoint_remaining');
    const endpointRemainingFieldPath = (regionFieldPaths?.endpointRemaining || '').trim();
    const endpointRemainingStale = endpointRemaining === null ? staleFor('remainingUsd') : null;
    rows.push({
      key: 'endpoint_remaining',
      label: '端点余额',
      apiPath: endpointRemainingApiPath || endpointRemainingProbe?.path || '-',
      extractionPath: endpointRemainingFieldPath || '-',
      valueText:
        endpointRemaining !== null
          ? `$${formatUsd(endpointRemaining)}`
          : endpointRemainingStale !== null
            ? `$${formatUsd(endpointRemainingStale)}`
            : '-',
      valueStale: endpointRemainingStale !== null,
      sourceText: endpointRemainingSource || '-',
      state: buildState(endpointRemaining !== null, Boolean(endpointRemainingSource) || endpointRemainingStale !== null, endpointRemainingProbe),
      probe: endpointRemainingProbe,
    });

    const endpointTotalSource = (regionSources?.endpointTotal || detailData.resultTotalSource || '').trim();
    const endpointTotalApiPath = extractApiPathFromSourceText(endpointTotalSource);
    const endpointTotalProbe = selectProbe('amount', endpointTotalApiPath, 'region-endpoint_total');
    const endpointTotalFieldPath = (regionFieldPaths?.endpointTotal || '').trim();
    const endpointTotalStale = endpointTotal === null ? staleFor('totalUsd') : null;
    rows.push({
      key: 'endpoint_total',
      label: '端点总额',
      apiPath: endpointTotalApiPath || endpointTotalProbe?.path || '-',
      extractionPath: endpointTotalFieldPath || '-',
      valueText:
        endpointTotal !== null
          ? `$${formatUsd(endpointTotal)}`
          : endpointTotalStale !== null
            ? `$${formatUsd(endpointTotalStale)}`
            : '-',
      valueStale: endpointTotalStale !== null,
      sourceText: endpointTotalSource || '-',
      state: buildState(endpointTotal !== null, Boolean(endpointTotalSource) || endpointTotalStale !== null, endpointTotalProbe),
      probe: endpointTotalProbe,
    });

    if (tokenUsed !== null || tokenAvailable !== null || filteredDetailProbes.some((probe) => probe.purpose === 'token_usage')) {
      const tokenUsedSource = (regionSources?.tokenUsed || '').trim();
      const tokenUsedApiPath = extractApiPathFromSourceText(tokenUsedSource);
      const tokenUsageProbe = selectProbe('token_usage', tokenUsedApiPath, 'region-middle-token_usage');
      const tokenUsedFieldPath = (regionFieldPaths?.tokenUsed || '').trim();
      rows.push({
        key: 'token_used',
        label: 'Token 已用',
        apiPath: tokenUsedApiPath || tokenUsageProbe?.path || '-',
        extractionPath: tokenUsedFieldPath || '-',
        valueText: tokenUsed === null ? '-' : tokenUsed.toLocaleString(),
        valueStale: false,
        sourceText: tokenUsedSource || '-',
        state: buildState(tokenUsed !== null, Boolean(tokenUsedSource), tokenUsageProbe),
        probe: tokenUsageProbe,
      });

      const tokenAvailableSource = (regionSources?.tokenAvailable || '').trim();
      const tokenAvailableApiPath = extractApiPathFromSourceText(tokenAvailableSource);
      const tokenAvailableProbe = selectProbe('token_usage', tokenAvailableApiPath, 'region-middle-token_usage');
      const tokenAvailableFieldPath = (regionFieldPaths?.tokenAvailable || '').trim();
      rows.push({
        key: 'token_available',
        label: 'Token 剩余',
        apiPath: tokenAvailableApiPath || tokenAvailableProbe?.path || '-',
        extractionPath: tokenAvailableFieldPath || '-',
        valueText: tokenAvailable === null ? '-' : tokenAvailable.toLocaleString(),
        valueStale: false,
        sourceText: tokenAvailableSource || '-',
        state: buildState(tokenAvailable !== null, Boolean(tokenAvailableSource), tokenAvailableProbe),
        probe: tokenAvailableProbe,
      });
    }

    if (lastCreditReset || filteredDetailProbes.some((probe) => probe.purpose === 'reset_date')) {
      const lastCreditResetSource = (regionSources?.lastCreditReset || '').trim();
      const lastCreditResetApiPath = extractApiPathFromSourceText(lastCreditResetSource);
      const resetProbe = selectProbe('reset_date', lastCreditResetApiPath, 'region-middle-reset_date');
      const lastCreditResetFieldPath = (regionFieldPaths?.lastCreditReset || '').trim();
      rows.push({
        key: 'last_reset',
        label: '上次重置时间',
        apiPath: lastCreditResetApiPath || resetProbe?.path || '-',
        extractionPath: lastCreditResetFieldPath || '-',
        valueText: lastCreditReset || '-',
        valueStale: false,
        sourceText: lastCreditResetSource || '-',
        state: buildState(Boolean(lastCreditReset), Boolean(lastCreditResetSource), resetProbe),
        probe: resetProbe,
      });
    }

    const latestRefreshProbe = filteredDetailProbes
      .filter((probe) => probe.purpose === 'refresh')
      .at(-1) ?? null;
    if (latestRefreshProbe) {
      const refreshAttempt = pickPrimaryAttempt(latestRefreshProbe);
      const refreshSucceeded = Boolean(refreshAttempt && refreshAttempt.status >= 200 && refreshAttempt.status < 400);
      rows.push({
        key: 'refresh_token',
        label: '刷新令牌',
        apiPath: refreshAttempt?.url || latestRefreshProbe.path || '-',
        extractionPath: '-',
        valueText: refreshAttempt ? debugStatusText(refreshAttempt.status) : (refreshSucceeded ? '已刷新' : '刷新失败'),
        valueStale: false,
        sourceText: latestRefreshProbe.note || '鉴权失败后触发刷新令牌请求',
        state: refreshSucceeded ? 'success' : 'failed',
        probe: latestRefreshProbe,
      });
    }

    const latestRetryProbe = latestRefreshProbe
      ? (filteredDetailProbes
        .filter((probe) => (probe.strategy || '').endsWith('-retry') || (probe.note || '').includes('刷新 token 后重试'))
        .at(-1) ?? null)
      : null;
    if (latestRetryProbe) {
      const retryAttempt = pickPrimaryAttempt(latestRetryProbe);
      const retrySucceeded = Boolean(retryAttempt && retryAttempt.status >= 200 && retryAttempt.status < 400);
      rows.push({
        key: 'refresh_retry',
        label: '自动重试',
        apiPath: retryAttempt?.url || latestRetryProbe.path || '-',
        extractionPath: '-',
        valueText: retryAttempt ? debugStatusText(retryAttempt.status) : (retrySucceeded ? '重试成功' : '重试失败'),
        valueStale: false,
        sourceText: latestRetryProbe.note || '刷新 token 后使用新凭据重试请求',
        state: retrySucceeded ? 'success' : 'failed',
        probe: latestRetryProbe,
      });
    }

    return rows;
  }, [detailData, filteredDetailProbes, detailViewMode, detailVendorContext]);

  const renderedDetailRows = useMemo(() => {
    if (detailViewMode !== 'vendor') {
      return detailFieldRows;
    }
    return detailFieldRows.filter(
      (row) =>
        row.key === 'vendor_used'
        || row.key === 'vendor_remaining'
        || row.key === 'daily_checkin'
        || row.key === 'refresh_token'
        || row.key === 'refresh_retry',
    );
  }, [detailFieldRows, detailViewMode]);

  // Do not show aggregated "message/resultMessage" blocks in detail drawer.
  // The useful info is already present in per-attempt errors and response bodies.

  const updateSingleRecord = (nextRecord: QuotaRecord, fallback?: QuotaRecord) => {
    const pickDefined = <T,>(value: T | undefined, fallbackValue: T): T =>
      value === undefined ? fallbackValue : value;

    setData((current) => ({
      ...current,
      generatedAt: new Date().toISOString(),
      records: current.records.map((record) => {
        if (record.endpointId === nextRecord.endpointId) {
          if (!fallback) {
            return nextRecord;
          }

          return {
            ...nextRecord,
            vendorId: pickDefined(nextRecord.vendorId, fallback.vendorId),
            vendorName: pickDefined(nextRecord.vendorName, fallback.vendorName),
            vendorType: pickDefined(nextRecord.vendorType, fallback.vendorType),
            billingMode: pickDefined(nextRecord.billingMode, fallback.billingMode),
            useVendorGroup: pickDefined(nextRecord.useVendorGroup, fallback.useVendorGroup),
            useVendorUsed: pickDefined(nextRecord.useVendorUsed, fallback.useVendorUsed),
            useVendorRemaining: pickDefined(nextRecord.useVendorRemaining, fallback.useVendorRemaining),
            useVendorAmount: pickDefined(nextRecord.useVendorAmount, fallback.useVendorAmount),
            useVendorBalance: pickDefined(nextRecord.useVendorBalance, fallback.useVendorBalance),
            endpointEnvVars: pickDefined(nextRecord.endpointEnvVars, fallback.endpointEnvVars),
            vendorBalanceUsd: pickDefined(nextRecord.vendorBalanceUsd, fallback.vendorBalanceUsd),
            vendorBalanceCheckedAt: pickDefined(nextRecord.vendorBalanceCheckedAt, fallback.vendorBalanceCheckedAt),
            vendorBalanceStrategy: pickDefined(nextRecord.vendorBalanceStrategy, fallback.vendorBalanceStrategy),
          };
        }

        // Sync endpoint balance to sibling endpoints sharing the same vendor
        if (
          nextRecord.vendorId !== null &&
          record.vendorId === nextRecord.vendorId &&
          nextRecord.vendorBalanceUsd !== null
        ) {
          return {
            ...record,
            vendorBalanceUsd: nextRecord.vendorBalanceUsd,
            vendorBalanceCheckedAt: nextRecord.vendorBalanceCheckedAt,
            vendorBalanceStrategy: nextRecord.vendorBalanceStrategy,
          };
        }

        return record;
      }),
    }));
  };

  const syncCookieAlerts = (records: QuotaRecord[]) => {
    const expired = records
      .filter((r) => r.result.credentialIssue === 'cookie_expired')
      .map((r) => ({ endpointId: r.endpointId, endpointName: r.endpointName }));
    setCookieAlerts(expired);
  };

  const applyRefreshedRecords = (
    records: QuotaRecord[],
    meta?: QuotaApiResponse['meta'],
    generatedAt?: string,
  ) => {
    setData((current) => {
      const refreshedMap = new Map(records.map((record) => [record.endpointId, record]));
      const merged = current.records.map((record) => refreshedMap.get(record.endpointId) ?? record);
      syncCookieAlerts(merged);
      return {
        ...current,
        generatedAt: generatedAt ?? new Date().toISOString(),
        meta: meta ?? current.meta,
        records: merged,
      };
    });
  };

  const reloadDashboardData = useCallback(async () => {
    const response = await fetch(withBasePath('/api/endpoints'), { cache: 'no-store' });
    const body = (await response.json()) as QuotaApiResponse & { message?: string };
    if (!response.ok || !body.ok) {
      throw new Error(body.message || '刷新后读取列表失败');
    }
    setData(body);
    syncCookieAlerts(body.records);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      if (refreshingAll || savingSetting || savingVendorSetting) {
        return;
      }
      if (editingRecord || detailDrawerOpen || editingVendorId !== null || creatingNewVendor) {
        return;
      }
      void reloadDashboardData().catch(() => {
        // Keep silent for background polling; user-visible actions already have explicit toasts.
      });
    }, DASHBOARD_AUTO_RELOAD_INTERVAL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [
    creatingNewVendor,
    detailDrawerOpen,
    editingRecord,
    editingVendorId,
    refreshingAll,
    reloadDashboardData,
    savingSetting,
    savingVendorSetting,
  ]);

  const toggleHidden = async (endpointId: number, hide: boolean) => {
    try {
      const res = await fetch(withBasePath('/api/endpoint-settings'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpointId, isHidden: hide }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.message || '操作失败');
      setData((prev) => ({
        ...prev,
        records: prev.records.map((r) => r.endpointId === endpointId ? { ...r, isHidden: hide } : r),
      }));
      if (hide) {
        setEditingRecord(null);
        toast.success('已隐藏端点');
      } else {
        toast.success('已取消隐藏');
      }
    } catch (err) {
      toast.error('操作失败', err instanceof Error ? err.message : String(err));
    }
  };

  const refreshAll = async () => {
    if (refreshingAll) {
      return;
    }
    setRefreshingAll(true);
    setRefreshAllTaskVisible(true);
    clearRefreshAllHideTimer();
    clearRefreshAllStream();
    setRefreshAllTaskState(null);

    try {
      const response = await fetch(withBasePath('/api/endpoints/refresh-tasks'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const body = (await response.json()) as {
        ok: boolean;
        message?: string;
        task?: RefreshAllTaskState;
      };
      if (!response.ok || !body.ok || !body.task) {
        throw new Error(body.message || '刷新全部失败');
      }

      const startedTask = body.task;
      setRefreshAllTaskState(startedTask);

      if (startedTask.status !== 'running') {
        if (startedTask.status === 'completed') {
          await reloadDashboardData();
          notifyRefreshAllCompleted(startedTask);
        } else {
          toast.error('刷新全部失败', startedTask.message || '刷新任务执行失败');
        }
        scheduleRefreshAllHide();
        setRefreshingAll(false);
        return;
      }

      const eventSource = new EventSource(
        withBasePath(`/api/endpoints/refresh-tasks/${encodeURIComponent(startedTask.id)}/events`),
      );
      refreshAllEventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as {
            ok: boolean;
            message?: string;
            task?: RefreshAllTaskState;
          };
          if (!payload.ok || !payload.task) {
            clearRefreshAllStream();
            setRefreshingAll(false);
            const failedTask: RefreshAllTaskState = {
              ...(refreshAllTaskRef.current ?? startedTask),
              status: 'failed',
              message: payload.message || '刷新进度流读取失败',
              currentEndpointName: null,
              finishedAt: new Date().toISOString(),
            };
            setRefreshAllTaskState(failedTask);
            toast.error('刷新全部失败', failedTask.message || '刷新进度流读取失败');
            scheduleRefreshAllHide();
            return;
          }

          const nextTask = payload.task;
          setRefreshAllTaskState(nextTask);

          if (nextTask.status === 'running') {
            return;
          }

          clearRefreshAllStream();
          setRefreshingAll(false);

          if (nextTask.status === 'completed') {
            void (async () => {
              try {
                await reloadDashboardData();
                notifyRefreshAllCompleted(nextTask);
              } catch (err) {
                toast.warning('刷新完成', err instanceof Error ? err.message : String(err));
              } finally {
                scheduleRefreshAllHide();
              }
            })();
            return;
          }

          toast.error('刷新全部失败', nextTask.message || '刷新任务执行失败');
          scheduleRefreshAllHide();
        } catch (err) {
          clearRefreshAllStream();
          setRefreshingAll(false);
          const failedTask: RefreshAllTaskState = {
            ...(refreshAllTaskRef.current ?? startedTask),
            status: 'failed',
            message: err instanceof Error ? err.message : String(err),
            currentEndpointName: null,
            finishedAt: new Date().toISOString(),
          };
          setRefreshAllTaskState(failedTask);
          toast.error('刷新全部失败', failedTask.message || '刷新进度流解析失败');
          scheduleRefreshAllHide();
        }
      };

      eventSource.onerror = () => {
        const currentTask = refreshAllTaskRef.current;
        if (!currentTask || currentTask.status !== 'running') {
          clearRefreshAllStream();
          return;
        }
        clearRefreshAllStream();
        setRefreshingAll(false);
        const failedTask: RefreshAllTaskState = {
          ...currentTask,
          status: 'failed',
          message: '刷新进度连接已中断，请重试',
          currentEndpointName: null,
          finishedAt: new Date().toISOString(),
        };
        setRefreshAllTaskState(failedTask);
        toast.error('刷新全部失败', failedTask.message || '刷新进度连接已中断');
        scheduleRefreshAllHide();
      };
    } catch (err) {
      clearRefreshAllStream();
      setRefreshAllTaskVisible(false);
      setRefreshAllTaskState(null);
      toast.error('刷新全部失败', err instanceof Error ? err.message : String(err));
      setRefreshingAll(false);
    }
  };

  const refreshOne = async (record: QuotaRecord) => {
    setRefreshingRows((current) => ({ ...current, [record.endpointId]: true }));

    try {
      const response = await fetch(withBasePath(`/api/endpoints/${record.endpointId}/refresh`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const body = (await response.json()) as {
        ok: boolean;
        message?: string;
        record?: QuotaRecord;
        vendors?: VendorOption[];
      };
      if (!response.ok || !body.ok || !body.record) {
        throw new Error(body.message || '刷新失败');
      }

      if (Array.isArray(body.vendors)) {
        setData((current) => ({
          ...current,
          meta: {
            ...current.meta,
            endpoints: body.vendors!,
          },
        }));
      }

      updateSingleRecord(body.record, record);
      setData((current) => { syncCookieAlerts(current.records); return current; });
      toast.success('刷新成功');
    } catch (err) {
      toast.error('刷新失败', err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshingRows((current) => ({ ...current, [record.endpointId]: false }));
    }
  };

  const refreshVendorEndpoints = async (vendorId: number) => {
    if (!Number.isInteger(vendorId) || vendorId <= 0) {
      return;
    }

    setRefreshingVendors((current) => ({ ...current, [vendorId]: true }));
    try {
      const response = await fetch(withBasePath('/api/endpoints'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh-by-vendor', vendorId }),
      });
      const body = (await response.json()) as QuotaApiResponse & { message?: string };
      if (!response.ok || !body.ok || !Array.isArray(body.records)) {
        throw new Error(body.message || '刷新服务商关联端点失败');
      }

      applyRefreshedRecords(body.records, body.meta, body.generatedAt);
      toast.success('刷新成功');
    } catch (err) {
      toast.error('刷新服务商关联端点失败', err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshingVendors((current) => ({ ...current, [vendorId]: false }));
    }
  };

  const checkinVendor = async (vendorId: number) => {
    if (!Number.isInteger(vendorId) || vendorId <= 0) {
      return;
    }

    setCheckingInVendors((current) => ({ ...current, [vendorId]: true }));
    try {
      const response = await fetch(withBasePath('/api/endpoints'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'vendor-checkin', vendorId }),
      });
      const body = (await response.json()) as QuotaApiResponse & {
        message?: string;
        endpointId?: number;
        checkin?: {
          status?: string;
          message?: string | null;
        };
      };
      if (!response.ok || !body.ok) {
        throw new Error(body.message || '服务商签到失败');
      }

      if (Array.isArray(body.records)) {
        applyRefreshedRecords(body.records, body.meta, body.generatedAt);
      }
      const nextDetailEndpointId = Number(body.endpointId);
      if (Number.isInteger(nextDetailEndpointId) && nextDetailEndpointId > 0) {
        vendorCheckinEndpointRef.current[vendorId] = nextDetailEndpointId;
      }
      if (detailDrawerOpen && detailViewMode === 'vendor') {
        const endpointIdForDetail =
          Number.isInteger(nextDetailEndpointId) && nextDetailEndpointId > 0
            ? nextDetailEndpointId
            : detailTargetRecord?.endpointId ?? null;
        if (endpointIdForDetail) {
          const nextTargetRecord = (Array.isArray(body.records) ? body.records : data.records).find(
            (record) => record.endpointId === endpointIdForDetail,
          ) ?? null;
          if (nextTargetRecord) {
            setDetailTargetRecord(nextTargetRecord);
          }
          void loadDetail(endpointIdForDetail);
        }
      }
      const checkinStatus = (body.checkin?.status || '').trim().toLowerCase();
      if (checkinStatus === 'ok') {
        toast.success('签到成功');
      } else {
        toast.warning('签到已触发', body.checkin?.message || '请求已发送，请在详情中查看提取结果');
      }
    } catch (err) {
      toast.error('服务商签到失败', err instanceof Error ? err.message : String(err));
    } finally {
      setCheckingInVendors((current) => ({ ...current, [vendorId]: false }));
    }
  };

  const loadDetail = async (endpointId: number) => {
    setDetailLoading(true);
    setDetailError(null);

    try {
      const response = await fetch(withBasePath(`/api/endpoints/${endpointId}/debug`), { cache: 'no-store' });
      const body = (await response.json()) as DebugResponse;
      if (!response.ok || !body.ok) {
        throw new Error(body.message || '读取详情失败');
      }
      setDetailData(body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setDetailError(message);
      toast.error('读取详情失败', message);
    } finally {
      setDetailLoading(false);
    }
  };

  const openDetailDrawer = (
    record: QuotaRecord,
    mode: DetailViewMode = 'endpoint',
    vendorContext: VendorDetailContext | null = null,
  ) => {
    setDetailTargetRecord(record);
    setDetailViewMode(mode);
    setDetailVendorContext(mode === 'vendor' ? vendorContext : null);
    setDetailDrawerOpen(true);
    // Use a small delay to ensure the DOM is rendered before starting the transition
    setTimeout(() => setIsDrawerActive(true), 10);
    setDetailData(null);
    void loadDetail(record.endpointId);
  };

  const closeDetailDrawer = () => {
    setIsDrawerActive(false);
    // Wait for the duration-500 transition to complete before unmounting
    setTimeout(() => {
      setDetailDrawerOpen(false);
      setDetailViewMode('endpoint');
      setDetailVendorContext(null);
      setDetailTargetRecord(null);
      setDetailData(null);
      setDetailError(null);
    }, 500);
  };

  const copyEndpointApiKey = async (record: QuotaRecord) => {
    const key = (record.endpointApiKey || '').trim();
    if (!key) {
      return;
    }

    try {
      await navigator.clipboard.writeText(key);
      setCopiedKeyEndpointId(record.endpointId);
      setTimeout(() => {
        setCopiedKeyEndpointId((current) => (current === record.endpointId ? null : current));
      }, 1200);
      toast.success('API Key 已复制');
    } catch {
      toast.error('复制 APIKey 失败', '请检查浏览器剪贴板权限');
    }
  };

  const selectedVendorOption = useMemo(() => {
    const vendorId = Number(vendorDraft);
    if (!Number.isInteger(vendorId) || vendorId <= 0) {
      return null;
    }
    return data.meta.endpoints.find((endpoint) => endpoint.id === vendorId) ?? null;
  }, [data.meta.endpoints, vendorDraft]);

  const groupedVendorOptions = useMemo(() => {
    const buckets = new Map<string, VendorOption[]>();
    for (const endpoint of data.meta.endpoints) {
      const key = (endpoint.vendorType || '').trim().toLowerCase() || UNTYPED_VENDOR_VALUE;
      if (!buckets.has(key)) {
        buckets.set(key, []);
      }
      buckets.get(key)!.push(endpoint);
    }

    const orderedTypeKeys: string[] = [];
    for (const vendorType of data.meta.vendorTypes) {
      const key = vendorType.trim().toLowerCase();
      if (!key || !buckets.has(key)) continue;
      if (!orderedTypeKeys.includes(key)) {
        orderedTypeKeys.push(key);
      }
    }
    for (const key of buckets.keys()) {
      if (!orderedTypeKeys.includes(key)) {
        orderedTypeKeys.push(key);
      }
    }

    return orderedTypeKeys.map((key) => ({
      key,
      label: vendorTypeLabel(key, vendorDefinitionLabelMap),
      endpoints: buckets.get(key) ?? [],
    }));
  }, [data.meta.endpoints, data.meta.vendorTypes, vendorDefinitionLabelMap]);

  const defaultVendorType = useMemo(
    () => resolveDefaultVendorType(data.meta.vendorTypes, data.meta.vendorDefinitions),
    [data.meta.vendorDefinitions, data.meta.vendorTypes],
  );

  const endpointConfigVendorType = useMemo(() => {
    if (selectedVendorOption?.vendorType) return selectedVendorOption.vendorType;
    if (editingRecord?.vendorType) return editingRecord.vendorType;
    return defaultVendorType;
  }, [defaultVendorType, editingRecord?.vendorType, selectedVendorOption?.vendorType]);
  const endpointTotalMode = useMemo<EndpointTotalMode>(() => {
    const key = (endpointConfigVendorType || '').trim().toLowerCase();
    return vendorEndpointTotalModeMap[key] ?? 'independent_request';
  }, [endpointConfigVendorType, vendorEndpointTotalModeMap]);

  const endpointRequiredEnvVars = useMemo(
    () => listRequiredEnvVars(vendorEnvVarMap, endpointConfigVendorType, 'endpoint', endpointTotalMode),
    [endpointConfigVendorType, endpointTotalMode, vendorEnvVarMap],
  );
  const endpointVisibleEnvVars = useMemo(
    () => (
      useVendorAmountDraft
        ? endpointRequiredEnvVars.filter((item) => !isTotalAmountEnvVar(item))
        : endpointRequiredEnvVars
    ),
    [endpointRequiredEnvVars, useVendorAmountDraft],
  );
  const endpointAggregation = useMemo<VendorAggregation>(() => {
    const key = (endpointConfigVendorType || '').trim().toLowerCase();
    return vendorAggregationMap[key] ?? {
      vendor_remaining: 'independent_request',
      vendor_used: 'endpoint_sum',
    };
  }, [endpointConfigVendorType, vendorAggregationMap]);
  const endpointSharedEnvVarMap = useMemo(() => {
    const parsedVendorId = Number(vendorDraft);
    const draftVendorId = Number.isInteger(parsedVendorId) && parsedVendorId > 0 ? parsedVendorId : null;
    const fallbackVendorId = editingRecord?.useVendorGroup && editingRecord.vendorId ? editingRecord.vendorId : null;
    const effectiveVendorId = draftVendorId ?? fallbackVendorId;
    return buildSharedEnvVarValueMap(effectiveVendorId, editingRecord?.endpointId ?? null);
  }, [data.meta.endpoints, data.records, editingRecord?.endpointId, editingRecord?.useVendorGroup, editingRecord?.vendorId, vendorDraft]);
  const selectedVendorMetrics = useMemo<{
    used: { value: number; stale: boolean } | null;
    remaining: { value: number; stale: boolean } | null;
  }>(() => {
    const vendorId = selectedVendorOption?.id ?? null;
    if (!vendorId) {
      return { used: null, remaining: null };
    }
    const records = data.records.filter((record) => record.vendorId === vendorId);
    if (records.length === 0) {
      return { used: null, remaining: null };
    }

    const used = endpointAggregation.vendor_used === 'endpoint_sum'
      ? (() => {
          const currentRecords = records.filter(
            (record) =>
              record.useVendorUsed &&
              record.result.status === 'ok' &&
              hasFiniteNumber(record.result.regionMetrics?.endpointUsedUsd ?? record.result.usedUsd),
          );
          if (currentRecords.length > 0) {
            const value = currentRecords.reduce(
              (sum, record) => sum + (record.result.regionMetrics?.endpointUsedUsd ?? record.result.usedUsd ?? 0),
              0,
            );
            return { value, stale: false as const };
          }
          const staleRecords = records.filter(
            (record) => record.useVendorUsed && hasFiniteNumber(record.result.staleLock?.usedUsd),
          );
          if (staleRecords.length > 0) {
            const value = staleRecords.reduce((sum, record) => sum + (record.result.staleLock?.usedUsd ?? 0), 0);
            return { value, stale: true as const };
          }
          return null;
        })()
      : (() => {
          const current = records
            .filter(
              (record) =>
                record.result.status === 'ok' &&
                hasFiniteNumber(record.result.regionMetrics?.vendorUsedUsd ?? record.result.usedUsd),
            )
            .sort((left, right) =>
              String(right.result.checkedAt || '').localeCompare(String(left.result.checkedAt || '')),
            )[0];
          if (current) {
            return {
              value: current.result.regionMetrics?.vendorUsedUsd ?? current.result.usedUsd ?? 0,
              stale: false as const,
            };
          }
          const stale = records
            .filter((record) => hasFiniteNumber(record.result.staleLock?.usedUsd))
            .sort((left, right) =>
              String(right.result.staleLock?.lockedAt || right.result.checkedAt || '')
                .localeCompare(String(left.result.staleLock?.lockedAt || left.result.checkedAt || '')),
            )[0];
          if (!stale) return null;
          return { value: stale.result.staleLock?.usedUsd ?? 0, stale: true as const };
        })();

    const remaining = endpointAggregation.vendor_remaining === 'endpoint_sum'
      ? (() => {
          const currentRecords = records.filter(
            (record) =>
              record.useVendorRemaining &&
              record.result.status === 'ok' &&
              hasFiniteNumber(record.result.regionMetrics?.endpointRemainingUsd ?? record.result.remainingUsd),
          );
          if (currentRecords.length > 0) {
            const value = currentRecords.reduce(
              (sum, record) => sum + (record.result.regionMetrics?.endpointRemainingUsd ?? record.result.remainingUsd ?? 0),
              0,
            );
            return { value, stale: false as const };
          }
          const staleRecords = records.filter(
            (record) => record.useVendorRemaining && hasFiniteNumber(record.result.staleLock?.remainingUsd),
          );
          if (staleRecords.length > 0) {
            const value = staleRecords.reduce(
              (sum, record) => sum + (record.result.staleLock?.remainingUsd ?? 0),
              0,
            );
            return { value, stale: true as const };
          }
          return null;
        })()
      : (() => {
          const current = records
            .filter(
              (record) =>
                record.result.status === 'ok' &&
                hasFiniteNumber(record.result.regionMetrics?.vendorRemainingUsd ?? record.result.remainingUsd),
            )
            .sort((left, right) =>
              String(right.result.checkedAt || '').localeCompare(String(left.result.checkedAt || '')),
            )[0];
          if (current) {
            return {
              value: current.result.regionMetrics?.vendorRemainingUsd ?? current.result.remainingUsd ?? 0,
              stale: false as const,
            };
          }
          const stale = records
            .filter((record) => hasFiniteNumber(record.result.staleLock?.remainingUsd))
            .sort((left, right) =>
              String(right.result.staleLock?.lockedAt || right.result.checkedAt || '')
                .localeCompare(String(left.result.staleLock?.lockedAt || left.result.checkedAt || '')),
            )[0];
          if (!stale) return null;
          return { value: stale.result.staleLock?.remainingUsd ?? 0, stale: true as const };
        })();

    return { used, remaining };
  }, [
    data.records,
    endpointAggregation.vendor_remaining,
    endpointAggregation.vendor_used,
    selectedVendorOption?.id,
  ]);
  const selectedVendorUsedText = selectedVendorMetrics.used && hasFiniteNumber(selectedVendorMetrics.used.value)
    ? `$${formatUsd(selectedVendorMetrics.used.value)}${selectedVendorMetrics.used.stale ? '（过时）' : ''}`
    : '-';
  const selectedVendorRemainingText = selectedVendorMetrics.remaining && hasFiniteNumber(selectedVendorMetrics.remaining.value)
    ? `$${formatUsd(selectedVendorMetrics.remaining.value)}${selectedVendorMetrics.remaining.stale ? '（过时）' : ''}`
    : '-';
  const selectedVendorTotalText =
    selectedVendorMetrics.used
    && selectedVendorMetrics.remaining
    && hasFiniteNumber(selectedVendorMetrics.used.value)
    && hasFiniteNumber(selectedVendorMetrics.remaining.value)
      ? `$${formatUsd(selectedVendorMetrics.used.value + selectedVendorMetrics.remaining.value)}`
      : '-';
  const shouldBlockVendorBalanceFollow = endpointAggregation.vendor_remaining === 'endpoint_sum';
  const hasVendorComputedTotal = (vendorId: number): boolean => {
    if (!Number.isInteger(vendorId) || vendorId <= 0) {
      return false;
    }
    const currentVendor = data.meta.endpoints.find((endpoint) => endpoint.id === vendorId) ?? null;
    if (!currentVendor) {
      return false;
    }
    const vendorTypeKey = (currentVendor.vendorType || '').trim().toLowerCase();
    const aggregation = vendorAggregationMap[vendorTypeKey] ?? {
      vendor_remaining: 'independent_request',
      vendor_used: 'endpoint_sum' as VendorAggregateMode,
    };
    const records = data.records.filter((record) => record.vendorId === vendorId);
    if (records.length === 0) {
      return false;
    }

    const used = aggregation.vendor_used === 'endpoint_sum'
      ? (() => {
          const currentRecords = records.filter(
            (record) =>
              record.useVendorUsed
              && record.result.status === 'ok'
              && hasFiniteNumber(record.result.regionMetrics?.endpointUsedUsd ?? record.result.usedUsd),
          );
          if (currentRecords.length > 0) {
            return currentRecords.reduce(
              (sum, record) => sum + (record.result.regionMetrics?.endpointUsedUsd ?? record.result.usedUsd ?? 0),
              0,
            );
          }
          const staleRecords = records.filter(
            (record) => record.useVendorUsed && hasFiniteNumber(record.result.staleLock?.usedUsd),
          );
          if (staleRecords.length > 0) {
            return staleRecords.reduce((sum, record) => sum + (record.result.staleLock?.usedUsd ?? 0), 0);
          }
          return null;
        })()
      : (() => {
          const current = records.find(
            (record) =>
              record.result.status === 'ok'
              && hasFiniteNumber(record.result.regionMetrics?.vendorUsedUsd ?? record.result.usedUsd),
          );
          if (current) {
            return current.result.regionMetrics?.vendorUsedUsd ?? current.result.usedUsd ?? null;
          }
          const stale = records.find((record) => hasFiniteNumber(record.result.staleLock?.usedUsd));
          return stale?.result.staleLock?.usedUsd ?? null;
        })();

    const remaining = aggregation.vendor_remaining === 'endpoint_sum'
      ? (() => {
          const currentRecords = records.filter(
            (record) =>
              record.useVendorRemaining
              && record.result.status === 'ok'
              && hasFiniteNumber(record.result.regionMetrics?.endpointRemainingUsd ?? record.result.remainingUsd),
          );
          if (currentRecords.length > 0) {
            return currentRecords.reduce(
              (sum, record) => sum + (record.result.regionMetrics?.endpointRemainingUsd ?? record.result.remainingUsd ?? 0),
              0,
            );
          }
          const staleRecords = records.filter(
            (record) => record.useVendorRemaining && hasFiniteNumber(record.result.staleLock?.remainingUsd),
          );
          if (staleRecords.length > 0) {
            return staleRecords.reduce((sum, record) => sum + (record.result.staleLock?.remainingUsd ?? 0), 0);
          }
          return null;
        })()
      : (() => {
          const current = records.find(
            (record) =>
              record.result.status === 'ok'
              && hasFiniteNumber(record.result.regionMetrics?.vendorRemainingUsd ?? record.result.remainingUsd),
          );
          if (current) {
            return current.result.regionMetrics?.vendorRemainingUsd ?? current.result.remainingUsd ?? null;
          }
          const stale = records.find((record) => hasFiniteNumber(record.result.staleLock?.remainingUsd));
          return stale?.result.staleLock?.remainingUsd ?? null;
        })();

    return hasFiniteNumber(used) && hasFiniteNumber(remaining);
  };

  const vendorRequiredEnvVars = useMemo(
    () => listRequiredEnvVars(vendorEnvVarMap, vendorTypeSettingDraft, 'vendor'),
    [vendorEnvVarMap, vendorTypeSettingDraft],
  );
  const vendorSharedEnvVarMap = useMemo(
    () => buildSharedEnvVarValueMap(editingVendorId, null),
    [data.meta.endpoints, data.records, editingVendorId],
  );
  const resolveSharedHintText = (
    key: string,
    currentValue: string | null | undefined,
    sharedMap: Map<string, SharedEnvVarEntry>,
  ): string | null => {
    const normalizedValue = normalizeEnvVarValue(currentValue);
    if (!normalizedValue) {
      return null;
    }
    const entry = sharedMap.get(key.trim().toLowerCase());
    if (!entry || entry.value !== normalizedValue) {
      return null;
    }
    return entry.source === 'vendor' ? '默认值来自服务商配置' : '默认值来自同服务商端点';
  };

  useEffect(() => {
    if (!shouldBlockVendorBalanceFollow || !useVendorBalanceDraft) {
      return;
    }
    setUseEndpointBalanceDraft(false);
  }, [shouldBlockVendorBalanceFollow, useVendorBalanceDraft]);

  

  const requireEndpointAmountReady = (): boolean => {

      if (vendorDraft === CREATE_VENDOR_VALUE) {

        toast.error('服务商总额不可用', '新服务商尚未完成配置，请先完成服务商创建。');

        return false;

      }

  

      if (!selectedVendorOption || vendorDraft === UNGROUPED_VENDOR_VALUE) {

        toast.error('服务商总额不可用', '当前未绑定可用端点，请先在“所属服务商”选择具体端点。');

        return false;

      }

  

      if (!selectedVendorOption || !hasVendorComputedTotal(selectedVendorOption.id)) {
        toast.error('服务商总额不可用', '该服务商缺少“已用”或“余额”数据，请先刷新相关端点。');

        return false;

      }

  

      return true;

  };

  

    const requireEndpointVendorReady = (): boolean => {

      if (vendorDraft === CREATE_VENDOR_VALUE) {

        toast.error('服务商不可用', '新服务商尚未完成配置，请先完成服务商创建。');

        return false;

      }



      if (!selectedVendorOption || vendorDraft === UNGROUPED_VENDOR_VALUE) {

        toast.error('服务商不可用', '当前未绑定可用端点，请先在"所属服务商"选择具体端点。');

        return false;

      }



      return true;

    };

  const openSettingsDialog = (record: QuotaRecord) => {
    const vendorTypeKey = (record.vendorType || '').trim().toLowerCase();
    const totalMode = vendorEndpointTotalModeMap[vendorTypeKey] ?? 'independent_request';
    const endpointKeys = listRequiredEnvVars(
      vendorEnvVarMap,
      vendorTypeKey,
      'endpoint',
      totalMode,
    ).map((item) => item.key);
    const mergedEndpointEnvVars = mergeSharedEnvVarDefaults(
      record.endpointEnvVars ?? {},
      endpointKeys,
      record.useVendorGroup && record.vendorId ? record.vendorId : null,
      record.endpointId,
    );

    setEditingRecord(record);
    setUseEndpointUsedDraft(record.useVendorUsed !== false);
    setUseVendorRemainingDraft(record.useVendorRemaining !== false);
    setUseEndpointAmountDraft(Boolean(record.useVendorAmount));
    setUseEndpointBalanceDraft(Boolean(record.useVendorBalance));
    setBillingModeDraft(normalizeBillingModeValue(record.billingMode));
    setEndpointEnvVarsDraft(mergedEndpointEnvVars);
    setVendorDraft(record.useVendorGroup && record.vendorId ? String(record.vendorId) : UNGROUPED_VENDOR_VALUE);
    setVendorCreateName('');
  };

  const closeSettingsDialog = () => {
    if (savingSetting) {
      return;
    }
    setEditingRecord(null);
    setEndpointEnvVarsDraft({});
    setVendorCreateName('');
  };

  const handleVendorSelection = (value: string) => {
    setVendorDraft(value);

    if (value === UNGROUPED_VENDOR_VALUE) {
      setUseEndpointUsedDraft(false);
      setUseVendorRemainingDraft(false);
      setUseEndpointAmountDraft(false);
      setUseEndpointBalanceDraft(false);
      setVendorCreateName('');
      return;
    }

    if (value !== CREATE_VENDOR_VALUE) {
      setVendorCreateName('');
    }

    if (value === CREATE_VENDOR_VALUE) {
      setCreatingNewVendor(true);
      setNewVendorNameDraft('');
      setEditingVendorId(-1);
      setEditingVendorName('');
      setVendorSettingLoading(false);
      setSavingVendorSetting(false);
      setVendorTypeSettingDraft(
        resolveDefaultVendorType(
          data.meta.vendorTypes,
          data.meta.vendorDefinitions,
          editingRecord?.vendorType || selectedVendorOption?.vendorType || endpointConfigVendorType,
        ),
      );
      setVendorEnvVarsDraft({});
      setVendorDraft('');
      return;
    }

    const vendorId = Number(value);
    if (!Number.isInteger(vendorId) || vendorId <= 0) {
      return;
    }

    const targetEndpoint = data.meta.endpoints.find((endpoint) => endpoint.id === vendorId) ?? null;
    if (!targetEndpoint) {
      return;
    }

    const targetVendorTypeKey = (targetEndpoint.vendorType || '').trim().toLowerCase();
    const targetTotalMode = vendorEndpointTotalModeMap[targetVendorTypeKey] ?? 'independent_request';
    const targetEndpointKeys = listRequiredEnvVars(
      vendorEnvVarMap,
      targetVendorTypeKey,
      'endpoint',
      targetTotalMode,
    ).map((item) => item.key);
    setEndpointEnvVarsDraft((current) =>
      mergeSharedEnvVarDefaults(
        current,
        targetEndpointKeys,
        vendorId,
        editingRecord?.endpointId ?? null,
      ));

    if (useVendorAmountDraft && !hasVendorComputedTotal(vendorId)) {
      setUseEndpointAmountDraft(false);
      toast.error('服务商总额不可用', '该服务商缺少“已用”或“余额”数据，已自动关闭“跟随服务商总额”。');
    }

    const targetAggregation = vendorAggregationMap[targetVendorTypeKey] ?? {
      vendor_remaining: 'independent_request',
      vendor_used: 'endpoint_sum' as VendorAggregateMode,
    };
    if (targetAggregation.vendor_remaining === 'endpoint_sum' && useVendorBalanceDraft) {
      setUseEndpointBalanceDraft(false);
      toast.warning(
        '已关闭跟随服务商余额',
        '当前类型的服务商余额按端点求和，端点不能再跟随服务商余额，已自动关闭以避免循环依赖。',
      );
    }
  };

  const openVendorSettings = async (vendorId: number) => {
    if (!Number.isInteger(vendorId) || vendorId <= 0) {
      return;
    }

    setVendorSettingLoading(true);
    setSavingVendorSetting(false);

    try {
      const response = await fetch(withBasePath(`/api/vendors/${vendorId}/settings`), { cache: 'no-store' });
      const body = (await response.json()) as VendorSettingsResponse;
      if (!response.ok || !body.ok || !body.vendor) {
        throw new Error(body.message || '读取服务商配置失败');
      }

      if (Array.isArray(body.vendors)) {
        setData((current) => ({
          ...current,
          meta: {
            ...current.meta,
            endpoints: body.vendors!,
          },
        }));
      }

      setEditingVendorId(body.vendor.id);
      setEditingVendorName(body.vendor.name);
      setVendorTypeSettingDraft(body.vendor.vendorType);
      const vendorKeys = listRequiredEnvVars(vendorEnvVarMap, body.vendor.vendorType, 'vendor').map((item) => item.key);
      setVendorEnvVarsDraft(
        mergeSharedEnvVarDefaults(
          body.vendor.envVars ?? {},
          vendorKeys,
          body.vendor.id,
          null,
        ),
      );
    } catch (err) {
      toast.error('读取服务商配置失败', err instanceof Error ? err.message : String(err));
    } finally {
      setVendorSettingLoading(false);
    }
  };

  const handleVendorTypeSettingChange = (value: string) => {
    const nextVendorType = (value || '').trim();
    setVendorTypeSettingDraft(nextVendorType);
    const vendorKeys = listRequiredEnvVars(vendorEnvVarMap, nextVendorType, 'vendor').map((item) => item.key);
    setVendorEnvVarsDraft((current) =>
      mergeSharedEnvVarDefaults(
        current,
        vendorKeys,
        editingVendorId,
        null,
      ));
  };

  const resetVendorSettingsDialog = () => {
    setEditingVendorId(null);
    setEditingVendorName('');
    setCreatingNewVendor(false);
    setNewVendorNameDraft('');
    setVendorSettingLoading(false);
    setVendorTypeSettingDraft(defaultVendorType);
    setVendorEnvVarsDraft({});
  };

  const closeVendorSettingsDialog = () => {
    if (savingVendorSetting) {
      return;
    }

    resetVendorSettingsDialog();
  };

  const saveVendorSettings = async () => {
    if (!editingVendorId) {
      return;
    }

    setVendorSettingError(null);
    setSavingVendorSetting(true);

    try {
      if (vendorRequiredEnvVars.length > 0) {
        const missing = findMissingRequiredEnvVars(vendorRequiredEnvVars, vendorEnvVarsDraft);
        if (missing.length > 0) {
          toast.error('请先填写必填环境变量', formatMissingEnvVarLabels(missing).join('、'));
          return;
        }
      }

      let vendorId = editingVendorId;

      // Create mode: first create the vendor
      if (creatingNewVendor) {
        const name = newVendorNameDraft.trim();
        if (!name) {
          throw new Error('请填写服务商名称');
        }
        const createRes = await fetch(withBasePath('/api/vendors'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, vendorType: vendorTypeSettingDraft }),
        });
        const createBody = (await createRes.json()) as VendorSettingsResponse;
        if (!createRes.ok || !createBody.ok || !createBody.vendor) {
          throw new Error(createBody.message || '创建服务商失败');
        }
        vendorId = createBody.vendor.id;
      }

      const response = await fetch(withBasePath(`/api/vendors/${vendorId}/settings`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendorType: vendorTypeSettingDraft,
          envVars: vendorEnvVarsDraft,
        }),
      });

      const body = (await response.json()) as VendorSettingsResponse;
      if (!response.ok || !body.ok || !body.vendor) {
        throw new Error(body.message || '保存服务商配置失败');
      }

      const nextEndpoints = Array.isArray(body.vendors) ? body.vendors : data.meta.endpoints;
      setData((current) => ({
        ...current,
        generatedAt: new Date().toISOString(),
        meta: {
          ...current.meta,
          endpoints: nextEndpoints,
        },
        records: current.records.map((record) => {
          if (record.vendorId !== body.vendor!.id) {
            return record;
          }
          return {
            ...record,
            vendorType: body.vendor!.vendorType,
          };
        }),
      }));

      setEditingVendorName(body.vendor.name);
      setVendorTypeSettingDraft(body.vendor.vendorType);
      setVendorEnvVarsDraft(body.vendor.envVars ?? {});

      const shouldSyncEndpointEnvVars =
        Boolean(editingRecord)
        && (
          creatingNewVendor
          || (Number(vendorDraft) === body.vendor.id)
          || (editingRecord?.vendorId === body.vendor.id)
        );
      if (shouldSyncEndpointEnvVars) {
        const vendorTypeKey = (body.vendor.vendorType || '').trim().toLowerCase();
        const targetTotalMode = vendorEndpointTotalModeMap[vendorTypeKey] ?? 'independent_request';
        const targetEndpointKeys = listRequiredEnvVars(
          vendorEnvVarMap,
          vendorTypeKey,
          'endpoint',
          targetTotalMode,
        ).map((item) => item.key);

        setEndpointEnvVarsDraft((current) => {
          const withVendorDefaults = mergeVendorEnvVarDefaults(
            current,
            targetEndpointKeys,
            body.vendor?.envVars ?? {},
          );
          return mergeSharedEnvVarDefaults(
            withVendorDefaults,
            targetEndpointKeys,
            body.vendor?.id ?? null,
            editingRecord?.endpointId ?? null,
          );
        });
      }

      if (editingRecord && editingRecord.vendorId === body.vendor.id) {
        setEditingRecord((current) => {
          if (!current) {
            return current;
          }
          return {
            ...current,
            vendorType: body.vendor!.vendorType,
          };
        });
      }

      resetVendorSettingsDialog();
      if (creatingNewVendor && body.vendor) {
        setVendorDraft(String(body.vendor.id));
      }
      void refreshVendorEndpoints(body.vendor!.id);
      toast.success(creatingNewVendor ? '服务商创建成功' : '服务商配置已保存');
    } catch (err) {
      setVendorSettingError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingVendorSetting(false);
    }
  };

  const saveSettings = async () => {
    if (!editingRecord) {
      return;
    }

    setSavingSetting(true);

    try {
      const ungroupedVendor = vendorDraft === UNGROUPED_VENDOR_VALUE || !vendorDraft;

      let vendorId: number | null = null;
      if (!ungroupedVendor) {
        const parsedVendorId = Number(vendorDraft);
        if (!Number.isInteger(parsedVendorId) || parsedVendorId <= 0) {
          throw new Error('所属服务商无效，请重新选择');
        }
        vendorId = parsedVendorId;
      }

      const useVendorGroup = !ungroupedVendor;
      const useVendorUsed = useVendorGroup ? useVendorUsedDraft : false;
      const useVendorRemaining = useVendorGroup ? useVendorRemainingDraft : false;
      const useVendorAmount = useVendorGroup ? useVendorAmountDraft : false;
      const useVendorBalance = useVendorGroup ? useVendorBalanceDraft : false;
      const nextEndpointEnvVars = endpointEnvVarsDraft;

      if (useVendorBalance && endpointAggregation.vendor_remaining === 'endpoint_sum') {
        throw new Error('当前类型的服务商余额来自端点求和，端点不能再跟随服务商余额，避免循环依赖。');
      }

      let endpointRequiredToValidate = endpointRequiredEnvVars;
      if (useVendorAmount) {
        endpointRequiredToValidate = endpointRequiredToValidate.filter((item) => !isTotalAmountEnvVar(item));
      }
      const missing = findMissingRequiredEnvVars(endpointRequiredToValidate, nextEndpointEnvVars);
      if (missing.length > 0) {
        toast.error('请先填写必填环境变量', formatMissingEnvVarLabels(missing).join('、'));
        return;
      }

      if (useVendorAmount && vendorId) {
        if (!hasVendorComputedTotal(vendorId)) {
          throw new Error('该服务商缺少“已用”或“余额”数据，请先刷新相关端点。');
        }
      }

      const response = await fetch(withBasePath('/api/endpoint-settings'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpointId: editingRecord.endpointId,
          vendorId,
          vendorName: null,
          useVendorGroup,
          useVendorUsed,
          useVendorRemaining,
          useVendorAmount,
          useVendorBalance,
          billingMode: billingModeDraft,
          envVars: nextEndpointEnvVars,
        }),
      });

      const body = (await response.json()) as {
        ok: boolean;
        message?: string;
        vendors?: VendorOption[];
        setting?: {
          vendorId: number | null;
          vendorName: string | null;
          vendorType: VendorType;
          billingMode: BillingMode;
          useVendorGroup: boolean;
          useVendorUsed: boolean;
          useVendorRemaining: boolean;
          useVendorAmount: boolean;
          useVendorBalance: boolean;
          envVars?: Record<string, string>;
        };
      };

      if (!response.ok || !body.ok || !body.setting) {
        throw new Error(body.message || '保存失败');
      }

      if (Array.isArray(body.vendors)) {
        setData((current) => ({
          ...current,
          meta: {
            ...current.meta,
            endpoints: body.vendors!,
          },
        }));
      }

      const nextRecord: QuotaRecord = {
        ...editingRecord,
        vendorId: body.setting.vendorId,
        vendorName: body.setting.vendorName,
        vendorType: body.setting.vendorType,
        billingMode: body.setting.billingMode,
        useVendorGroup: body.setting.useVendorGroup,
        useVendorUsed: body.setting.useVendorUsed,
        useVendorRemaining: body.setting.useVendorRemaining,
        useVendorAmount: body.setting.useVendorAmount,
        useVendorBalance: body.setting.useVendorBalance,
        endpointEnvVars: body.setting.envVars ?? nextEndpointEnvVars,
      };

      updateSingleRecord(nextRecord, editingRecord);
      setEditingRecord(null);
      setEndpointEnvVarsDraft({});
      setVendorCreateName('');
      void refreshOne(nextRecord);
      toast.success('供应商配置已保存');
    } catch (err) {
      toast.error('保存供应商配置失败', err instanceof Error ? err.message : String(err));
    } finally {
      setSavingSetting(false);
    }
  };

  return (
    <>
      <div className="mx-auto max-w-7xl space-y-8 px-4 py-10 md:px-6">
        <div className="relative flex flex-wrap items-center justify-between gap-6 overflow-hidden rounded-3xl border border-border/50 bg-card/40 p-8 shadow-md backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.02]">
          {/* Decorative background gradients */}
          <div className="absolute -left-20 -top-20 h-64 w-64 rounded-full bg-primary/5 blur-[100px]" />
          <div className="absolute -right-20 -bottom-20 h-64 w-64 rounded-full bg-blue-500/5 blur-[100px]" />

          <div className="relative z-10 space-y-2">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-sm border border-primary/20">
                <Activity className="h-6 w-6" />
              </div>
              <h1 className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">
                配额监控 <span className="text-primary">控制台</span>
              </h1>
            </div>
            <p className="max-w-2xl text-base text-muted-foreground">
              实时监控各API端点配额与使用情况，点击“刷新全部”可获取全部最新详情。
            </p>
          </div>

          <div className="relative z-10 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-2xl border border-border/80 bg-background/50 p-1.5 backdrop-blur-md shadow-sm">
              {data.records.some((r) => r.isHidden) && (
                <Button 
                  onClick={() => setShowHiddenList(true)} 
                  variant="ghost" 
                  size="sm"
                  className="rounded-xl h-9 px-4 text-muted-foreground hover:text-foreground hover:bg-muted"
                >
                  <EyeOff className="mr-2 h-4 w-4" />
                  隐藏列表
                </Button>
              )}
              <Button 
                onClick={refreshAll} 
                disabled={refreshingAll || savingSetting} 
                variant="default" 
                size="sm"
                className="rounded-xl h-9 px-5 shadow-lg shadow-primary/20"
              >
                {refreshingAll ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                刷新全部
              </Button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatedStatCard
            title="包月今日剩余"
            value={`$${formatUsd(summary.durationRemainingToday)}`}
            icon={Timer}
            glowClassName="bg-sky-500/10"
            iconWrapClassName="bg-sky-500/10 dark:bg-sky-500/15"
            iconClassName="text-sky-500"
            valueClassName="text-sky-600 dark:text-sky-400"
          />
          <AnimatedStatCard
            title="按量使用比例"
            value={`${summary.usageRatio.toFixed(1)}%`}
            icon={PieChart}
            glowClassName="bg-emerald-500/10"
            iconWrapClassName="bg-emerald-500/10 dark:bg-emerald-500/15"
            iconClassName="text-emerald-500"
            valueClassName="text-emerald-600 dark:text-emerald-400"
          />
          <AnimatedStatCard
            title="平均耗时"
            value={`${summary.avgLatency}ms`}
            icon={Activity}
            glowClassName="bg-amber-500/10"
            iconWrapClassName="bg-amber-500/10 dark:bg-amber-500/15"
            iconClassName="text-amber-500"
          />
        </div>

        <Card className="overflow-hidden border-border/40 shadow-md backdrop-blur-xl">
          <div className="border-b bg-muted/30 p-4 md:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 flex-1 overflow-x-auto scrollbar-hide items-center gap-2 lg:gap-3 pb-1 lg:pb-0">
                <div className="flex shrink-0 items-center gap-1 rounded-2xl border border-border/60 bg-background/60 p-1 shadow-sm">
                  {STATUS_FILTER_OPTIONS.map((status) => {
                    const active = statusFilter === status;
                    return (
                      <button
                        key={status}
                        type="button"
                        onClick={() => setStatusFilter(status)}
                        className={cn(
                          'inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-semibold transition-all duration-200',
                          active
                            ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/20'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                        )}
                      >
                        <span>{statusFilterLabel(status)}</span>
                        <span className={cn(
                          "font-mono text-[9px] px-1.5 py-0.5 rounded-full",
                          active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted-foreground/10 text-muted-foreground"
                        )}>
                          {statusCountMap[status] ?? 0}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex shrink-0 items-center gap-1 rounded-2xl border border-border/60 bg-background/60 p-1 shadow-sm">
                  {BILLING_FILTER_OPTIONS.map((mode) => {
                    const active = billingFilter === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setBillingFilter(mode)}
                        className={cn(
                          'inline-flex items-center whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-semibold transition-all duration-200',
                          active
                            ? 'bg-secondary text-secondary-foreground shadow-sm'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                        )}
                      >
                        {billingFilterLabel(mode)}
                      </button>
                    );
                  })}
                </div>

                <div className="flex shrink-0 items-center gap-1 rounded-2xl border border-border/60 bg-background/60 p-1 shadow-sm">
                  {API_KIND_FILTER_OPTIONS.map((kind) => {
                    const active = apiKindFilter === kind;
                    const tone = kind !== 'all' ? endpointApiKindTone(kind as EndpointApiKind) : null;
                    return (
                      <button
                        key={kind}
                        type="button"
                        onClick={() => setApiKindFilter(kind)}
                        className={cn(
                          'inline-flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-semibold transition-all duration-200',
                          active
                            ? 'bg-secondary text-secondary-foreground shadow-sm'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                        )}
                      >
                        {kind !== 'all' && (
                          <div className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-md", tone?.iconWrap)}>
                            {kind === 'claude_code' && <ClaudeGlyph />}
                            {kind === 'gemini' && <GeminiGlyph />}
                            {kind === 'codex' && <CodexGlyph />}
                          </div>
                        )}
                        <span>{apiKindFilterLabel(kind)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="relative w-full shrink-0 lg:w-80 xl:w-[360px]">
                <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-muted-foreground transition-colors group-focus-within:text-primary" />
                <input
                  type="text"
                  placeholder="搜索名称 / URL / 端点关键词..."
                  className="h-9 w-full rounded-2xl border border-border/80 bg-background/80 pl-10 pr-4 text-xs font-medium outline-none ring-primary/20 transition-all placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:bg-background shadow-sm"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="space-y-4 p-4">
            {groupedRecords.length === 0 ? (
              <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">未找到符合条件的端点</div>
            ) : (
              groupedRecords.map(([groupName, records]) => {
                const vendorTypes = groupName === '未分组'
                  ? []
                  : Array.from(
                      new Set(
                        records.map((record) =>
                          vendorTypeLabel(record.vendorType || UNTYPED_VENDOR_VALUE, vendorDefinitionLabelMap),
                        ),
                      ),
                    );
                const groupVendorId = records.find((record) => Number.isInteger(record.vendorId) && Number(record.vendorId) > 0)?.vendorId ?? null;
                const canConfigureEndpoint = groupName !== '未分组' && groupVendorId !== null;
                const groupVendorType = (records[0]?.vendorType || UNTYPED_VENDOR_VALUE).trim().toLowerCase();
                const groupAggregation: VendorAggregation =
                  vendorAggregationMap[groupVendorType] ?? {
                    vendor_remaining: 'independent_request',
                    vendor_used: 'endpoint_sum',
                  };

                const latestUsedRecord = records
                  .filter(
                    (record) =>
                      record.result.status === 'ok' &&
                      typeof (record.result.regionMetrics?.vendorUsedUsd ?? record.result.usedUsd) === 'number' &&
                      Number.isFinite(record.result.regionMetrics?.vendorUsedUsd ?? record.result.usedUsd),
                  )
                  .sort((left, right) =>
                    String(right.result.checkedAt || '').localeCompare(String(left.result.checkedAt || '')),
                  )[0] ?? null;
                const latestUsedStaleRecord = records
                  .filter((record) => hasFiniteNumber(record.result.staleLock?.usedUsd))
                  .sort((left, right) =>
                    String(right.result.staleLock?.lockedAt || right.result.checkedAt || '')
                      .localeCompare(String(left.result.staleLock?.lockedAt || left.result.checkedAt || '')),
                  )[0] ?? null;
                const endpointSumUsedRecords = records.filter(
                  (record) =>
                    record.useVendorUsed &&
                    record.result.status === 'ok' &&
                    typeof (record.result.regionMetrics?.endpointUsedUsd ?? record.result.usedUsd) === 'number' &&
                    Number.isFinite(record.result.regionMetrics?.endpointUsedUsd ?? record.result.usedUsd),
                );
                const endpointSumUsed = endpointSumUsedRecords.reduce(
                  (sum, record) => sum + (record.result.regionMetrics?.endpointUsedUsd ?? record.result.usedUsd ?? 0),
                  0,
                );
                const endpointSumUsedStaleRecords = records.filter(
                  (record) => record.useVendorUsed && hasFiniteNumber(record.result.staleLock?.usedUsd),
                );
                const endpointSumUsedStale = endpointSumUsedStaleRecords.reduce(
                  (sum, record) => sum + (record.result.staleLock?.usedUsd ?? 0),
                  0,
                );
                const groupUsedMetric = groupAggregation.vendor_used === 'endpoint_sum'
                  ? (
                      endpointSumUsedRecords.length > 0
                        ? { value: endpointSumUsed, stale: false }
                        : endpointSumUsedStaleRecords.length > 0
                          ? { value: endpointSumUsedStale, stale: true }
                          : null
                    )
                  : (
                      hasFiniteNumber(latestUsedRecord?.result.regionMetrics?.vendorUsedUsd ?? latestUsedRecord?.result.usedUsd)
                        ? {
                            value: latestUsedRecord!.result.regionMetrics?.vendorUsedUsd ?? latestUsedRecord!.result.usedUsd ?? 0,
                            stale: false,
                          }
                        : hasFiniteNumber(latestUsedStaleRecord?.result.staleLock?.usedUsd)
                          ? { value: latestUsedStaleRecord!.result.staleLock!.usedUsd ?? 0, stale: true }
                          : null
                    );

                const latestRemainingRecord = records
                  .filter(
                    (record) =>
                      record.result.status === 'ok' &&
                      typeof (record.result.regionMetrics?.vendorRemainingUsd ?? record.result.remainingUsd) === 'number' &&
                      Number.isFinite(record.result.regionMetrics?.vendorRemainingUsd ?? record.result.remainingUsd),
                  )
                  .sort((left, right) =>
                    String(right.result.checkedAt || '').localeCompare(String(left.result.checkedAt || '')),
                  )[0] ?? null;
                const latestRemainingStaleRecord = records
                  .filter((record) => hasFiniteNumber(record.result.staleLock?.remainingUsd))
                  .sort((left, right) =>
                    String(right.result.staleLock?.lockedAt || right.result.checkedAt || '')
                      .localeCompare(String(left.result.staleLock?.lockedAt || left.result.checkedAt || '')),
                  )[0] ?? null;
                const endpointSumRemainingRecords = records
                  .filter(
                    (record) =>
                      record.useVendorRemaining &&
                      record.result.status === 'ok' &&
                      typeof (record.result.regionMetrics?.endpointRemainingUsd ?? record.result.remainingUsd) === 'number' &&
                      Number.isFinite(record.result.regionMetrics?.endpointRemainingUsd ?? record.result.remainingUsd),
                  )
                  .sort((left, right) =>
                    String(right.result.checkedAt || '').localeCompare(String(left.result.checkedAt || '')),
                  );
                const endpointSumRemaining = endpointSumRemainingRecords.reduce(
                  (sum, record) => sum + (record.result.regionMetrics?.endpointRemainingUsd ?? record.result.remainingUsd ?? 0),
                  0,
                );
                const endpointSumRemainingStaleRecords = records.filter(
                  (record) => record.useVendorRemaining && hasFiniteNumber(record.result.staleLock?.remainingUsd),
                );
                const endpointSumRemainingStale = endpointSumRemainingStaleRecords.reduce(
                  (sum, record) => sum + (record.result.staleLock?.remainingUsd ?? 0),
                  0,
                );
                const endpointSumRemainingCheckedAt = endpointSumRemainingRecords[0]?.result.checkedAt ?? null;

                const groupBalanceMetric = groupAggregation.vendor_remaining === 'endpoint_sum'
                  ? (
                      endpointSumRemainingRecords.length > 0
                        ? { value: endpointSumRemaining, stale: false }
                        : endpointSumRemainingStaleRecords.length > 0
                          ? { value: endpointSumRemainingStale, stale: true }
                          : null
                    )
                  : (
                      hasFiniteNumber(latestRemainingRecord?.result.regionMetrics?.vendorRemainingUsd ?? latestRemainingRecord?.result.remainingUsd)
                        ? {
                            value: latestRemainingRecord!.result.regionMetrics?.vendorRemainingUsd ?? latestRemainingRecord!.result.remainingUsd ?? 0,
                            stale: false,
                          }
                        : hasFiniteNumber(latestRemainingStaleRecord?.result.staleLock?.remainingUsd)
                          ? { value: latestRemainingStaleRecord!.result.staleLock!.remainingUsd ?? 0, stale: true }
                          : null
                    );
                const groupEndpointBalanceCheckedAt = groupAggregation.vendor_remaining === 'endpoint_sum'
                  ? endpointSumRemainingCheckedAt
                  : (latestRemainingRecord?.result.checkedAt ?? null);
                const groupEndpointBalanceStrategy = groupAggregation.vendor_remaining === 'endpoint_sum'
                  ? null
                  : latestRemainingRecord?.result.strategy ?? null;
                const vendorDetailRecord =
                  latestRemainingRecord
                  ?? latestUsedRecord
                  ?? latestRemainingStaleRecord
                  ?? latestUsedStaleRecord
                  ?? records[0]
                  ?? null;
                const canViewVendorDetail = groupName !== '未分组' && vendorDetailRecord !== null;
                const isRefreshingVendor = groupVendorId !== null ? Boolean(refreshingVendors[groupVendorId]) : false;
                const isCheckingInVendor = groupVendorId !== null ? Boolean(checkingInVendors[groupVendorId]) : false;
                const dailyCheckinEnabled = Boolean(vendorDailyCheckinEnabledMap[groupVendorType]);
                const isGroupCollapsed = collapseStateReady ? Boolean(collapsedGroups[groupName]) : true;

                return (
                  <div key={groupName} className="overflow-hidden rounded-2xl border border-border/40 bg-background shadow-sm transition-all hover:shadow-md">
                    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/40 bg-muted/20 px-4 py-4 md:px-6">
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
                        <button
                          type="button"
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-background text-muted-foreground shadow-sm transition-all hover:bg-muted hover:text-foreground active:scale-95"
                          onClick={() => toggleGroupCollapsed(groupName)}
                          title={isGroupCollapsed ? '展开分组' : '折叠分组'}
                        >
                          {isGroupCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                        <div className="text-lg font-bold tracking-tight text-foreground">{groupName}</div>
                        <div className="flex flex-wrap gap-1.5">
                          {vendorTypes.map((type) => (
                            <span
                              key={`${groupName}-${type}`}
                              className="inline-flex h-6 items-center rounded-md border border-indigo-200 bg-indigo-50 px-2.5 text-[11px] font-bold uppercase tracking-wider text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300 shadow-sm"
                            >
                              {type}
                            </span>
                          ))}
                          <span className="inline-flex h-6 items-center rounded-md border border-border/60 bg-background/50 px-2.5 text-[11px] font-bold text-muted-foreground shadow-sm">
                            {records.length} 个端点
                          </span>
                        </div>
                        {groupEndpointBalanceCheckedAt ? (
                          <div className="flex items-center gap-1.5 rounded-md bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground border border-border/40">
                            <Clock className="h-3 w-3" />
                            最后更新：{formatDateTime(groupEndpointBalanceCheckedAt)}
                          </div>
                        ) : null}
                      </div>

                      <div className="flex w-full flex-wrap items-center gap-3 md:w-auto">
                        <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/80 px-4 py-2 shadow-sm backdrop-blur-sm">
                          <div className="flex flex-col">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">余额</span>
                            <div className="flex items-center gap-1">
                              {groupBalanceMetric && hasFiniteNumber(groupBalanceMetric.value) ? (
                                <span
                                  className={cn(
                                    'font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400',
                                    groupBalanceMetric.stale ? 'line-through decoration-2 opacity-80' : '',
                                  )}
                                >
                                  ${formatUsd(groupBalanceMetric.value)}
                                </span>
                              ) : (
                                <span className="font-mono text-sm font-bold text-muted-foreground">$-</span>
                              )}
                            </div>
                          </div>
                          <div className="h-6 w-px bg-border/60" />
                          <div className="flex flex-col">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">已用</span>
                            <div className="flex items-center gap-1">
                              {groupUsedMetric && hasFiniteNumber(groupUsedMetric.value) ? (
                                <span
                                  className={cn(
                                    'font-mono text-sm font-bold text-red-600 dark:text-red-400',
                                    groupUsedMetric.stale ? 'line-through decoration-2 opacity-80' : '',
                                  )}
                                >
                                  ${formatUsd(groupUsedMetric.value)}
                                </span>
                              ) : (
                                <span className="font-mono text-sm font-bold text-muted-foreground">$-</span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 rounded-xl border border-border/60 bg-background/50 p-1 shadow-sm">
                          {dailyCheckinEnabled ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 rounded-lg px-2.5 text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-400"
                              disabled={!canConfigureEndpoint || isCheckingInVendor}
                              onClick={() => {
                                if (groupVendorId !== null) {
                                  void checkinVendor(groupVendorId);
                                }
                              }}
                            >
                              {isCheckingInVendor ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <CircleCheckBig className="h-4 w-4" />
                              )}
                              <span className="ml-1.5 font-bold">签到</span>
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 rounded-lg px-2.5 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                            disabled={!canConfigureEndpoint || isRefreshingVendor}
                            onClick={() => {
                              if (groupVendorId !== null) {
                                void refreshVendorEndpoints(groupVendorId);
                              }
                            }}
                          >
                            {isRefreshingVendor ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="h-4 w-4" />
                            )}
                            <span className="ml-1.5 font-bold">刷新</span>
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 rounded-lg px-2.5 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                            disabled={!canConfigureEndpoint}
                            onClick={() => {
                              if (groupVendorId !== null) {
                                void openVendorSettings(groupVendorId);
                              }
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                            <span className="ml-1.5 font-bold">配置</span>
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 rounded-lg px-2.5 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                            disabled={!canViewVendorDetail}
                            onClick={() => {
                              if (!vendorDetailRecord) {
                                return;
                              }
                              const checkinEpId = groupVendorId !== null
                                ? vendorCheckinEndpointRef.current[groupVendorId]
                                : undefined;
                              const preferredRecord = checkinEpId
                                ? (records.find((r) => r.endpointId === checkinEpId) ?? vendorDetailRecord)
                                : vendorDetailRecord;
                              openDetailDrawer(preferredRecord, 'vendor', {
                                vendorName: groupName,
                                usedMode: groupAggregation.vendor_used,
                                remainingMode: groupAggregation.vendor_remaining,
                                usedValue: groupUsedMetric && hasFiniteNumber(groupUsedMetric.value) ? groupUsedMetric.value : null,
                                usedStale: Boolean(groupUsedMetric?.stale),
                                remainingValue: groupBalanceMetric && hasFiniteNumber(groupBalanceMetric.value) ? groupBalanceMetric.value : null,
                                remainingStale: Boolean(groupBalanceMetric?.stale),
                              });
                            }}
                          >
                            <Search className="h-4 w-4" />
                            <span className="ml-1.5 font-bold">详情</span>
                          </Button>
                        </div>
                      </div>
                    </div>

                    {!isGroupCollapsed && <div className="space-y-3 p-4 md:p-6">
                      {records.map((record) => {
                        const endpointAmountUnavailable =
                          record.useVendorAmount && record.vendorId !== null && record.vendorTotalUsd === null;
                        const showActiveAmounts = !endpointAmountUnavailable;
                        const remainingMetric = resolveUsdMetricDisplay(record.result, 'remainingUsd');
                        const usedMetric = resolveUsdMetricDisplay(record.result, 'usedUsd');
                        const totalMetric = resolveUsdMetricDisplay(record.result, 'totalUsd');

                        return (
                          <div
                            key={record.endpointId}
                            className="group relative rounded-xl border border-border/60 bg-background/50 p-4 transition-all duration-300 hover:border-primary/40 hover:bg-background hover:shadow-lg dark:hover:bg-white/[0.02]"
                          >
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                              <div className="flex min-w-0 flex-1 flex-col gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <EndpointApiKindBadge record={record} vendorApiKindMap={vendorApiKindMap} />
                                  <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-2 py-1">
                                    <EndpointEnabledBadge enabled={record.isEnabled} />
                                    <span className="text-sm font-bold text-foreground truncate max-w-[200px]" title={record.endpointName}>
                                      {record.endpointName}
                                    </span>
                                  </div>
                                  <BillingModeBadge mode={record.billingMode} />
                                  <StatusBadge status={record.result.status} />
                                </div>
                                
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                  <div className="flex items-center gap-1.5 font-mono opacity-70 hover:opacity-100 transition-opacity max-w-[300px] truncate" title={record.endpointUrl}>
                                    <span className="truncate">{record.endpointUrl}</span>
                                    {record.endpointConsoleUrl ? (
                                      <a
                                        href={record.endpointConsoleUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-sky-600 transition-colors hover:bg-sky-50 dark:hover:bg-sky-500/10"
                                      >
                                        <ExternalLink className="h-3 w-3" />
                                      </a>
                                    ) : null}
                                  </div>
                                  <div className="h-3 w-px bg-border/60" />
                                  <button
                                    type="button"
                                    className="flex items-center gap-1.5 font-mono text-muted-foreground hover:text-foreground transition-colors"
                                    onClick={() => void copyEndpointApiKey(record)}
                                  >
                                    <KeyRound className="h-3 w-3" />
                                    <span>{maskApiKey(record.endpointApiKey)}</span>
                                    {copiedKeyEndpointId === record.endpointId ? (
                                      <Check className="h-3 w-3 text-emerald-500" />
                                    ) : (
                                      <Copy className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                                    )}
                                  </button>
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-3">
                                <div className="flex items-center gap-1.5 rounded-xl border border-border/60 bg-muted/20 p-1 shadow-sm opacity-60 group-hover:opacity-100 transition-opacity">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => refreshOne(record)}
                                    disabled={Boolean(refreshingRows[record.endpointId])}
                                    className="h-8 rounded-lg px-2.5 font-bold text-muted-foreground hover:bg-primary/10 hover:text-primary"
                                  >
                                    {refreshingRows[record.endpointId] ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <RefreshCw className="h-4 w-4" />
                                    )}
                                    <span className="ml-1.5">刷新</span>
                                  </Button>

                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => openSettingsDialog(record)}
                                    className="h-8 rounded-lg px-2.5 font-bold text-muted-foreground hover:bg-primary/10 hover:text-primary"
                                  >
                                    <Pencil className="h-4 w-4" />
                                    <span className="ml-1.5">配置</span>
                                  </Button>

                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => openDetailDrawer(record)}
                                    className="h-8 rounded-lg px-2.5 font-bold text-muted-foreground hover:bg-primary/10 hover:text-primary"
                                  >
                                    <Search className="h-4 w-4" />
                                    <span className="ml-1.5">详情</span>
                                  </Button>
                                </div>
                              </div>
                            </div>

                            <div className="mt-4 grid grid-cols-1 items-center gap-4 rounded-xl border border-border/40 bg-muted/20 px-4 py-3 shadow-inner lg:grid-cols-3">
                              {/* Left: Financial Metrics */}
                              <div className="flex items-center justify-center gap-6 lg:justify-start">
                                {showActiveAmounts ? (
                                  <>
                                    <div className="flex flex-col justify-center">
                                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">余额</span>
                                      <MetricItem
                                        value={hasFiniteNumber(remainingMetric.value) ? `$${formatUsd(remainingMetric.value)}` : '$-'}
                                        tone={hasFiniteNumber(remainingMetric.value) ? 'text-sm font-bold text-emerald-600 dark:text-emerald-400' : 'text-sm font-bold text-muted-foreground'}
                                        stale={remainingMetric.stale}
                                      />
                                    </div>
                                    <div className="flex flex-col justify-center">
                                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">已用</span>
                                      <MetricItem
                                        value={hasFiniteNumber(usedMetric.value) ? `$${formatUsd(usedMetric.value)}` : '$-'}
                                        tone={hasFiniteNumber(usedMetric.value) ? 'text-sm font-bold text-red-600 dark:text-red-400' : 'text-sm font-bold text-muted-foreground'}
                                        stale={usedMetric.stale}
                                      />
                                    </div>
                                    <div className="flex flex-col justify-center">
                                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">总额</span>
                                      <MetricItem
                                        value={hasFiniteNumber(totalMetric.value) ? `$${formatUsd(totalMetric.value)}` : '$-'}
                                        tone="text-sm font-bold text-foreground/70"
                                        stale={totalMetric.stale}
                                      />
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <div className="flex flex-col justify-center">
                                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">余额</span>
                                      <MetricItem value="$-" tone="text-sm font-bold text-muted-foreground" />
                                    </div>
                                    <div className="flex flex-col justify-center">
                                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">已用</span>
                                      <MetricItem
                                        value={hasFiniteNumber(usedMetric.value) ? `$${formatUsd(usedMetric.value)}` : '$-'}
                                        tone={hasFiniteNumber(usedMetric.value) ? 'text-sm font-bold text-red-600 dark:text-red-400' : 'text-sm font-bold text-muted-foreground'}
                                        stale={usedMetric.stale}
                                      />
                                    </div>
                                    <div className="flex flex-col justify-center">
                                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">总额</span>
                                      <MetricItem value="$-" tone="text-sm font-bold text-muted-foreground" />
                                    </div>
                                  </>
                                )}
                              </div>

                              {/* Center: Token and Reset Info */}
                              <div className="flex items-center justify-center gap-3">
                                <TokenProgressBar tokenUsed={record.result.tokenUsed} tokenAvailable={record.result.tokenAvailable} />
                                {record.result.lastCreditReset && (
                                  <div className="flex h-8 min-w-[220px] items-center justify-center gap-1.5 rounded-xl border border-red-500/20 bg-red-500/10 px-3 text-[10px] font-bold uppercase tracking-wider text-red-500">
                                    <Clock className="h-3.5 w-3.5" />
                                    <span className="truncate">上次重置：{record.result.lastCreditReset}</span>
                                  </div>
                                )}
                              </div>
                              
                              {/* Right: Latency and Updated At */}
                              <div className="flex items-center justify-center gap-3 text-[11px] font-medium text-muted-foreground/80 lg:justify-end">
                                <span className={cn('rounded-md border border-border/40 bg-background/50 px-2 py-1 font-mono font-bold', latencyToneClass(record.result.latencyMs))}>
                                  {record.result.latencyMs !== null ? `${record.result.latencyMs}ms` : '-'}
                                </span>
                                <span className="opacity-70">{formatDateTime(record.result.checkedAt)}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>}
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </div>

      {editingRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm transition-all duration-300">
          <div
            className="w-full max-w-3xl overflow-hidden rounded-3xl border border-border/40 bg-background shadow-2xl animate-in fade-in zoom-in-95 duration-200"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border/40 px-6 py-5 bg-muted/20">
              <div className="space-y-1">
                <div className="text-xl font-bold tracking-tight text-foreground">端点配置</div>
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">#{editingRecord.endpointId}</span>
                  <span className="truncate">{editingRecord.endpointName}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
                  title="隐藏此端点"
                  onClick={() => toggleHidden(editingRecord.endpointId, true)}
                  disabled={savingSetting}
                >
                  <EyeOff className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
                  onClick={closeSettingsDialog}
                  disabled={savingSetting}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="max-h-[70vh] space-y-6 overflow-y-auto p-6 scrollbar-hide">
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-foreground/80">所属服务商</label>
                  <Select value={vendorDraft} onValueChange={handleVendorSelection} disabled={savingSetting}>
                    <SelectTrigger className="h-10 data-[size=default]:h-10 rounded-xl border-border/60 bg-muted/20 focus:ring-primary/20 w-full">
                      <SelectValue placeholder="请选择所属服务商" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-border/40 shadow-xl">
                      <SelectItem value={UNGROUPED_VENDOR_VALUE}>未分组（不跟随服务商）</SelectItem>
                      <SelectSeparator />
                      {groupedVendorOptions.map((group) => (
                        <SelectGroup key={group.key}>
                          <SelectLabel className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            {group.label}
                          </SelectLabel>
                          {group.endpoints.map((endpoint) => (
                            <SelectItem key={endpoint.id} value={String(endpoint.id)} className="rounded-lg">
                              {endpoint.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                      <SelectSeparator />
                      <SelectItem value={CREATE_VENDOR_VALUE} className="font-bold text-primary">+ 新建服务商...</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-foreground/80">计费模式</label>
                  <Select
                    value={billingModeDraft}
                    onValueChange={(value) => setBillingModeDraft((value as BillingMode) || 'usage')}
                    disabled={savingSetting}
                  >
                    <SelectTrigger className="h-10 data-[size=default]:h-10 rounded-xl border-border/60 bg-muted/20 focus:ring-primary/20 w-full">
                      <SelectValue placeholder="按量" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-border/40 shadow-xl">
                      <SelectItem value="usage">按量计费</SelectItem>
                      <SelectItem value="duration">时长计费</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="group rounded-2xl border border-border/40 bg-muted/10 p-4 transition-all hover:bg-muted/20">
                  <div className="flex items-center justify-between">
                    <label
                      className="text-sm font-bold text-foreground/80 cursor-pointer"
                      onClick={() =>
                        !savingSetting &&
                        endpointAggregation.vendor_used === 'endpoint_sum' &&
                        vendorDraft !== UNGROUPED_VENDOR_VALUE &&
                        setUseEndpointUsedDraft(!useVendorUsedDraft)
                      }
                    >
                      参与服务商已用求和
                    </label>
                    <Switch
                      checked={useVendorUsedDraft}
                      onCheckedChange={setUseEndpointUsedDraft}
                      disabled={
                        savingSetting ||
                        vendorDraft === UNGROUPED_VENDOR_VALUE ||
                        endpointAggregation.vendor_used !== 'endpoint_sum'
                      }
                    />
                  </div>
                  <div className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {endpointAggregation.vendor_used === 'endpoint_sum'
                      ? `服务商已用：${selectedVendorUsedText}。关闭后该端点的已用数据不会计入服务商汇总。`
                      : `服务商已用：${selectedVendorUsedText}。当前为“独立请求”模式，该开关无实际作用。`}
                  </div>
                </div>

                <div className="group rounded-2xl border border-border/40 bg-muted/10 p-4 transition-all hover:bg-muted/20">
                  <div className="flex items-center justify-between">
                    <label
                      className="text-sm font-bold text-foreground/80 cursor-pointer"
                      onClick={() =>
                        !savingSetting &&
                        endpointAggregation.vendor_remaining === 'endpoint_sum' &&
                        vendorDraft !== UNGROUPED_VENDOR_VALUE &&
                        setUseVendorRemainingDraft(!useVendorRemainingDraft)
                      }
                    >
                      参与服务商余额求和
                    </label>
                    <Switch
                      checked={useVendorRemainingDraft}
                      onCheckedChange={setUseVendorRemainingDraft}
                      disabled={
                        savingSetting ||
                        vendorDraft === UNGROUPED_VENDOR_VALUE ||
                        endpointAggregation.vendor_remaining !== 'endpoint_sum'
                      }
                    />
                  </div>
                  <div className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {endpointAggregation.vendor_remaining === 'endpoint_sum'
                      ? `服务商余额：${selectedVendorRemainingText}。关闭后该端点的余额数据不会计入服务商汇总。`
                      : `服务商余额：${selectedVendorRemainingText}。当前为“独立请求”模式，该开关无实际作用。`}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="group rounded-2xl border border-border/40 bg-muted/10 p-4 transition-all hover:bg-muted/20">
                  <div className="flex items-center justify-between">
                    <label
                      className="text-sm font-bold text-foreground/80 cursor-pointer"
                      onClick={() => {
                        if (savingSetting) return;
                        if (shouldBlockVendorBalanceFollow) return;
                        const next = !useVendorBalanceDraft;
                        if (next && !requireEndpointVendorReady()) {
                          return;
                        }
                        setUseEndpointBalanceDraft(next);
                      }}
                    >
                      跟随服务商余额
                    </label>
                    <Switch
                      checked={useVendorBalanceDraft}
                      onCheckedChange={(checked) => {
                        if (shouldBlockVendorBalanceFollow) {
                          return;
                        }
                        if (checked && !requireEndpointVendorReady()) {
                          return;
                        }
                        setUseEndpointBalanceDraft(checked);
                      }}
                      disabled={savingSetting || shouldBlockVendorBalanceFollow}
                    />
                  </div>
                  {shouldBlockVendorBalanceFollow ? (
                    <div className="mt-2 text-xs font-medium text-amber-600 dark:text-amber-400">
                      该类型余额为“端点求和”模式，不可跟随服务商余额，以避免循环依赖。
                    </div>
                  ) : selectedVendorOption ? (
                    <div className="mt-2 text-xs text-muted-foreground">
                      当前服务商余额：{selectedVendorRemainingText}
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-muted-foreground">
                      开启后端点余额将跟随服务商余额。
                    </div>
                  )}
                </div>

                <div className="group rounded-2xl border border-border/40 bg-muted/10 p-4 transition-all hover:bg-muted/20">
                  <div className="flex items-center justify-between">
                    <label
                      className="text-sm font-bold text-foreground/80 cursor-pointer"
                      onClick={() => {
                        if (savingSetting) return;
                        const next = !useVendorAmountDraft;
                        if (next && !requireEndpointAmountReady()) {
                          return;
                        }
                        setUseEndpointAmountDraft(next);
                      }}
                    >
                      跟随服务商总额
                    </label>
                    <Switch
                      checked={useVendorAmountDraft}
                      onCheckedChange={(checked) => {
                        if (checked && !requireEndpointAmountReady()) {
                          return;
                        }
                        setUseEndpointAmountDraft(checked);
                      }}
                      disabled={savingSetting}
                    />
                  </div>
                  {selectedVendorOption ? (
                    <div className="mt-2 text-xs text-muted-foreground">
                      当前服务商总额：{selectedVendorTotalText}
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-muted-foreground">
                      开启后将自动使用“服务商已用 + 服务商余额”作为总额。
                    </div>
                  )}
                </div>
              </div>

              {endpointVisibleEnvVars.length > 0 && (
                <div className="space-y-4 rounded-2xl border border-border/40 bg-muted/5 p-5">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-1 rounded-full bg-primary" />
                    <div className="text-sm font-bold text-foreground/80 uppercase tracking-widest">端点环境变量</div>
                  </div>
                  <div className="grid gap-5">
                    {endpointVisibleEnvVars.map((item) => (
                      <div key={item.key} className="space-y-1">
                        {(() => {
                          const sharedHint = resolveSharedHintText(
                            item.key,
                            endpointEnvVarsDraft[item.key] ?? '',
                            endpointSharedEnvVarMap,
                          );
                          return (
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              <span className="text-xs font-bold text-foreground">{item.label}</span>
                              <span className="font-mono text-[10px] text-muted-foreground opacity-70">({item.key})</span>
                              <span className={cn(
                                "rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider shadow-sm",
                                item.optional ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400' : 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400'
                              )}>
                                {item.optional ? '选填' : '必填'}
                              </span>
                              {sharedHint ? (
                                <span className="rounded-md bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-sky-700 dark:bg-sky-500/20 dark:text-sky-400 shadow-sm animate-in fade-in zoom-in-95">
                                  {sharedHint}
                                </span>
                              ) : null}
                            </div>
                          );
                        })()}
                        <textarea
                          rows={1}
                          value={endpointEnvVarsDraft[item.key] ?? ''}
                          onChange={(event) =>
                            setEndpointEnvVarsDraft((current) => ({
                              ...current,
                              [item.key]: event.target.value,
                            }))
                          }
                          onInput={(event) => autoResizeTextarea(event.currentTarget)}
                          ref={(node) => autoResizeTextarea(node)}
                          className="min-h-[40px] w-full resize-none overflow-hidden rounded-xl border border-border/60 bg-background px-4 py-2.5 text-sm font-medium outline-none transition-all focus:border-primary focus:ring-4 focus:ring-primary/10"
                          disabled={savingSetting}
                          placeholder={`请输入 ${item.label}...`}
                        />
                        {item.meaning ? (
                          <span className="text-[11px] text-muted-foreground">{item.meaning}</span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-border/40 bg-muted/20 px-6 py-5">
              <Button 
                variant="outline" 
                onClick={closeSettingsDialog} 
                disabled={savingSetting}
                className="rounded-xl h-10 px-6 font-bold"
              >
                取消
              </Button>
              <Button 
                onClick={saveSettings}
                disabled={savingSetting}
                className="rounded-xl h-10 px-8 font-bold shadow-lg shadow-primary/20"
              >
                {savingSetting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    正在保存...
                  </>
                ) : '确认保存'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {editingVendorId !== null && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm transition-all duration-300">
          <div
            className="w-full max-w-2xl overflow-hidden rounded-3xl border border-border/40 bg-background shadow-2xl animate-in fade-in zoom-in-95 duration-200"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border/40 px-6 py-5 bg-muted/20">
              <div className="space-y-1">
                <div className="text-xl font-bold tracking-tight text-foreground">
                  {creatingNewVendor ? '新建服务商' : '服务商配置'}
                </div>
                {!creatingNewVendor && (
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">#{editingVendorId}</span>
                    <span className="truncate">{editingVendorName || '-'}</span>
                  </div>
                )}
              </div>
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
                onClick={closeVendorSettingsDialog}
                disabled={savingVendorSetting}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[70vh] space-y-6 overflow-y-auto p-6 scrollbar-hide">
              {vendorSettingLoading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-4">
                  <div className="relative">
                    <div className="h-10 w-10 rounded-full border-4 border-primary/20" />
                    <div className="absolute top-0 h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">正在获取最新配置...</p>
                </div>
              ) : (
                <>
	                  <div className="grid gap-6 md:grid-cols-2">
	                    <div className="space-y-2">
	                      <label className="text-sm font-bold text-foreground/80">服务商名称</label>
                      <input
                        value={creatingNewVendor ? newVendorNameDraft : editingVendorName}
                        onChange={(event) => {
                          if (!creatingNewVendor) {
                            return;
                          }
                          setNewVendorNameDraft(event.target.value);
                        }}
                        placeholder={creatingNewVendor ? '请输入服务商名称' : ''}
                        className="h-10 w-full rounded-xl border border-border/60 bg-muted/20 px-4 text-sm font-medium outline-none transition-all focus:border-primary focus:ring-4 focus:ring-primary/10 disabled:opacity-70"
                        disabled={savingVendorSetting || !creatingNewVendor}
                        autoFocus={creatingNewVendor}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-foreground/80">服务商类型</label>
                      <Select
                        value={vendorTypeSettingDraft}
                        onValueChange={handleVendorTypeSettingChange}
                        disabled={savingVendorSetting}
                      >
                        <SelectTrigger className="h-10 data-[size=default]:h-10 rounded-xl border-border/60 bg-muted/20 focus:ring-primary/20 w-full">
                          <SelectValue placeholder="请选择类型" />
                        </SelectTrigger>
                        <SelectContent className="z-[70] rounded-xl border-border/40 shadow-xl">
                          {data.meta.vendorTypes.map((vendorType) => (
                            <SelectItem key={vendorType} value={vendorType} className="rounded-lg">
                              {vendorTypeLabel(vendorType, vendorDefinitionLabelMap)}
                            </SelectItem>
                          ))}
                        </SelectContent>
	                      </Select>
	                    </div>
	                  </div>

	                  {vendorRequiredEnvVars.length > 0 && (
	                    <div className="space-y-4 rounded-2xl border border-border/40 bg-muted/5 p-5">
                      <div className="flex items-center gap-2">
                        <div className="h-4 w-1 rounded-full bg-primary" />
                        <div className="text-sm font-bold text-foreground/80 uppercase tracking-widest">服务商环境变量</div>
                      </div>
                      <div className="grid gap-5">
                        {vendorRequiredEnvVars.map((item) => (
                          <div key={item.key} className="space-y-1">
                            {(() => {
                              const sharedHint = resolveSharedHintText(
                                item.key,
                                vendorEnvVarsDraft[item.key] ?? '',
                                vendorSharedEnvVarMap,
                              );
                              return (
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                  <span className="text-xs font-bold text-foreground">{item.label}</span>
                                  <span className="font-mono text-[10px] text-muted-foreground opacity-70">({item.key})</span>
                                  <span className={cn(
                                    "rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider shadow-sm",
                                    item.optional ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400' : 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400'
                                  )}>
                                    {item.optional ? '选填' : '必填'}
                                  </span>
                                  {sharedHint ? (
                                    <span className="rounded-md bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-sky-700 dark:bg-sky-500/20 dark:text-sky-400 shadow-sm animate-in fade-in zoom-in-95">
                                      {sharedHint}
                                    </span>
                                  ) : null}
                                </div>
                              );
                            })()}
                            <textarea
                              rows={1}
                              value={vendorEnvVarsDraft[item.key] ?? ''}
                              onChange={(event) =>
                                setVendorEnvVarsDraft((current) => ({
                                  ...current,
                                  [item.key]: event.target.value,
                                }))
                              }
                              onInput={(event) => autoResizeTextarea(event.currentTarget)}
                              ref={(node) => autoResizeTextarea(node)}
                              className="min-h-[40px] w-full resize-none overflow-hidden rounded-xl border border-border/60 bg-background px-4 py-2.5 text-sm font-medium outline-none transition-all focus:border-primary focus:ring-4 focus:ring-primary/10"
                              disabled={savingVendorSetting}
                              placeholder={`请输入 ${item.label}...`}
                            />
                            {item.meaning ? (
                              <span className="text-[11px] text-muted-foreground">{item.meaning}</span>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {vendorSettingError && (
              <div className="mx-6 mb-4 flex items-center gap-3 rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive dark:bg-destructive/20">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <span className="font-medium">{vendorSettingError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 border-t border-border/40 bg-muted/20 px-6 py-5">
              <Button 
                variant="outline" 
                onClick={closeVendorSettingsDialog} 
                disabled={savingVendorSetting}
                className="rounded-xl h-10 px-6 font-bold"
              >
                取消
              </Button>
              <Button
                onClick={saveVendorSettings}
                disabled={savingVendorSetting || vendorSettingLoading}
                className="rounded-xl h-10 px-8 font-bold shadow-lg shadow-primary/20"
              >
                {savingVendorSetting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    正在保存...
                  </>
                ) : (creatingNewVendor ? '立即创建' : '确认保存')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {detailDrawerOpen && (
        <div
          className={cn(
            "fixed inset-0 z-[65] bg-black/35 transition-opacity duration-500 ease-in-out",
            isDrawerActive ? "opacity-100" : "opacity-0"
          )}
        >
          <div
            className={cn(
              "absolute inset-y-0 right-0 w-full max-w-3xl border-l border-border/40 bg-background/95 shadow-2xl backdrop-blur-xl transition-transform duration-500 ease-in-out dark:bg-zinc-950/95",
              isDrawerActive ? "translate-x-0" : "translate-x-full"
            )}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b border-border/40 px-6 py-5">
                <div className="space-y-1">
                  <div className="text-xl font-bold tracking-tight text-foreground">请求详情</div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="h-2 w-2 rounded-full bg-primary" />
                    {detailViewMode === 'vendor'
                      ? (detailVendorContext ? `服务商 · ${detailVendorContext.vendorName}` : '未选择服务商')
                      : (detailTargetRecord ? `#${detailTargetRecord.endpointId} · ${detailTargetRecord.endpointName}` : '未选择端点')}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 rounded-xl border-border/60 bg-background/50 px-4 font-bold shadow-sm transition-all hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                    onClick={() => {
                      if (detailTargetRecord) {
                        void loadDetail(detailTargetRecord.endpointId);
                      }
                    }}
                    disabled={detailLoading || !detailTargetRecord}
                  >
                    {detailLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4 text-primary" />
                    )}
                    刷新详情
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-9 w-9 rounded-xl hover:bg-muted"
                    onClick={closeDetailDrawer}
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </div>
              </div>

              <div className="flex-1 space-y-6 overflow-y-auto p-6 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                {!detailError && detailLoading ? (
                  <div className="flex items-center justify-center py-20">
                    <div className="flex flex-col items-center gap-4">
                      <div className="relative">
                        <div className="h-12 w-12 rounded-full border-4 border-primary/20" />
                        <div className="absolute top-0 h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                      </div>
                      <p className="text-sm font-medium text-muted-foreground">正在同步云端请求详情...</p>
                    </div>
                  </div>
                ) : null}

                {detailData ? (
                  <>
                    <div className="relative overflow-hidden rounded-2xl border border-border/40 bg-muted/20 p-5">
                      <div className="relative z-10">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">目标端点</div>
                        <div className="mt-1 text-base font-bold text-foreground">
                          {detailViewMode === 'vendor' ? (detailVendorContext?.vendorName || detailData.endpoint.name) : detailData.endpoint.name}
                        </div>
                        <div className="mt-2 break-all font-mono text-xs text-muted-foreground opacity-80">
                          {detailData.endpoint.url}
                        </div>
                      </div>
                      <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-primary/5 blur-2xl" />
                    </div>

                    {renderedDetailRows.length === 0 ? (
                      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 p-12 text-center">
                        <div className="rounded-full bg-muted p-4">
                          <Search className="h-8 w-8 text-muted-foreground/50" />
                        </div>
                        <p className="mt-4 text-sm font-medium text-muted-foreground">暂无字段提取详情</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {renderedDetailRows.map((row) => {
                          const probe = row.probe;
                          const primaryAttempt = probe ? pickPrimaryAttempt(probe) : null;
                          const showFieldUpdatedAt = true;
                          const fieldUpdatedAt = formatDateTime(detailData.snapshotGeneratedAt ?? detailData.generatedAt);

                          return (
                            <div key={row.key} className="overflow-hidden rounded-2xl border border-border/40 bg-background shadow-sm transition-all hover:border-primary/20">
                              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 bg-muted/30 px-5 py-3">
                                <div className="text-sm font-bold text-foreground">{row.label}</div>
                                <div className="flex items-center gap-3">
                                  {showFieldUpdatedAt ? (
                                    <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                                      <Clock className="h-3 w-3" />
                                      {fieldUpdatedAt}
                                    </span>
                                  ) : null}
                                  <span className={cn('inline-flex items-center rounded-full border px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider', extractionStateTone(row.state))}>
                                    {extractionStateLabel(row.state)}
                                  </span>
                                </div>
                              </div>

                              <div className="space-y-4 p-5">
                                <div className="grid gap-4 md:grid-cols-2">
                                  <div className="group rounded-xl border border-border/40 bg-muted/10 p-4 transition-colors hover:bg-muted/20">
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">提取结果</div>
                                    <div className={cn('mt-2 font-mono text-sm font-bold text-foreground', row.valueStale ? 'line-through decoration-2 opacity-60' : '')}>
                                      {row.valueText}
                                    </div>
                                  </div>
                                  <div className="group rounded-xl border border-border/40 bg-muted/10 p-4 transition-colors hover:bg-muted/20">
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">提取路径</div>
                                    <div className="mt-2 break-all font-mono text-xs text-foreground/80 leading-relaxed">{row.extractionPath}</div>
                                  </div>
                                </div>

                                <div className="rounded-xl border border-border/40 bg-muted/10 p-4">
                                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">来源说明</div>
                                  <div className="mt-2 break-all text-xs text-foreground/80 leading-relaxed">{row.sourceText}</div>
                                </div>

                                {!primaryAttempt ? (
                                  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/60 p-8 text-center bg-muted/5">
                                    <p className="text-xs font-medium text-muted-foreground">暂无请求记录</p>
                                  </div>
                                ) : (
                                  <div className="space-y-4">
                                    <div className="flex flex-col gap-3 rounded-xl border border-border/40 bg-muted/10 p-4">
                                      <div className="flex items-center justify-between gap-4">
                                        <div className="flex min-w-0 flex-1 items-center gap-2">
                                          <div className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">{primaryAttempt.method ?? 'GET'}</div>
                                          <span className="truncate font-mono text-[11px] text-foreground/80" title={primaryAttempt.url}>{primaryAttempt.url}</span>
                                          <InlineCopyButton value={primaryAttempt.url} className="h-6 w-6 shrink-0 rounded-md hover:bg-background shadow-sm" />
                                        </div>
                                      </div>
                                      <div className="flex flex-wrap items-center gap-4 border-t border-border/40 pt-3">
                                        <div className="flex items-center gap-1.5">
                                          <div className={cn("h-2 w-2 rounded-full", primaryAttempt.status >= 200 && primaryAttempt.status < 300 ? "bg-emerald-500" : "bg-red-500")} />
                                          <span className={cn('text-xs font-bold', debugStatusTone(primaryAttempt.status))}>{debugStatusText(primaryAttempt.status)}</span>
                                        </div>
                                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                                          <Timer className="h-3.5 w-3.5" />
                                          {primaryAttempt.latencyMs}ms
                                        </div>
                                        {primaryAttempt.contentType && (
                                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium truncate max-w-[150px]">
                                            <Activity className="h-3.5 w-3.5" />
                                            {primaryAttempt.contentType}
                                          </div>
                                        )}
                                      </div>
                                    </div>

                                    <div className="space-y-3">
                                      <CodeViewer label="请求头 (Request Headers)" data={primaryAttempt.requestHeaders} maxHeight="200px" />

                                      {primaryAttempt.requestBodyPreview ? (
                                        <CodeViewer label="请求体 (Request Body)" data={primaryAttempt.requestBodyPreview} />
                                      ) : null}

                                      {primaryAttempt.error && (
                                        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50/50 p-4 text-xs text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
                                          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                          <div className="space-y-1">
                                            <div className="font-bold uppercase tracking-wider">请求异常</div>
                                            <div className="font-mono leading-relaxed">{primaryAttempt.error}</div>
                                          </div>
                                        </div>
                                      )}

                                      {primaryAttempt.bodyPreview ? (
                                        <CodeViewer
                                          label="响应内容 (Response Body)"
                                          data={primaryAttempt.bodyPreview}
                                          highlightJsonPath={row.extractionPath === '-' ? null : row.extractionPath}
                                          maxHeight="400px"
                                        />
                                      ) : (
                                        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/60 p-12 text-center bg-muted/5">
                                          <p className="text-xs font-medium text-muted-foreground">无响应内容</p>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}

      {showHiddenList && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm transition-all duration-300" onClick={(e) => e.stopPropagation()}>
          <div className="w-full max-w-md overflow-hidden rounded-3xl border border-border/40 bg-background shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-border/40 bg-muted/20 px-6 py-5">
              <div className="flex items-center gap-2">
                <div className="h-4 w-1 rounded-full bg-primary" />
                <div className="text-lg font-bold tracking-tight">已隐藏端点</div>
              </div>
              <button type="button" className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-all hover:bg-muted hover:text-foreground" onClick={() => setShowHiddenList(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-6 py-6 scrollbar-hide bg-background/30">
              {data.records.filter((r) => r.isHidden).length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 p-12 text-center bg-muted/5">
                  <EyeOff className="h-8 w-8 text-muted-foreground/30" />
                  <p className="mt-4 text-sm font-medium text-muted-foreground">暂无隐藏端点</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {data.records.filter((r) => r.isHidden).map((r) => (
                    <div key={r.endpointId} className="flex items-center justify-between gap-4 rounded-2xl border border-border/60 bg-background/80 p-4 shadow-sm transition-all hover:border-primary/40 hover:shadow-md">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">#{r.endpointId}</span>
                          <div className="truncate text-sm font-bold">{r.endpointName}</div>
                        </div>
                        <div className="truncate font-mono text-xs text-muted-foreground/80">{r.endpointUrl}</div>
                      </div>
                      <Button variant="outline" size="sm" className="shrink-0 rounded-xl h-9 px-4 font-bold shadow-sm hover:bg-primary/5 hover:text-primary transition-all active:scale-95" onClick={() => toggleHidden(r.endpointId, false)}>
                        取消隐藏
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end border-t border-border/40 bg-muted/20 px-6 py-4">
              <Button variant="default" onClick={() => setShowHiddenList(false)} className="rounded-xl h-10 px-8 font-bold shadow-lg shadow-primary/20">
                完成
              </Button>
            </div>
          </div>
        </div>
      )}

      {refreshAllTaskVisible && refreshAllTask && (
        <div
          ref={refreshAllTaskContainerRef}
          className="pointer-events-none fixed bottom-6 right-6 z-[120] flex w-full max-w-[380px] flex-col outline-none"
        >
          <div className="pointer-events-auto group relative flex w-full flex-col gap-3 overflow-hidden rounded-[1.25rem] border border-border/40 bg-background/95 p-5 shadow-2xl backdrop-blur-xl transition-all hover:shadow-primary/5 dark:bg-zinc-950/95 animate-in slide-in-from-right-full fade-in duration-500">
            {/* Accent side bar */}
            <div className={cn(
              "absolute left-0 top-0 bottom-0 w-1.5",
              refreshAllTask.status === 'running' ? "bg-primary" : 
              refreshAllTask.status === 'completed' ? "bg-emerald-500" : "bg-rose-500"
            )} />

            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
                  refreshAllTask.status === 'running' ? "bg-primary/10 text-primary" : 
                  refreshAllTask.status === 'completed' ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500"
                )}>
                  {refreshAllTask.status === 'running' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : refreshAllTask.status === 'completed' ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <AlertCircle className="h-4 w-4" />
                  )}
                </div>
                <div className="flex flex-col justify-center">
                  <span className="text-sm font-black tracking-tight text-foreground uppercase italic leading-none pt-0.5">
                    {refreshAllTask.status === 'running'
                      ? '刷新任务执行中'
                      : refreshAllTask.status === 'completed'
                        ? '全部刷新已完成'
                        : '任务执行失败'}
                  </span>
                  <span className="text-[11px] font-bold text-muted-foreground/80 mt-1">
                    进度: {Math.min(refreshAllTask.completed, refreshAllTask.total)} / {refreshAllTask.total}
                  </span>
                </div>
              </div>
              <div className="text-xl font-black font-mono text-foreground/20">
                {Math.round(refreshAllProgressPercent)}%
              </div>
            </div>

            <div className="h-2 w-full overflow-hidden rounded-full bg-muted/50 shadow-inner">
              <div
                className={cn(
                  'h-full transition-all duration-300 ease-out rounded-full',
                  refreshAllTask.status === 'failed' ? 'bg-rose-500' : 
                  refreshAllTask.status === 'completed' ? 'bg-emerald-500' : 'bg-primary',
                )}
                style={{ width: `${refreshAllProgressPercent}%` }}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  成功: {refreshAllSuccessCount}
                </span>
                <span className={cn(
                  "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold border",
                  refreshAllTask.failed > 0 
                    ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20" 
                    : "bg-muted/30 text-muted-foreground border-border/40"
                )}>
                  失败: {refreshAllTask.failed}
                </span>
              </div>
              <div className="text-[11px] font-medium text-muted-foreground truncate" title={refreshAllTask.status === 'running' ? (refreshAllTask.currentEndpointName ?? '-') : '-'}>
                {refreshAllTask.status === 'running' ? `正在刷新: ${refreshAllTask.currentEndpointName ?? '...'}` : '所有端点检测完毕'}
              </div>
            </div>

            {refreshAllTask.status === 'failed' && refreshAllTask.message && (
              <div className="mt-1 rounded-lg border border-rose-500/20 bg-rose-500/10 p-2.5 text-xs font-medium text-rose-700 dark:text-rose-400 line-clamp-2">
                {refreshAllTask.message}
              </div>
            )}
          </div>
        </div>
      )}

    </>
  );
}
