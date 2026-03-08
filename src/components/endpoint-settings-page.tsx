'use client';

import { ArrowLeft, CircleCheckBig, CircleX, Loader2, RefreshCw, Save, ShieldAlert, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { withBasePath } from '@/lib/client/base-path';
import { formatDateTime, formatUsd, resolveDefaultVendorType } from '@/lib/utils';
import { toast } from '@/lib/toast';

type EndpointType = string;

const CREATE_ENDPOINT_VALUE = '__create__';

type VendorOption = {
  id: number;
  name: string;
  vendorType: EndpointType | null;
  updatedAt: string | null;
};

type QuotaRecord = {
  endpointId: number;
  endpointName: string;
  endpointUrl: string;
  isEnabled: boolean;
  vendorId: number | null;
  vendorName: string | null;
  vendorType: EndpointType;
  useVendorGroup: boolean;
  useVendorUsed: boolean;
  useVendorRemaining: boolean;
  useVendorAmount: boolean;
  useVendorBalance: boolean;
  result: {
    status: string;
    strategy: string;
    totalUsd: number | null;
    usedUsd: number | null;
    remainingUsd: number | null;
    checkedAt: string | null;
    latencyMs: number | null;
    message?: string;
    rawSnippet?: string;
    credentialIssue?: 'cookie_expired' | null;
  };
};

type PageData = {
  record: QuotaRecord;
  meta: {
    vendorTypes: string[];
    vendorDefinitions?: Array<{
      vendorType: string;
      displayName: string;
      endpointTotalMode?: 'independent_request' | 'sum_from_parts' | 'manual_total';
      dailyCheckinEnabled?: boolean;
      aggregation?: {
        vendor_remaining: 'independent_request' | 'endpoint_sum';
        vendor_used: 'independent_request' | 'endpoint_sum';
      } | null;
      apiKind?: 'claude_code' | 'gemini' | 'codex' | 'unknown';
    }>;
    endpoints: VendorOption[];
  };
};

type EndpointSettingsResponse = {
  ok: boolean;
  message?: string;
  endpoint?: {
    id: number;
    name: string;
    vendorType: EndpointType;
    updatedAt: string | null;
  };
  endpoints?: VendorOption[];
};

type EndpointProvidersRefreshResponse = {
  ok: boolean;
  message?: string;
  generatedAt?: string;
  total?: number;
  meta?: PageData['meta'];
  records?: QuotaRecord[];
};

const UNTYPED_VENDOR_TYPE = '__missing_vendor_type__';

function vendorTypeLabel(value: string, defs?: Array<{ vendorType: string; displayName: string }>): string {
  if (value === UNTYPED_VENDOR_TYPE) {
    return '未配置类型';
  }
  const normalized = (value || '').trim().toLowerCase();
  if (!normalized) return '未配置类型';
  const match = defs?.find((item) => item.vendorType.trim().toLowerCase() === normalized);
  const displayName = (match?.displayName || '').trim();
  return displayName || value;
}


function statusLabel(status: string): string {
  const mapping: Record<string, string> = {
    ok: '正常',
    unauthorized: '鉴权失败',
    unsupported: '暂不支持',
    network_error: '网络错误',
    parse_error: '解析失败',
    not_checked: '未查询',
  };
  return mapping[status] ?? status;
}

export function EndpointSettingsPage({ initialData }: { initialData: PageData }) {
  const [data, setData] = useState(initialData);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingLatest, setLoadingLatest] = useState(false);
  const [endpointDraft, setEndpointDraft] = useState(initialData.record.vendorId ? String(initialData.record.vendorId) : '');
  const [endpointCreateName, setEndpointCreateName] = useState('');
  const [useVendorGroupDraft, setUseEndpointGroupDraft] = useState(Boolean(initialData.record.useVendorGroup));
  const [useVendorUsedDraft, setUseEndpointUsedDraft] = useState(initialData.record.useVendorUsed !== false);
  const [useVendorRemainingDraft, setUseVendorRemainingDraft] = useState(initialData.record.useVendorRemaining !== false);
  const [useVendorAmountDraft, setUseEndpointAmountDraft] = useState(Boolean(initialData.record.useVendorAmount));
  const [useVendorBalanceDraft, setUseEndpointBalanceDraft] = useState(Boolean(initialData.record.useVendorBalance));

  const [editingEndpointId, setEditingEndpointId] = useState<number | null>(null);
  const [editingEndpointName, setEditingEndpointName] = useState('');
  const [endpointSettingLoading, setEndpointSettingLoading] = useState(false);
  const [savingVendorSetting, setSavingVendorSetting] = useState(false);
  const [vendorTypeSettingDraft, setEndpointTypeSettingDraft] = useState<EndpointType>(
    resolveDefaultVendorType(initialData.meta.vendorTypes, initialData.meta.vendorDefinitions, initialData.record.vendorType),
  );

  const statusLine = useMemo(() => {
    return `${statusLabel(data.record.result.status)} · ${data.record.result.strategy}`;
  }, [data.record.result.status, data.record.result.strategy]);

  const selectedVendorOption = useMemo(() => {
    const vendorId = Number(endpointDraft);
    if (!Number.isInteger(vendorId) || vendorId <= 0) {
      return null;
    }
    return data.meta.endpoints.find((endpoint) => endpoint.id === vendorId) ?? null;
  }, [data.meta.endpoints, endpointDraft]);

  const groupedEndpointOptions = useMemo(() => {
    const buckets = new Map<string, VendorOption[]>();
    for (const endpoint of data.meta.endpoints) {
      const key = (endpoint.vendorType || '').trim().toLowerCase() || UNTYPED_VENDOR_TYPE;
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
      label: vendorTypeLabel(key, data.meta.vendorDefinitions),
      endpoints: buckets.get(key) ?? [],
    }));
  }, [data.meta.endpoints, data.meta.vendorDefinitions, data.meta.vendorTypes]);

  const applyRecord = (record: QuotaRecord, meta?: PageData['meta']) => {
    setData((current) => ({
      record,
      meta: meta ?? current.meta,
    }));

    setEndpointDraft(record.vendorId ? String(record.vendorId) : '');
    setEndpointCreateName('');
    setUseEndpointGroupDraft(Boolean(record.useVendorGroup));
    setUseEndpointUsedDraft(record.useVendorUsed !== false);
    setUseVendorRemainingDraft(record.useVendorRemaining !== false);
    setUseEndpointAmountDraft(Boolean(record.useVendorAmount));
    setUseEndpointBalanceDraft(Boolean(record.useVendorBalance));
  };

  const loadLatest = async () => {
    setLoadingLatest(true);
    try {
      const response = await fetch(withBasePath(`/api/endpoints/${data.record.endpointId}`), { cache: 'no-store' });
      const body = (await response.json()) as {
        ok: boolean;
        message?: string;
        record?: QuotaRecord;
        meta?: PageData['meta'];
      };

      if (!response.ok || !body.ok || !body.record || !body.meta) {
        throw new Error(body.message || '读取最新数据失败');
      }

      applyRecord(body.record, body.meta);
      toast.success('已读取最新缓存数据');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingLatest(false);
    }
  };

  const refreshOne = async (options?: { silentInfo?: boolean }): Promise<boolean> => {
    const silentInfo = Boolean(options?.silentInfo);
    setRefreshing(true);
    try {
      const response = await fetch(withBasePath(`/api/endpoints/${data.record.endpointId}/refresh`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      const body = (await response.json()) as {
        ok: boolean;
        message?: string;
        record?: QuotaRecord;
      };

      if (!response.ok || !body.ok || !body.record) {
        throw new Error(body.message || '刷新失败');
      }

      applyRecord(body.record);
      if (!silentInfo) {
      toast.success('刷新成功');
      }
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setRefreshing(false);
    }
  };

  const refreshEndpointsByVendor = async (
    vendorId: number,
    options?: { silentInfo?: boolean },
  ): Promise<boolean> => {
    if (!Number.isInteger(vendorId) || vendorId <= 0) {
      return false;
    }

    const silentInfo = Boolean(options?.silentInfo);

    try {
      const response = await fetch(withBasePath('/api/endpoints'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh-by-vendor', vendorId }),
      });
      const body = (await response.json()) as EndpointProvidersRefreshResponse;
      if (!response.ok || !body.ok || !Array.isArray(body.records)) {
        throw new Error(body.message || '刷新服务商关联端点失败');
      }

      const nextMeta = body.meta ?? data.meta;
      const currentRecord = body.records.find((record) => record.endpointId === data.record.endpointId) ?? null;
      if (currentRecord) {
        applyRecord(currentRecord, nextMeta);
      } else if (body.meta) {
        setData((current) => ({ ...current, meta: nextMeta }));
      }

      if (!silentInfo) {
        const count = Number.isInteger(body.total) ? Number(body.total) : body.records.length;
        toast.success(count > 0 ? `已刷新 ${count} 个关联端点` : '该服务商下暂无可刷新的端点');
      }
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  const handleEndpointSelection = (value: string) => {
    setEndpointDraft(value);
    if (value !== CREATE_ENDPOINT_VALUE) {
      setEndpointCreateName('');
    }
  };

  const openEndpointSettings = async (vendorId: number) => {
    if (!Number.isInteger(vendorId) || vendorId <= 0) {
      return;
    }

    setEndpointSettingLoading(true);
    setSavingVendorSetting(false);

    try {
      const response = await fetch(withBasePath(`/api/vendors/${vendorId}/settings`), { cache: 'no-store' });
      const body = (await response.json()) as EndpointSettingsResponse;
      if (!response.ok || !body.ok || !body.endpoint) {
        throw new Error(body.message || '读取服务商配置失败');
      }

      if (Array.isArray(body.endpoints)) {
        setData((current) => ({
          ...current,
          meta: {
            ...current.meta,
            endpoints: body.endpoints!,
          },
        }));
      }

      setEditingEndpointId(body.endpoint.id);
      setEditingEndpointName(body.endpoint.name);
      setEndpointTypeSettingDraft(body.endpoint.vendorType);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setEndpointSettingLoading(false);
    }
  };

  const closeEndpointSettingsDialog = () => {
    if (savingVendorSetting) {
      return;
    }

    setEditingEndpointId(null);
    setEditingEndpointName('');
    setEndpointSettingLoading(false);
    setEndpointTypeSettingDraft(
      resolveDefaultVendorType(data.meta.vendorTypes, data.meta.vendorDefinitions, data.record.vendorType),
    );
  };

  const saveEndpointSettings = async () => {
    if (!editingEndpointId) {
      return;
    }

    setSavingVendorSetting(true);

    try {
      const response = await fetch(withBasePath(`/api/vendors/${editingEndpointId}/settings`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendorType: vendorTypeSettingDraft,
        }),
      });

      const body = (await response.json()) as EndpointSettingsResponse;
      if (!response.ok || !body.ok || !body.endpoint) {
        throw new Error(body.message || '保存服务商配置失败');
      }

      const nextMeta: PageData['meta'] = {
        ...data.meta,
        endpoints: Array.isArray(body.endpoints) ? body.endpoints : data.meta.endpoints,
      };

      setData((current) => {
        const endpointMatched = current.record.vendorId === body.endpoint!.id;

        if (!endpointMatched) {
          return {
            ...current,
            meta: nextMeta,
          };
        }

        return {
          meta: nextMeta,
          record: {
            ...current.record,
            vendorType: body.endpoint!.vendorType,
          },
        };
      });

      setEditingEndpointName(body.endpoint.name);
      setEndpointTypeSettingDraft(body.endpoint.vendorType);
      const refreshed = await refreshEndpointsByVendor(body.endpoint.id, { silentInfo: true });
      if (refreshed) {
        toast.success('服务商配置已保存，已自动刷新关联端点');
      } else {
        toast.success('服务商配置已保存');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingVendorSetting(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);

    try {
      const creatingEndpoint = endpointDraft === CREATE_ENDPOINT_VALUE;
      const createdEndpointName = endpointCreateName.trim();
      if (creatingEndpoint && !createdEndpointName) {
        throw new Error('请选择端点或填写新增服务商名称');
      }

      const vendorId = endpointDraft && endpointDraft !== CREATE_ENDPOINT_VALUE ? Number(endpointDraft) : null;
      if (!vendorId && !creatingEndpoint) {
        throw new Error('必须选择所属服务商');
      }

      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 15000);

      const response = await fetch(withBasePath('/api/endpoint-settings'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          endpointId: data.record.endpointId,
          vendorId,
          vendorName: creatingEndpoint ? createdEndpointName : null,
          useVendorGroup: useVendorGroupDraft,
          useVendorUsed: useVendorGroupDraft ? useVendorUsedDraft : false,
          useVendorRemaining: useVendorGroupDraft ? useVendorRemainingDraft : false,
          useVendorAmount: useVendorAmountDraft,
          useVendorBalance: useVendorBalanceDraft,
        }),
      }).finally(() => {
        window.clearTimeout(timer);
      });

      const body = (await response.json()) as {
        ok: boolean;
        message?: string;
        endpoints?: VendorOption[];
        setting?: {
          vendorId: number | null;
          vendorName: string | null;
          vendorType: EndpointType;
          useVendorGroup: boolean;
          useVendorUsed: boolean;
          useVendorRemaining: boolean;
          useVendorAmount: boolean;
          useVendorBalance: boolean;
        };
      };

      if (!response.ok || !body.ok || !body.setting) {
        throw new Error(body.message || '保存失败');
      }

      const nextMeta: PageData['meta'] = {
        ...data.meta,
        endpoints: Array.isArray(body.endpoints) ? body.endpoints : data.meta.endpoints,
      };

      const nextRecord: QuotaRecord = {
        ...data.record,
        vendorId: body.setting.vendorId,
        vendorName: body.setting.vendorName,
        vendorType: body.setting.vendorType,
        useVendorGroup: body.setting.useVendorGroup,
        useVendorUsed: body.setting.useVendorUsed,
        useVendorRemaining: body.setting.useVendorRemaining,
        useVendorAmount: body.setting.useVendorAmount,
        useVendorBalance: body.setting.useVendorBalance,
      };

      applyRecord(nextRecord, nextMeta);
      const refreshed = await refreshOne({ silentInfo: true });
      toast.success(refreshed ? '设置已保存并自动刷新' : '设置已保存');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 md:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => (window.location.href = withBasePath('/'))}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            返回面板
          </Button>

          <Button
            variant="outline"
            onClick={() => (window.location.href = withBasePath(`/endpoints/${data.record.endpointId}/debug`))}
          >
            调试页
          </Button>

          <Button variant="outline" onClick={loadLatest} disabled={loadingLatest || saving}>
            {loadingLatest ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            读取缓存
          </Button>

          <Button variant="outline" onClick={() => void refreshOne()} disabled={refreshing || saving}>
            {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            刷新该端点
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>端点配置页 · #{data.record.endpointId}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="font-medium">{data.record.endpointName}</div>
            <div className="font-mono text-xs text-muted-foreground">{data.record.endpointUrl}</div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              {data.record.isEnabled ? (
                <CircleCheckBig className="h-4 w-4 text-green-500 flex-shrink-0" aria-label="渠道已启用" />
              ) : (
                <CircleX className="h-4 w-4 text-gray-400 flex-shrink-0" aria-label="渠道已禁用" />
              )}
              渠道状态：{data.record.isEnabled ? '已启用' : '已禁用'}
            </div>
            <div className="text-xs text-muted-foreground">端点类型：{vendorTypeLabel(data.record.vendorType, data.meta.vendorDefinitions)}</div>
            <div className="text-xs text-muted-foreground">状态：{statusLine}</div>
            <div className="text-xs text-muted-foreground">
              上次查询：{formatDateTime(data.record.result.checkedAt)}，余额：${formatUsd(data.record.result.remainingUsd)}
            </div>
            {data.record.result.credentialIssue === 'cookie_expired' && (
              <div className="flex items-center gap-1 text-xs text-red-600">
                <ShieldAlert className="h-3.5 w-3.5" />
                检测到 Cookie 已失效，请更新后重试
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>端点查询设置</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <div className="space-y-1">
                <label className="text-sm font-medium">所属服务商（必选）</label>
                <Select value={endpointDraft} onValueChange={handleEndpointSelection} disabled={saving}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="请选择所属服务商" />
                  </SelectTrigger>
                  <SelectContent className="z-[70]">
                    {groupedEndpointOptions.map((group) => (
                      <SelectGroup key={group.key}>
                        <SelectLabel>{group.label}</SelectLabel>
                        {group.endpoints.map((endpoint) => (
                          <SelectItem key={endpoint.id} value={String(endpoint.id)}>
                            {endpoint.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                    <SelectSeparator />
                    <SelectItem value={CREATE_ENDPOINT_VALUE}>+ 新增端点...</SelectItem>
                  </SelectContent>
                </Select>
                {endpointDraft === CREATE_ENDPOINT_VALUE && (
                  <input
                    value={endpointCreateName}
                    onChange={(event) => setEndpointCreateName(event.target.value)}
                    placeholder="请输入新服务商名称"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
                    disabled={saving}
                  />
                )}
              </div>

            </div>

            <div className="rounded-md border border-border/70 bg-muted/20 p-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={useVendorGroupDraft}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setUseEndpointGroupDraft(checked);
                    if (!checked) {
                      setUseEndpointUsedDraft(false);
                      setUseVendorRemainingDraft(false);
                    }
                  }}
                  disabled={saving}
                />
                跟随服务商分组
              </label>
              <p className="mt-1 text-xs text-muted-foreground">
                {useVendorGroupDraft
                  ? '已启用：端点在控制台按所属服务商进行分组展示。'
                  : '已关闭：端点显示在"未分组"，但仍可使用服务商进行查询。'}
              </p>
            </div>

            <div className="rounded-md border border-border/70 bg-muted/20 p-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={useVendorUsedDraft}
                  onChange={(event) => setUseEndpointUsedDraft(event.target.checked)}
                  disabled={saving || !useVendorGroupDraft}
                />
                参与服务商已用计算
              </label>
              <p className="mt-1 text-xs text-muted-foreground">
                关闭后，该服务商的"已用"数据不会计入服务商的汇总"已用"数据。
              </p>
            </div>

            <div className="rounded-md border border-border/70 bg-muted/20 p-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={useVendorRemainingDraft}
                  onChange={(event) => setUseVendorRemainingDraft(event.target.checked)}
                  disabled={saving || !useVendorGroupDraft}
                />
                参与服务商余额计算
              </label>
              <p className="mt-1 text-xs text-muted-foreground">
                关闭后，该服务商的"余额"数据不会计入服务商的汇总"余额"数据。
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-md border border-border/70 bg-muted/20 p-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={useVendorAmountDraft}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setUseEndpointAmountDraft(checked);
                    }}
                    disabled={saving}
                  />
                  使用服务商总额
                </label>
                {useVendorAmountDraft && (
                  <p className="mt-1 text-xs text-muted-foreground">已启用：优先使用服务商总额。</p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  服务商总额会在运行时按“服务商已用 + 服务商余额”自动计算。
                </p>
              </div>
            </div>

            <div className="rounded-md border border-border/70 bg-muted/20 p-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={useVendorBalanceDraft}
                  onChange={(event) => setUseEndpointBalanceDraft(event.target.checked)}
                  disabled={saving}
                />
                跟随服务商余额
              </label>
              {useVendorBalanceDraft && selectedVendorOption ? (
                <div className="mt-1 text-xs text-muted-foreground">
                  当前所属服务商：{selectedVendorOption.name}
                </div>
              ) : (
                <div className="mt-1 text-xs text-muted-foreground">
                  开启后端点余额将跟随服务商余额。
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t pt-4">
              <Button onClick={saveSettings} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                保存设置
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {editingEndpointId !== null && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4">
          <div
            className="w-full max-w-2xl rounded-xl border border-border bg-background shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <div className="text-base font-semibold">服务商配置</div>
                <div className="text-xs text-muted-foreground">
                  #{editingEndpointId} · {editingEndpointName || '-'}
                </div>
              </div>
              <button
                type="button"
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                onClick={closeEndpointSettingsDialog}
                disabled={savingVendorSetting}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 px-5 py-4">
              {endpointSettingLoading ? (
                <div className="flex items-center gap-2 rounded-md border border-border/70 bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在读取服务商配置...
                </div>
              ) : (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-sm font-medium">端点类型</label>
                      <Select
                        value={vendorTypeSettingDraft}
                        onValueChange={(value) => setEndpointTypeSettingDraft(value as EndpointType)}
                        disabled={savingVendorSetting}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="请选择端点类型" />
                        </SelectTrigger>
                        <SelectContent className="z-[70]">
                          {data.meta.vendorTypes.map((vendorType) => (
                            <SelectItem key={vendorType} value={vendorType}>
                              {vendorTypeLabel(vendorType, data.meta.vendorDefinitions)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="rounded-md border border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground">
                    服务商级环境变量请在主面板的服务商配置中管理。
                  </div>

                </>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t px-5 py-4">
              <Button variant="outline" onClick={closeEndpointSettingsDialog} disabled={savingVendorSetting}>
                取消
              </Button>
              <Button onClick={saveEndpointSettings} disabled={savingVendorSetting || endpointSettingLoading}>
                {savingVendorSetting ? '保存中...' : '保存端点'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
