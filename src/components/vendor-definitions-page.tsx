'use client';

import { Check, Clipboard, Copy, Download, Loader2, Pencil, Plus, Server, Shapes, ShieldAlert, Trash2, Upload, Users, X } from 'lucide-react';
import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { AnimatedStatCard } from '@/components/ui/animated-stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { VendorDefinitionEditor } from '@/components/vendor-definition-editor';
import { withBasePath } from '@/lib/client/base-path';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

type FormulaConfig = { type: 'direct' | 'divide'; divisor?: number } | null;
type UrlReplacementRule = {
  search: string;
  replace: string;
};
type RefreshResponseMapping = {
  field: string;
  envVarKey: string;
  formula?: FormulaConfig;
};

type RequestRegionBase = {
  auth: 'bearer' | 'cookie' | 'url_key';
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  baseUrlReplacements?: UrlReplacementRule[];
  queryParams?: Record<string, string | number | boolean>;
  requestHeaders?: Record<string, string>;
  requestBody?: Record<string, unknown> | null;
  autoHandle403Intercept?: boolean;
  refreshOnUnauth?: boolean;
  refreshPath?: string;
  refreshBodyTemplate?: Record<string, string>;
  refreshResponseMappings?: RefreshResponseMapping[];
};

type RegionMetricConfig = RequestRegionBase & {
  field?: string | null;
  formula?: FormulaConfig;
};

type RegionTokenUsageConfig = RequestRegionBase & {
  usedField?: string | null;
  remainingField?: string | null;
  usedFormula?: FormulaConfig;
  remainingFormula?: FormulaConfig;
};

type RegionResetDateConfig = RequestRegionBase & {
  resetField?: string | null;
};

type StrategyDefinition = {
  name: string;
  priority: number;
  auth: 'bearer' | 'cookie' | 'url_key';
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  queryTarget?: 'amount' | 'token_usage' | 'reset_date' | 'identity' | 'compat_deprecated' | 'refresh';
  queryParams?: Record<string, string | number | boolean>;
  requestHeaders?: Record<string, string>;
  requestBody?: Record<string, unknown> | null;
  fields: {
    total?: string | null;
    used?: string | null;
    remaining?: string | null;
  };
  formulas: {
    total?: { type: 'direct' | 'divide'; divisor?: number } | null;
    used?: { type: 'direct' | 'divide'; divisor?: number } | null;
    remaining?: { type: 'direct' | 'divide'; divisor?: number } | null;
  };
  balanceCalc: 'remaining_direct' | 'total_minus_used' | 'fields_independent';
  refreshOnUnauth?: boolean;
  refreshPath?: string;
  refreshBodyTemplate?: Record<string, string>;
};

type VendorRegionConfig = {
  version: 1;
  endpointTotalMode?: 'independent_request' | 'sum_from_parts' | 'manual_total';
  refreshTokenEnabled?: boolean;
  refreshToken?: RequestRegionBase | null;
  dailyCheckinEnabled?: boolean;
  dailyCheckin?: RequestRegionBase | null;
  endpointMetricModes?: {
    endpoint_remaining: 'independent_request' | 'subtract_from_total';
    endpoint_used: 'independent_request' | 'subtract_from_total';
  };
  aggregation?: {
    vendor_remaining: 'independent_request' | 'endpoint_sum';
    vendor_used: 'independent_request' | 'endpoint_sum';
  };
  regions: {
    vendor_remaining: RegionMetricConfig | null;
    vendor_used: RegionMetricConfig | null;
    endpoint_remaining: RegionMetricConfig | null;
    endpoint_used: RegionMetricConfig | null;
    endpoint_total: RegionMetricConfig | null;
  };
  middle: {
    mode: 'none' | 'token_usage' | 'reset_date';
    token_usage: RegionTokenUsageConfig | null;
    reset_date: RegionResetDateConfig | null;
  };
};

type VendorEnvVarDefinition = {
  key: string;
  label: string;
  scope: 'vendor' | 'endpoint';
  meaning?: string | null;
  optional?: boolean;
  defaultValue?: string | null;
};

type VendorDefinition = {
  id: number;
  vendorType: string;
  displayName: string;
  description: string | null;
  strategies?: StrategyDefinition[];
  regionConfig: VendorRegionConfig;
  envVars?: VendorEnvVarDefinition[];
  createdAt: string;
  updatedAt: string;
};

type VendorDefinitionImportItem = {
  vendorType: string;
  displayName: string;
  description: string | null;
  regionConfig: VendorRegionConfig;
  envVars: VendorEnvVarDefinition[];
};

type VendorDefinitionsExportBundle = {
  schemaVersion: 1;
  exportedAt: string;
  source: 'vendor-definitions-board';
  definition: VendorDefinitionImportItem;
};

type ExportPreviewState = {
  vendorType: string;
  fileName: string;
  content: string;
};

type ImportMode = 'paste' | 'file';

function ensureObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} 必须为对象`);
  }
  return value as Record<string, unknown>;
}

function normalizeImportedDefinition(raw: unknown): VendorDefinitionImportItem {
  if (Array.isArray(raw)) {
    throw new Error('导入文件仅支持单个类型定义');
  }

  const source = ensureObject(raw, '导入文件');

  let row: Record<string, unknown> = source;
  const hasBundleShape =
    source.definition !== undefined
    || source.schemaVersion !== undefined
    || source.source !== undefined
    || source.exportedAt !== undefined;

  if (hasBundleShape) {
    const schemaVersion = Number(source.schemaVersion);
    if (!Number.isInteger(schemaVersion) || schemaVersion !== 1) {
      throw new Error('导入文件 schemaVersion 仅支持 1');
    }
    row = ensureObject(source.definition, 'definition');
  } else if (Array.isArray(source.definitions)) {
    throw new Error('导入文件仅支持 definition 单项格式');
  }

  const vendorType = String(row.vendorType ?? '').trim();
  const displayName = String(row.displayName ?? '').trim();
  if (!vendorType || !displayName) {
    throw new Error('导入文件缺少 vendorType 或 displayName');
  }
  if (!row.regionConfig || typeof row.regionConfig !== 'object' || Array.isArray(row.regionConfig)) {
    throw new Error('导入文件 regionConfig 必须为对象');
  }

  return {
    vendorType,
    displayName,
    description: row.description === null || row.description === undefined ? null : String(row.description),
    regionConfig: row.regionConfig as VendorRegionConfig,
    envVars: Array.isArray(row.envVars) ? (row.envVars as VendorEnvVarDefinition[]) : [],
  };
}

type VendorDefinitionsPageProps = {
  initialDefinitions: VendorDefinition[];
  stats: {
    endpointTotal: number;
    vendorTotal: number;
    vendorTypeTotal: number;
  };
};

export function VendorDefinitionsPage({ initialDefinitions, stats }: VendorDefinitionsPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [definitions, setDefinitions] = useState(initialDefinitions);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>('paste');
  const [importJsonDraft, setImportJsonDraft] = useState('');
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [exportPreview, setExportPreview] = useState<ExportPreviewState | null>(null);
  const [exportCopied, setExportCopied] = useState(false);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  const listPath = withBasePath('/vendor-definitions');
  const creating = searchParams.get('create') === '1';
  const editingVendorType = (searchParams.get('edit') || '').trim().toLowerCase();
  const editing = useMemo(() => {
    if (!editingVendorType) {
      return null;
    }
    return definitions.find((definition) => definition.vendorType.toLowerCase() === editingVendorType) ?? null;
  }, [definitions, editingVendorType]);

  const openCreateEditor = () => {
    router.replace(`${listPath}?create=1`, { scroll: false });
  };

  const openEditEditor = (vendorType: string) => {
    router.replace(`${listPath}?edit=${encodeURIComponent(vendorType)}`, { scroll: false });
  };

  const closeEditor = () => {
    router.replace(listPath, { scroll: false });
  };

  const exportDefinition = (definition: VendorDefinition) => {
    const payload: VendorDefinitionsExportBundle = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      source: 'vendor-definitions-board',
      definition: {
        vendorType: definition.vendorType,
        displayName: definition.displayName,
        description: definition.description,
        regionConfig: definition.regionConfig,
        envVars: definition.envVars ?? [],
      },
    };
    const content = JSON.stringify(payload, null, 2);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    setExportCopied(false);
    setExportPreview({
      vendorType: definition.vendorType,
      fileName: `vendor-definition-${definition.vendorType}-${timestamp}.json`,
      content,
    });
  };

  const copyExportContent = async () => {
    if (!exportPreview) return;
    try {
      await navigator.clipboard.writeText(exportPreview.content);
      setExportCopied(true);
      toast.success('复制成功', `已复制类型：${exportPreview.vendorType}`);
      setTimeout(() => setExportCopied(false), 2000);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error('复制失败', message);
    }
  };

  const downloadExportFile = () => {
    if (!exportPreview) return;
    const blob = new Blob([exportPreview.content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = exportPreview.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast.success('导出成功', `已导出类型：${exportPreview.vendorType}`);
  };

  const openImportModal = () => {
    setImportMode('paste');
    setImportJsonDraft('');
    setImportFileName(null);
    setImportModalOpen(true);
  };

  const closeImportModal = () => {
    if (importing) {
      return;
    }
    setImportModalOpen(false);
  };

  const handleImportFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = '';
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      setImportMode('file');
      setImportFileName(file.name);
      toast.success(`成功加载文件：${file.name}`);
      setImportJsonDraft(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error('读取文件失败', message);
    }
  };

  const handlePasteJsonClick = async () => {
    setImportMode('paste');
    setImportFileName(null);
    try {
      const text = await navigator.clipboard.readText();
      setImportJsonDraft(text);
      if (!text.trim()) {
        toast.warning('剪切板为空', '请手动粘贴 JSON 内容');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.warning('读取剪切板失败', message);
    }
  };

  const confirmImport = async () => {
    const content = importJsonDraft.trim();
    if (!content) {
      toast.error('导入失败', '请先粘贴 JSON 或上传文件');
      return;
    }

    setImporting(true);
    try {
      const parsed = JSON.parse(content) as unknown;
      const item = normalizeImportedDefinition(parsed);
      const response = await fetch(withBasePath('/api/vendor-definitions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) {
        throw new Error(`导入 ${item.vendorType} 失败：${body.message || '未知错误'}`);
      }
      await reload();
      toast.success('导入成功', `已导入类型：${item.vendorType}`);
      setImportModalOpen(false);
      setImportJsonDraft('');
      setImportFileName(null);
      setImportMode('paste');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error('导入失败', message);
    } finally {
      setImporting(false);
    }
  };

  const reload = async () => {
    try {
      const res = await fetch(withBasePath('/api/vendor-definitions'));
      const body = await res.json();
      if (body.ok) setDefinitions(body.definitions);
    } catch {
      // ignore
    }
  };

  const handleDelete = async (vendorType: string) => {
    if (!confirm(`确定删除类型定义 "${vendorType}"？`)) return;
    setDeleting(vendorType);
    try {
      const res = await fetch(withBasePath(`/api/vendor-definitions/${vendorType}`), { method: 'DELETE' });
      const body = await res.json();
      if (!body.ok) throw new Error(body.message || '删除失败');
      await reload();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error('删除失败', message);
    } finally {
      setDeleting(null);
    }
  };

  const handleSave = async (data: {
    vendorType: string;
    displayName: string;
    description: string | null;
    regionConfig: VendorRegionConfig;
    envVars: VendorEnvVarDefinition[];
  }) => {
    const isNew = creating;
    const url = isNew
      ? withBasePath('/api/vendor-definitions')
      : withBasePath(`/api/vendor-definitions/${data.vendorType}`);
    const method = isNew ? 'POST' : 'PUT';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const body = await res.json();
    if (!body.ok) throw new Error(body.message || '保存失败');

    await reload();
    if (isNew) {
      router.replace(`${listPath}?edit=${encodeURIComponent(data.vendorType.trim().toLowerCase())}`, { scroll: false });
    }
  };

  if (editing || creating) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-10 md:px-6">
        <VendorDefinitionEditor
          key={creating ? 'create' : `edit-${editing?.vendorType ?? 'unknown'}`}
          definition={editing}
          isNew={creating}
          onSave={handleSave}
          onCancel={closeEditor}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-10 md:px-6">
      <div className="relative flex flex-wrap items-center justify-between gap-6 overflow-hidden rounded-3xl border border-border/50 bg-card/40 p-8 shadow-md backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.02]">
        {/* Decorative background gradients */}
        <div className="absolute -left-20 -top-20 h-64 w-64 rounded-full bg-amber-500/5 blur-[100px]" />
        <div className="absolute -right-20 -bottom-20 h-64 w-64 rounded-full bg-orange-500/5 blur-[100px]" />

        <div className="relative z-10 space-y-2">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 shadow-sm border border-amber-500/20">
              <Shapes className="h-6 w-6" />
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">
              类型管理 <span className="text-amber-500">中心</span>
            </h1>
          </div>
          <p className="max-w-2xl text-base text-muted-foreground">
            统一管理服务商类型的请求发送与字段提取配置，支持区域化编排与自动刷新。
          </p>
        </div>

        <div className="relative z-10 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-2xl border border-border/80 bg-background/50 p-1.5 backdrop-blur-md shadow-sm">
            <Button
              variant="ghost"
              size="sm"
              onClick={openImportModal}
              disabled={importing}
              className="rounded-xl h-9 px-4 text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              导入类型
            </Button>
            <Button 
              onClick={openCreateEditor}
              variant="default"
              size="sm"
              className="rounded-xl h-9 px-5 shadow-lg shadow-primary/20"
            >
              <Plus className="mr-2 h-4 w-4" />
              新增类型
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <AnimatedStatCard
          title="端点总数"
          value={stats.endpointTotal}
          icon={Server}
          glowClassName="bg-blue-500/10"
          iconWrapClassName="bg-blue-500/10 dark:bg-blue-500/15"
          iconClassName="text-blue-500"
          valueClassName="text-blue-600 dark:text-blue-400"
        />
        <AnimatedStatCard
          title="服务商总数"
          value={stats.vendorTotal}
          icon={Users}
          glowClassName="bg-emerald-500/10"
          iconWrapClassName="bg-emerald-500/10 dark:bg-emerald-500/15"
          iconClassName="text-emerald-500"
          valueClassName="text-emerald-600 dark:text-emerald-400"
        />
        <AnimatedStatCard
          title="服务商类型"
          value={stats.vendorTypeTotal}
          icon={Shapes}
          glowClassName="bg-purple-500/10"
          iconWrapClassName="bg-purple-500/10 dark:bg-purple-500/15"
          iconClassName="text-purple-500"
          valueClassName="text-purple-600 dark:text-purple-400"
        />
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {definitions.map((def) => (
          <Card key={def.vendorType} className="group overflow-hidden border-border/40 shadow-sm transition-all duration-300 hover:border-primary/40 hover:shadow-lg backdrop-blur-xl">
            <CardHeader className="border-b bg-muted/20 px-5 py-3.5">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1 flex items-center gap-2.5">
                  <div className="h-2 w-2 rounded-full bg-amber-500 shrink-0 shadow-[0_0_8px_rgba(245,158,11,0.4)]" />
                  <CardTitle className="truncate text-base font-bold tracking-tight">{def.displayName}</CardTitle>
                  <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60 bg-muted/50 px-1.5 py-0.5 rounded border border-border/40 shrink-0">
                    {def.vendorType}
                  </span>
                </div>
                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 shrink-0">
                  <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg hover:bg-primary/10 hover:text-primary" onClick={() => openEditEditor(def.vendorType)} title="编辑">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg hover:bg-blue-500/10 hover:text-blue-600" onClick={() => exportDefinition(def)} title="导出">
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={deleting === def.vendorType}
                    onClick={() => handleDelete(def.vendorType)}
                    className="h-7 w-7 rounded-lg hover:bg-red-500/10 hover:text-red-600"
                    title="删除"
                  >
                    {deleting === def.vendorType ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-5 space-y-3.5">
              {def.description && <p className="text-xs font-medium text-muted-foreground line-clamp-1 leading-relaxed opacity-80">{def.description}</p>}

              <div className="rounded-xl border border-border/40 bg-muted/5 p-3.5 space-y-2.5">
                <div className="flex flex-wrap gap-1.5">
                  <span className="inline-flex items-center rounded-md border border-border/60 bg-background/50 px-2 py-0.5 text-[9px] font-bold text-foreground/60 shadow-sm">供应商状态</span>
                  <span className="inline-flex items-center rounded-md border border-border/60 bg-background/50 px-2 py-0.5 text-[9px] font-bold text-foreground/60 shadow-sm">端点指标提取</span>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-md border px-2 py-0.5 text-[9px] font-bold shadow-sm transition-colors",
                      def.regionConfig.refreshTokenEnabled !== false
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-400'
                        : 'border-border/60 bg-muted/20 text-muted-foreground'
                    )}
                  >
                    刷新: {def.regionConfig.refreshTokenEnabled !== false ? 'ON' : 'OFF'}
                  </span>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-md border px-2 py-0.5 text-[9px] font-bold shadow-sm transition-colors",
                      def.regionConfig.dailyCheckinEnabled === true
                        ? 'border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-500/40 dark:bg-teal-500/10 dark:text-teal-400'
                        : 'border-border/60 bg-muted/20 text-muted-foreground'
                    )}
                  >
                    签到: {def.regionConfig.dailyCheckinEnabled === true ? 'ON' : 'OFF'}
                  </span>
                  <div className="w-full h-px bg-border/30 my-0.5" />
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/50 px-2 py-0.5 text-[9px] font-bold text-foreground/60 shadow-sm">
                    <Shapes className="h-2.5 w-2.5" />
                    中部: {def.regionConfig.middle.mode === 'token_usage' ? 'Token 使用量' : def.regionConfig.middle.mode === 'reset_date' ? '重置日期' : '（隐藏）'}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {definitions.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 py-12 text-muted-foreground">
          <ShieldAlert className="mb-2 h-8 w-8" />
          <p className="text-sm">暂无类型定义，请点击“新增类型”添加。</p>
        </div>
      )}

      {importModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm transition-all duration-300" onClick={closeImportModal}>
          <div className="w-full max-w-4xl overflow-hidden rounded-3xl border border-border/40 bg-background shadow-2xl animate-in fade-in zoom-in-95 duration-200" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border/40 bg-muted/20 px-6 py-5">
              <div className="space-y-1">
                <div className="text-xl font-bold tracking-tight text-foreground">导入服务商类型</div>
                <div className="text-xs font-medium text-muted-foreground">支持粘贴 JSON 或上传 JSON 文件（每次仅限导入单个类型）</div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <Button
                  variant={importMode === 'paste' ? 'default' : 'outline'}
                  size="sm"
                  className={cn("h-9 rounded-xl font-bold transition-all shadow-sm", importMode === 'paste' && "shadow-primary/20")}
                  onClick={handlePasteJsonClick}
                  disabled={importing}
                >
                  <Clipboard className="mr-2 h-4 w-4" />
                  从剪贴板粘贴
                </Button>

                <input
                  ref={importFileInputRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={handleImportFileSelected}
                />
                <Button
                  variant={importMode === 'file' ? 'default' : 'outline'}
                  size="sm"
                  className={cn("h-9 rounded-xl font-bold transition-all shadow-sm", importMode === 'file' && "shadow-primary/20")}
                  onClick={() => importFileInputRef.current?.click()}
                  disabled={importing}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  上传文件
                </Button>
                <div className="h-6 w-px bg-border/60 mx-1" />
                <button
                  type="button"
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
                  onClick={closeImportModal}
                  disabled={importing}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="space-y-4 px-6 py-6">
              <div className="overflow-hidden rounded-2xl border border-border/60 bg-background/50 shadow-inner">
                <div className="border-b border-border/40 bg-muted/30 px-4 py-3 text-[10px] font-bold tracking-widest text-muted-foreground uppercase flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-primary/60" />
                  JSON 内容预览区
                </div>
                <textarea
                  value={importJsonDraft}
                  onChange={(event) => setImportJsonDraft(event.target.value)}
                  placeholder={importMode === 'paste' ? '请在此处粘贴导出的 JSON 配置文件...' : '已选择文件，JSON 内容将展示在此处。'}
                  className="h-[48vh] w-full resize-none bg-transparent px-5 py-4 font-mono text-xs leading-relaxed text-foreground/90 outline-none transition-colors focus:bg-background scrollbar-hide"
                  disabled={importing}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-border/40 bg-muted/20 px-6 py-5">
              <Button variant="outline" onClick={closeImportModal} disabled={importing} className="rounded-xl h-10 px-6 font-bold">
                取消
              </Button>
              <Button onClick={confirmImport} disabled={importing} className="rounded-xl h-10 px-8 font-bold shadow-lg shadow-primary/20">
                {importing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    正在导入...
                  </>
                ) : '确认导入'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {exportPreview && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm transition-all duration-300" onClick={() => setExportPreview(null)}>
          <div className="w-full max-w-4xl overflow-hidden rounded-3xl border border-border/40 bg-background shadow-2xl animate-in fade-in zoom-in-95 duration-200" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border/40 bg-muted/20 px-6 py-5">
              <div className="space-y-1">
                <div className="text-xl font-bold tracking-tight text-foreground">导出服务商类型</div>
                <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
                  目标类型标识: <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-amber-600 border border-amber-500/20">{exportPreview.vendorType}</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="outline" size="sm" className="h-9 rounded-xl font-bold shadow-sm" onClick={copyExportContent}>
                  {exportCopied ? <Check className="mr-2 h-4 w-4 text-emerald-500" /> : <Copy className="mr-2 h-4 w-4" />}
                  复制 JSON
                </Button>
                <Button variant="default" size="sm" className="h-9 rounded-xl font-bold shadow-lg shadow-primary/20" onClick={downloadExportFile}>
                  <Download className="mr-2 h-4 w-4" />
                  下载 .json 文件
                </Button>
                <div className="h-6 w-px bg-border/60 mx-1" />
                <button
                  type="button"
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
                  onClick={() => setExportPreview(null)}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            
            <div className="p-6">
              <div className="overflow-hidden rounded-2xl border border-border/60 bg-background/50 shadow-inner">
                <div className="flex items-center justify-between border-b border-border/40 bg-muted/30 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-blue-500" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">导出内容预览</span>
                  </div>
                  <span className="rounded-lg bg-blue-500/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 border border-blue-500/20">
                    JSON Format
                  </span>
                </div>
                <div className="relative flex">
                  <div className="w-1 shrink-0 bg-blue-500/20" />
                  <div className="max-h-[60vh] flex-1 overflow-auto bg-transparent p-5 scrollbar-hide">
                    <pre className="font-mono text-[11px] leading-relaxed text-foreground/80 whitespace-pre-wrap break-all selection:bg-primary/20">
                      {exportPreview.content}
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
