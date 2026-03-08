'use client';

import {
  ArrowLeft,
  CircleCheckBig,
  Clock,
  ExternalLink,
  KeyRound,
  Loader2,
  PieChart,
  Plus,
  Pencil,
  RefreshCcw,
  Save,
  Settings2,
  Shapes,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import Editor, { type Monaco, type OnMount } from '@monaco-editor/react';
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import type * as MonacoTypes from 'monaco-editor';

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

type RegionDailyCheckinConfig = RequestRegionBase & {
  dateField?: string | null;
  awardedField?: string | null;
  awardedFormula?: FormulaConfig;
};

type VendorRegionConfig = {
  version: 1;
  endpointTotalMode?: 'independent_request' | 'sum_from_parts' | 'manual_total';
  refreshTokenEnabled?: boolean;
  refreshToken?: RequestRegionBase | null;
  dailyCheckinEnabled?: boolean;
  dailyCheckin?: RegionDailyCheckinConfig | null;
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
    mode: MiddleDisplayMode;
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
  strategies?: unknown[];
  regionConfig: VendorRegionConfig;
  envVars?: VendorEnvVarDefinition[];
  createdAt: string;
  updatedAt: string;
};

type DisplaySection =
  | 'vendor_remaining'
  | 'vendor_used'
  | 'endpoint_remaining'
  | 'endpoint_used'
  | 'endpoint_total'
  | 'daily_checkin'
  | 'refresh_token'
  | 'middle';
type MiddleDisplayMode = 'none' | 'token_usage' | 'reset_date';

function defaultRequestRegionBase(): RequestRegionBase {
  return {
    auth: 'bearer',
    method: 'GET',
    path: '/',
    queryParams: {},
    requestHeaders: {},
    requestBody: {},
    autoHandle403Intercept: true,
    refreshOnUnauth: false,
  };
}

function defaultMetricRegion(): RegionMetricConfig {
  return {
    ...defaultRequestRegionBase(),
    field: null,
    formula: null,
  };
}

function defaultTokenUsageRegion(): RegionTokenUsageConfig {
  return {
    ...defaultRequestRegionBase(),
    usedField: null,
    remainingField: null,
    usedFormula: null,
    remainingFormula: null,
  };
}

function defaultResetDateRegion(): RegionResetDateConfig {
  return {
    ...defaultRequestRegionBase(),
    resetField: null,
  };
}

function defaultDailyCheckinRegion(): RegionDailyCheckinConfig {
  return {
    ...defaultRequestRegionBase(),
    method: 'POST',
    path: '/api/user/checkin',
    dateField: null,
    awardedField: null,
    awardedFormula: { type: 'direct' },
  };
}

function defaultRefreshResponseMappings(): RefreshResponseMapping[] {
  return [
    {
      field: 'access_token',
      envVarKey: 'AccessToken',
      formula: { type: 'direct' },
    },
    {
      field: 'refresh_token',
      envVarKey: 'RefreshToken',
      formula: { type: 'direct' },
    },
  ];
}

function defaultRefreshTokenRegion(): RequestRegionBase {
  return {
    ...defaultRequestRegionBase(),
    method: 'POST',
    path: '/api/auth/refresh',
    requestBody: {
      refresh_token: '$cookieValue',
    },
    refreshResponseMappings: defaultRefreshResponseMappings(),
    refreshOnUnauth: false,
  };
}

function emptyRegionConfig(): VendorRegionConfig {
  return {
    version: 1,
    endpointTotalMode: 'independent_request',
    refreshTokenEnabled: true,
    refreshToken: defaultRefreshTokenRegion(),
    dailyCheckinEnabled: false,
    dailyCheckin: defaultDailyCheckinRegion(),
    endpointMetricModes: {
      endpoint_remaining: 'independent_request',
      endpoint_used: 'independent_request',
    },
    aggregation: {
      vendor_remaining: 'independent_request',
      vendor_used: 'endpoint_sum',
    },
    regions: {
      vendor_remaining: defaultMetricRegion(),
      vendor_used: defaultMetricRegion(),
      endpoint_remaining: defaultMetricRegion(),
      endpoint_used: defaultMetricRegion(),
      endpoint_total: defaultMetricRegion(),
    },
    middle: {
      mode: 'token_usage',
      token_usage: defaultTokenUsageRegion(),
      reset_date: defaultResetDateRegion(),
    },
  };
}

type TemplateVariable = {
  key: string;
  label: string;
  detail: string;
  example: string;
};
type JsonFieldType = 'query' | 'headers' | 'body';
type RequestEditorTab = 'params' | 'body' | 'headers';
type RequestJsonValidationState = {
  hasError: boolean;
  issues: string[];
};

const BUILTIN_TEMPLATE_VARIABLES: TemplateVariable[] = [
  {
    key: '$apiKey',
    label: 'APIKey',
    detail: '当前端点在 Claude-Code-Hub 中保存的 API Key 原始值，可用于鉴权头或请求参数拼接。',
    example: '"Authorization": "Bearer $apiKey"',
  },
  {
    key: '$oneYearAgoDate',
    label: '一年前日期',
    detail: '以系统当前日期为基准向前回溯一年，输出格式为 YYYY-MM-DD。',
    example: '"start_date": "$oneYearAgoDate"',
  },
  {
    key: '$todayDate',
    label: '今日日期',
    detail: '系统当前日期，输出格式为 YYYY-MM-DD。',
    example: '"date": "$todayDate"',
  },
  {
    key: '$tomorrowDate',
    label: '次日日期',
    detail: '系统当前日期加一天后的日期，输出格式为 YYYY-MM-DD。',
    example: '"end_date": "$tomorrowDate"',
  },
];

type BuiltinEnvVarMeta = {
  token: string;
  englishName: string;
  chineseName: string;
  autoDescription: string;
};

const BUILTIN_ENV_VAR_META: BuiltinEnvVarMeta[] = [
  {
    token: '$apiKey',
    englishName: 'apiKey',
    chineseName: 'APIKey',
    autoDescription: '提取来源：Claude-Code-Hub 数据库中当前端点的 API Key 字段；输出值为原始字符串，不自动附加 Bearer 前缀。',
  },
  {
    token: '$oneYearAgoDate',
    englishName: 'oneYearAgoDate',
    chineseName: '一年前日期',
    autoDescription: '计算规则：以系统当前日期减一年；输出格式为 YYYY-MM-DD。',
  },
  {
    token: '$todayDate',
    englishName: 'todayDate',
    chineseName: '今天日期',
    autoDescription: '计算规则：取系统当前日期；输出格式为 YYYY-MM-DD。',
  },
  {
    token: '$tomorrowDate',
    englishName: 'tomorrowDate',
    chineseName: '明天日期',
    autoDescription: '计算规则：在系统当前日期基础上加一天；输出格式为 YYYY-MM-DD。',
  },
];

const COMMON_HEADERS = [
  'Authorization',
  'Proxy-Authorization',
  'Content-Type',
  'Accept',
  'Accept-Encoding',
  'Accept-Language',
  'User-Agent',
  'Origin',
  'Referer',
  'Cookie',
  'Cache-Control',
  'Pragma',
  'Host',
  'Connection',
  'X-Requested-With',
  'X-API-Key',
  'X-Request-ID',
  'X-Forwarded-For',
  'X-Forwarded-Proto',
  'X-Real-IP',
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
  'sec-fetch-site',
  'sec-fetch-mode',
  'sec-fetch-dest',
];

const COMMON_QUERY_PARAMS = [
  'start_date',
  'end_date',
  'date',
  'from',
  'to',
  'page',
  'limit',
  'offset',
  'user_id',
  'uid',
  'key',
  'model',
];

const COMMON_BODY_FIELDS = [
  'refresh_token',
  'access_token',
  'grant_type',
  'client_id',
  'client_secret',
  'scope',
  'model',
  'uid',
  'user_id',
];

const RUNTIME_TEMPLATE_VARIABLE_KEYS = [
  'apiKey',
  'apiKeyToken',
  'cookieValue',
  'userId',
  'todayStartMs',
  'tomorrowStartMs',
  'oneYearAgoStartMs',
  'todayDate',
  'tomorrowDate',
  'oneYearAgoDate',
  'fiveYearsAgoStartMs',
  'fiveYearsAgoDate',
] as const;

const TEMPLATE_VARIABLE_PATTERN = /\$([A-Za-z_][A-Za-z0-9_]*)/g;

let jsonTemplateCompletionRegistered = false;
const templateVariablesByModel = new Map<string, TemplateVariable[]>();
const fieldTypeByModel = new Map<string, JsonFieldType>();

function normalizeEnvVarKey(value: string): string {
  return value.trim().replace(/^\$+/, '');
}

const TOTAL_AMOUNT_ENV_KEY = 'totalAmount';

function isTotalAmountEnvKey(value: string | null | undefined): boolean {
  if (!value) return false;
  return normalizeEnvVarKey(value).toLowerCase() === TOTAL_AMOUNT_ENV_KEY.toLowerCase();
}

function createTotalAmountEnvVarDefinition(): VendorEnvVarDefinition {
  return {
    key: TOTAL_AMOUNT_ENV_KEY,
    label: '端点总额',
    scope: 'endpoint',
    meaning: '当前为「手动设置」模式，需要在各个端点中手动独立设置环境变量 totalAmount 作为总额。',
    optional: false,
    defaultValue: null,
  };
}

function buildTemplateVariables(envVars: VendorEnvVarDefinition[]): TemplateVariable[] {
  const result: TemplateVariable[] = [...BUILTIN_TEMPLATE_VARIABLES];
  const seen = new Set(result.map((item) => item.key.toLowerCase()));
  for (const envVar of envVars) {
    const key = normalizeEnvVarKey(envVar.key);
    if (!key) continue;
    const token = `$${key}`;
    if (seen.has(token.toLowerCase())) continue;
    seen.add(token.toLowerCase());
    result.push({
      key: token,
      label: `${envVar.label}（自定义）`,
      detail: `${envVar.label}${
        envVar.meaning && envVar.meaning.trim() ? `：${envVar.meaning.trim()}` : ''
      }${envVar.optional ? `；选填${envVar.defaultValue && envVar.defaultValue.trim() ? `；默认值=${envVar.defaultValue.trim()}` : ''}` : ''}`,
      example: `"${key}": "$${key}"`,
    });
  }
  return result;
}

function normalizeJsonErrorMessage(message: string | null | undefined): string {
  const raw = (message ?? '').trim();
  if (!raw) return 'JSON 格式错误，请检查括号、引号与逗号';
  return raw.startsWith('JSON') ? raw : `JSON 格式错误：${raw}`;
}

function validateJsonTextContent(value: string): string | null {
  const text = value.trim();
  if (!text) {
    return 'JSON 格式错误：内容不能为空';
  }
  try {
    JSON.parse(text);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'JSON 格式错误';
    return normalizeJsonErrorMessage(message);
  }
}

function buildAllowedTemplateVariableKeySet(envVars: VendorEnvVarDefinition[]): Set<string> {
  const keys = new Set<string>(RUNTIME_TEMPLATE_VARIABLE_KEYS);
  for (const item of envVars) {
    const key = normalizeEnvVarKey(item.key);
    if (!key) continue;
    keys.add(key);
  }
  return keys;
}

function collectUnknownTemplateVariablesFromJsonValue(
  value: unknown,
  allowedKeys: Set<string>,
  unknownTokens: Set<string>,
): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(TEMPLATE_VARIABLE_PATTERN)) {
      const key = match[1];
      if (!allowedKeys.has(key)) {
        unknownTokens.add(`$${key}`);
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectUnknownTemplateVariablesFromJsonValue(item, allowedKeys, unknownTokens);
    }
    return;
  }

  if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) {
      collectUnknownTemplateVariablesFromJsonValue(child, allowedKeys, unknownTokens);
    }
  }
}

function collectUndefinedTemplateVariableIssues(
  regionConfig: VendorRegionConfig,
  envVars: VendorEnvVarDefinition[],
): string[] {
  const allowedKeys = buildAllowedTemplateVariableKeySet(envVars);
  const jsonFieldLabels: Array<{
    key: 'queryParams' | 'requestHeaders' | 'requestBody';
    label: string;
  }> = [
    { key: 'queryParams', label: 'Params' },
    { key: 'requestHeaders', label: 'Headers' },
    { key: 'requestBody', label: 'Body' },
  ];

  const vendorRemainingAggregation = regionConfig.aggregation?.vendor_remaining ?? 'independent_request';
  const vendorUsedAggregation = regionConfig.aggregation?.vendor_used ?? 'endpoint_sum';
  const endpointTotalMode = regionConfig.endpointTotalMode ?? 'independent_request';
  const endpointRemainingMode = regionConfig.endpointMetricModes?.endpoint_remaining ?? 'independent_request';
  const endpointUsedMode = regionConfig.endpointMetricModes?.endpoint_used ?? 'independent_request';

  const requestConfigs: Array<{ sectionLabel: string; config: RequestRegionBase | null | undefined }> = [];

  if (vendorRemainingAggregation === 'independent_request') {
    requestConfigs.push({ sectionLabel: '供应商余额', config: regionConfig.regions.vendor_remaining });
  }
  if (vendorUsedAggregation === 'independent_request') {
    requestConfigs.push({ sectionLabel: '供应商已用', config: regionConfig.regions.vendor_used });
  }
  if (endpointRemainingMode === 'independent_request') {
    requestConfigs.push({ sectionLabel: '端点余额', config: regionConfig.regions.endpoint_remaining });
  }
  if (endpointUsedMode === 'independent_request') {
    requestConfigs.push({ sectionLabel: '端点已用', config: regionConfig.regions.endpoint_used });
  }
  if (endpointTotalMode === 'independent_request') {
    requestConfigs.push({ sectionLabel: '端点总额', config: regionConfig.regions.endpoint_total });
  }
  if (regionConfig.refreshTokenEnabled !== false && regionConfig.refreshToken) {
    requestConfigs.push({ sectionLabel: '刷新令牌', config: regionConfig.refreshToken });
  }
  if (regionConfig.dailyCheckinEnabled && regionConfig.dailyCheckin) {
    requestConfigs.push({ sectionLabel: '每日签到', config: regionConfig.dailyCheckin });
  }
  if (regionConfig.middle.mode === 'token_usage') {
    requestConfigs.push({ sectionLabel: '中部信息条（Token）', config: regionConfig.middle.token_usage });
  }
  if (regionConfig.middle.mode === 'reset_date') {
    requestConfigs.push({ sectionLabel: '中部信息条（重置时间）', config: regionConfig.middle.reset_date });
  }

  const issues: string[] = [];
  for (const item of requestConfigs) {
    if (!item.config) continue;
    for (const field of jsonFieldLabels) {
      const jsonValue = item.config[field.key];
      if (jsonValue === null || jsonValue === undefined) continue;
      const unknownTokens = new Set<string>();
      collectUnknownTemplateVariablesFromJsonValue(jsonValue, allowedKeys, unknownTokens);
      if (unknownTokens.size === 0) continue;
      issues.push(`${item.sectionLabel} ${field.label}：${Array.from(unknownTokens).join('、')}`);
    }
  }

  return issues;
}

function ensureJsonTemplateCompletion(monaco: Monaco): void {
  if (jsonTemplateCompletionRegistered) return;
  jsonTemplateCompletionRegistered = true;

  monaco.languages.registerCompletionItemProvider('json', {
    triggerCharacters: ['$', '"', '-', '_'],
    provideCompletionItems(
      model: MonacoTypes.editor.ITextModel,
      position: MonacoTypes.Position,
      _context: MonacoTypes.languages.CompletionContext,
    ) {
      const modelKey = model.uri.toString();
      const templateVariables = templateVariablesByModel.get(modelKey) ?? BUILTIN_TEMPLATE_VARIABLES;
      const fieldType = fieldTypeByModel.get(modelKey) ?? 'body';
      const lineBeforeCursor = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      const match = lineBeforeCursor.match(/\$[A-Za-z0-9_]*$/);
      const word = model.getWordUntilPosition(position);
      const wordRange = new monaco.Range(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn,
      );

      const envSuggestions = templateVariables.map((item, idx) => ({
        label: item.key,
        kind: monaco.languages.CompletionItemKind.Color, // Use color or custom icon map to signify variables nicely
        insertText: item.key,
        range: wordRange,
        detail: item.detail,
        documentation: {
          value: `${item.detail}\n\n示例：\`${item.example}\``,
        },
        sortText: `0-env-${idx}`,
      }));

      if (match) {
        const typed = match[0].toLowerCase();
        const startColumn = position.column - match[0].length;
        const range = new monaco.Range(position.lineNumber, startColumn, position.lineNumber, position.column);
        return {
          suggestions: envSuggestions
            .filter((item) => item.label.toLowerCase().startsWith(typed))
            .map((item) => ({ ...item, range })),
        };
      }

      const commonKeys =
        fieldType === 'headers'
          ? COMMON_HEADERS
          : fieldType === 'query'
            ? COMMON_QUERY_PARAMS
            : COMMON_BODY_FIELDS;

      const keySuggestions = commonKeys.map((key, idx) => ({
        label: key,
        kind: monaco.languages.CompletionItemKind.Keyword,
        insertText: key,
        range: wordRange,
        detail: fieldType === 'headers' ? '常用 Header 键' : '常用请求字段',
        sortText: `1-key-${idx}`,
      }));

      return { suggestions: [...envSuggestions, ...keySuggestions] };
    },
  });
}

function formulaSummary(field: string | null | undefined, formula: FormulaConfig): string {
  if (!field) return '-';
  if (!formula || formula.type === 'direct') return `${field}`;
  return `${field} / ${formula.divisor ?? 1}`;
}

function InputField({ label, value, onChange, placeholder, disabled, mono }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          "h-12 w-full rounded-2xl border border-border/60 bg-muted/10 px-5 text-sm font-medium outline-none transition-all focus:border-primary/40 focus:bg-background focus:ring-4 focus:ring-primary/10 shadow-sm disabled:opacity-50",
          mono && "font-mono"
        )}
      />
    </div>
  );
}

function normalizeUrlReplacementRules(
  rules: UrlReplacementRule[] | null | undefined,
): UrlReplacementRule[] {
  if (!Array.isArray(rules)) return [];
  return rules
    .map((item) => ({
      search: typeof item?.search === 'string' ? item.search.trim() : '',
      replace: typeof item?.replace === 'string' ? item.replace : '',
    }))
    .filter((item) => item.search.length > 0);
}

function RequestPathField({
  label,
  value,
  onChangePath,
  replacements,
  onChangeReplacements,
  placeholder,
}: {
  label: string;
  value: string;
  onChangePath: (value: string) => void;
  replacements?: UrlReplacementRule[];
  onChangeReplacements: (rules: UrlReplacementRule[] | undefined) => void;
  placeholder?: string;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draftRules, setDraftRules] = useState<UrlReplacementRule[]>([]);

  const openDialog = () => {
    setDraftRules(normalizeUrlReplacementRules(replacements));
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
  };

  const saveRules = () => {
    const normalized = draftRules
      .map((item) => ({
        search: item.search.trim(),
        replace: item.replace,
      }))
      .filter((item) => item.search.length > 0 || item.replace.trim().length > 0);

    for (let i = 0; i < normalized.length; i += 1) {
      if (!normalized[i].search) {
        toast.warning('URL替换规则无效', `第 ${i + 1} 条规则的匹配内容不能为空`);
        return;
      }
    }

    onChangeReplacements(normalized.length > 0 ? normalized : undefined);
    setDialogOpen(false);
  };

  return (
    <>
      <div className="space-y-2">
        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={value}
            onChange={(e) => onChangePath(e.target.value)}
            placeholder={placeholder}
            className="w-full h-12 min-h-12 py-0 w-full rounded-2xl border border-border/60 bg-muted/10 px-5 text-sm font-medium font-mono outline-none transition-all focus:border-primary/40 focus:bg-background focus:ring-4 focus:ring-primary/10 shadow-sm disabled:opacity-50"
          />
          <button
            type="button"
            onClick={openDialog}
            className="inline-flex h-12 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-background px-4 text-sm font-bold text-muted-foreground shadow-sm transition-all hover:border-primary/40 hover:bg-primary/5 hover:text-primary active:scale-95"
          >
            URL替换
            {normalizeUrlReplacementRules(replacements).length > 0 ? (
              <span className="ml-2 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary border border-primary/20">
                {normalizeUrlReplacementRules(replacements).length}
              </span>
            ) : null}
          </button>
        </div>
      </div>

      {dialogOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm transition-all duration-300">
          <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-border/40 bg-background shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-border/40 bg-muted/20 px-6 py-5">
              <div className="text-lg font-bold tracking-tight">URL 替换规则</div>
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
                onClick={closeDialog}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 px-6 py-6 max-h-[60vh] overflow-y-auto scrollbar-hide">
              <div className="flex flex-col gap-4 rounded-2xl border border-border/40 bg-muted/10 p-4 sm:flex-row sm:items-center sm:justify-between shadow-inner">
                <span className="text-sm font-medium text-muted-foreground leading-relaxed">
                  {draftRules.length === 0
                    ? '目前暂无规则，请点击右侧新增规则，按顺序优先级从高到低。'
                    : '请添加规则，将按顺序从高到低执行替换。'}
                </span>
                <button
                  type="button"
                  onClick={() => setDraftRules((current) => [...current, { search: '', replace: '' }])}
                  className="inline-flex shrink-0 items-center rounded-xl border border-border/60 bg-background px-4 py-2.5 text-sm font-bold text-foreground shadow-sm transition-all hover:border-primary/40 hover:bg-primary/5 hover:text-primary active:scale-95"
                >
                  <Plus className="h-4 w-4 mr-1.5" />
                  新增规则
                </button>
              </div>
              <div className="space-y-3">
                {draftRules.length > 0 ? (
                  draftRules.map((rule, index) => (
                    <div key={`url-replace-rule-${index}`} className="flex flex-wrap gap-2 md:grid md:grid-cols-[60px_minmax(0,1fr)_minmax(0,1fr)_48px] items-center p-2 rounded-2xl border border-border/40 bg-background shadow-sm hover:border-primary/20 transition-colors">
                      <div className="flex h-12 w-full md:w-auto items-center justify-center rounded-xl bg-muted/30 text-xs font-bold text-muted-foreground border border-border/40">
                        #{index + 1}
                      </div>
                      <input
                        type="text"
                        value={rule.search}
                        onChange={(e) =>
                          setDraftRules((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, search: e.target.value } : item,
                            ),
                          )
                        }
                        placeholder="匹配内容（必填）"
                        className="w-full h-12 min-h-12 py-0 w-full rounded-2xl border border-border/60 bg-muted/10 px-5 text-sm font-medium outline-none transition-all focus:border-primary/40 focus:bg-background focus:ring-4 focus:ring-primary/10"
                      />
                      <input
                        type="text"
                        value={rule.replace}
                        onChange={(e) =>
                          setDraftRules((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, replace: e.target.value } : item,
                            ),
                          )
                        }
                        placeholder="替换为（可空）"
                        className="w-full h-12 min-h-12 py-0 w-full rounded-2xl border border-border/60 bg-muted/10 px-5 text-sm font-medium outline-none transition-all focus:border-primary/40 focus:bg-background focus:ring-4 focus:ring-primary/10"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setDraftRules((current) => current.filter((_, itemIndex) => itemIndex !== index))
                        }
                        className="flex h-12 w-full md:w-12 shrink-0 items-center justify-center rounded-xl border border-border/40 bg-muted/10 text-muted-foreground transition-all hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-500 active:scale-95"
                        title="删除规则"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))
                ) : null}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-border/40 bg-muted/20 px-6 py-5">
              <Button type="button" variant="outline" onClick={closeDialog} className="rounded-xl h-11 px-6 font-bold">
                取消
              </Button>
              <Button type="button" onClick={saveRules} className="rounded-xl h-11 px-8 font-bold shadow-lg shadow-primary/20">
                确认保存
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function RequestAutoHandleSwitches({
  config,
  onChange,
  allowAuto401,
}: {
  config: RequestRegionBase;
  onChange: (next: RequestRegionBase) => void;
  allowAuto401: boolean;
}) {
  const auto403Enabled = config.autoHandle403Intercept !== false;
  const auto401Enabled = Boolean(config.refreshOnUnauth);

  return (
    <div className="w-full md:w-[320px] space-y-3 rounded-2xl border border-border/60 bg-muted/10 px-5 py-3 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <span className="text-left text-xs font-bold uppercase tracking-wider text-muted-foreground">自动处理 403 拦截</span>
        <button
          type="button"
          role="switch"
          aria-checked={auto403Enabled}
          data-state={auto403Enabled ? 'checked' : 'unchecked'}
          onClick={() =>
            onChange({
              ...config,
              autoHandle403Intercept: !auto403Enabled,
            })
          }
          className="peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-input focus-visible:border-ring focus-visible:ring-ring/50 dark:data-[state=unchecked]:bg-input/80 inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:ring-[3px] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span
            data-state={auto403Enabled ? 'checked' : 'unchecked'}
            className="bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0"
          />
        </button>
      </div>
      <div className="h-px bg-border/40" />
      <div className="flex items-center justify-between gap-4">
        <span className="text-left text-xs font-bold uppercase tracking-wider text-muted-foreground">自动处理 401 过期</span>
        <button
          type="button"
          role="switch"
          aria-checked={auto401Enabled}
          data-state={auto401Enabled ? 'checked' : 'unchecked'}
          onClick={() => {
            if (!auto401Enabled && !allowAuto401) {
              toast.warning('无法开启自动处理401过期', '请先启用刷新令牌功能');
              return;
            }
            onChange({
              ...config,
              refreshOnUnauth: !auto401Enabled,
            });
          }}
          className="peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-input focus-visible:border-ring focus-visible:ring-ring/50 dark:data-[state=unchecked]:bg-input/80 inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:ring-[3px] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span
            data-state={auto401Enabled ? 'checked' : 'unchecked'}
            className="bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0"
          />
        </button>
      </div>
    </div>
  );
}

function FormulaEditor({ label, formula, onChange }: {
  label: string;
  formula: FormulaConfig;
  onChange: (f: FormulaConfig) => void;
}) {
  const type = formula?.type ?? 'direct';
  const divisor = formula?.divisor ?? 1;

  return (
    <div className="flex items-end gap-3">
      <div className="flex-1 space-y-2">
        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label} 公式</label>
        <Select value={type} onValueChange={(v) => onChange(v === 'direct' ? { type: 'direct' } : { type: 'divide', divisor })}>
          <SelectTrigger className="w-full h-12 min-h-12 py-0 rounded-2xl border-border/60 bg-muted/10 px-5 font-bold focus:ring-primary/20"><SelectValue /></SelectTrigger>
          <SelectContent className="rounded-xl border-border/40 shadow-xl">
            <SelectItem value="direct" className="rounded-lg font-medium">直接使用</SelectItem>
            <SelectItem value="divide" className="rounded-lg font-medium">除以系数</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {type === 'divide' && (
        <div className="w-28 space-y-2 animate-in fade-in slide-in-from-left-2">
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">除数</label>
          <input
            type="number"
            value={divisor}
            onChange={(e) => onChange({ type: 'divide', divisor: Number(e.target.value) || 1 })}
            className="w-full h-12 min-h-12 py-0 w-full rounded-2xl border border-border/60 bg-muted/10 px-4 text-sm font-bold outline-none transition-all focus:border-primary/40 focus:bg-background focus:ring-4 focus:ring-primary/10 shadow-sm"
          />
        </div>
      )}
    </div>
  );
}

function JsonTemplateField({
  label,
  value,
  onChangeText,
  placeholder,
  templateVariables,
  fieldType,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  templateVariables: TemplateVariable[];
  fieldType: JsonFieldType;
}) {
  const editorRef = useRef<MonacoTypes.editor.IStandaloneCodeEditor | null>(null);
  const modelKeyRef = useRef<string | null>(null);
  const { theme, resolvedTheme } = useTheme();
  const [parseError, setParseError] = useState<string | null>(null);
  const formatJson = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;

    const raw = model.getValue();
    const trimmed = raw.trim();
    if (!trimmed) {
      setParseError(null);
      return;
    }

    try {
      const parsed = JSON.parse(trimmed);
      const formatted = JSON.stringify(parsed, null, 2);
      if (formatted !== raw) {
        model.setValue(formatted);
        onChangeText(formatted);
      }
      setParseError(null);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'JSON 格式错误';
      setParseError(normalizeJsonErrorMessage(msg));
    }
  };

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    ensureJsonTemplateCompletion(monaco);
    const model = editor.getModel();
    if (model) {
      const modelKey = model.uri.toString();
      modelKeyRef.current = modelKey;
      templateVariablesByModel.set(modelKey, templateVariables);
      fieldTypeByModel.set(modelKey, fieldType);
    }

    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      allowComments: false,
      enableSchemaRequest: false,
    });

    editor.onDidBlurEditorText(() => {
      formatJson();
    });

    // Force Monaco suggest widget to stay below cursor (never flip to "above").
    const domNode = editor.getDomNode();
    if (domNode) {
      let rafId = 0;
      const findSuggestWidget = (): HTMLElement | null => {
        return (
          (domNode.querySelector('.editor-widget.suggest-widget') as HTMLElement | null)
          ?? (domNode.querySelector('.suggest-widget') as HTMLElement | null)
        );
      };

      const forceSuggestBelowCursor = () => {
        const widget = findSuggestWidget();
        if (!widget || widget.offsetParent === null) {
          return;
        }

        const position = editor.getPosition();
        if (!position) {
          return;
        }

        const cursor = editor.getScrolledVisiblePosition(position);
        if (!cursor) {
          return;
        }

        const layout = editor.getLayoutInfo();
        const widgetHeight = Math.max(widget.offsetHeight, 0);
        const spacing = 6;
        const maxTop = Math.max(0, layout.height - widgetHeight - 4);
        const nextTop = Math.max(0, Math.min(cursor.top + cursor.height + spacing, maxTop));

        widget.classList.add('force-below');
        widget.classList.remove('above');
        widget.classList.add('below');
        widget.style.setProperty('top', `${Math.round(nextTop)}px`, 'important');
        widget.style.setProperty('bottom', 'auto', 'important');
        widget.style.setProperty('transform', 'none', 'important');
      };

      const scheduleForceBelow = () => {
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(forceSuggestBelowCursor);
      };

      const observer = new MutationObserver(() => {
        scheduleForceBelow();
      });
      observer.observe(domNode, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class', 'style'],
      });

      const cursorDisposable = editor.onDidChangeCursorPosition(scheduleForceBelow);
      const scrollDisposable = editor.onDidScrollChange(scheduleForceBelow);
      const layoutDisposable = editor.onDidLayoutChange(scheduleForceBelow);
      const modelDisposable = editor.onDidChangeModelContent(scheduleForceBelow);

      editor.onDidDispose(() => {
        observer.disconnect();
        cursorDisposable.dispose();
        scrollDisposable.dispose();
        layoutDisposable.dispose();
        modelDisposable.dispose();
        cancelAnimationFrame(rafId);
      });

      scheduleForceBelow();
    }
  };

  useEffect(() => {
    const modelKey = modelKeyRef.current;
    if (!modelKey) return;
    templateVariablesByModel.set(modelKey, templateVariables);
    fieldTypeByModel.set(modelKey, fieldType);
  }, [templateVariables, fieldType]);

  useEffect(
    () => () => {
      const modelKey = modelKeyRef.current;
      if (!modelKey) return;
      templateVariablesByModel.delete(modelKey);
      fieldTypeByModel.delete(modelKey);
    },
    [],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold uppercase tracking-wider text-foreground/80 flex items-center gap-2">
          <div className="h-3 w-1 rounded-full bg-primary/60" />
          {label}
        </label>
        <Button type="button" variant="outline" size="sm" className="h-8 px-4 text-xs font-bold rounded-lg shadow-sm hover:border-primary/40 hover:bg-primary/5 hover:text-primary transition-all active:scale-95" onClick={formatJson}>
          <Sparkles className="mr-1.5 h-3.5 w-3.5 text-primary" />
          美化 JSON
        </Button>
      </div>
      <div className="relative rounded-2xl overflow-hidden border-2 border-border/60 bg-background/50 shadow-inner focus-within:border-primary/40 focus-within:ring-4 focus-within:ring-primary/10 transition-all duration-300">
        <div className="absolute left-0 top-0 bottom-0 w-[42px] bg-muted/30 border-r border-border/40 z-0" />
        <div className="relative z-10">
          <Editor
            height="320px"
            defaultLanguage="json"
            language="json"
            value={value}
            onMount={handleMount}
            onChange={(nextValue) => {
              onChangeText(nextValue ?? '');
            }}
            onValidate={(markers) => {
              if (!markers || markers.length === 0) {
                setParseError(null);
                return;
              }
              setParseError(normalizeJsonErrorMessage(markers[0]?.message));
            }}
            options={{
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              wordWrap: 'on',
              wrappingIndent: 'indent',
              fontSize: 13,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              lineHeight: 1.6,
              lineNumbers: 'on',
              lineNumbersMinChars: 3,
              glyphMargin: false,
              folding: true,
              renderLineHighlight: 'all',
              tabSize: 2,
              insertSpaces: true,
              padding: { top: 16, bottom: parseError ? 200 : 160 },
              formatOnPaste: true,
              formatOnType: true,
              quickSuggestions: { other: true, comments: false, strings: true },
              suggestOnTriggerCharacters: true,
              acceptSuggestionOnEnter: 'smart',
              acceptSuggestionOnCommitCharacter: false,
              snippetSuggestions: 'inline',
              tabCompletion: 'on',
              fixedOverflowWidgets: false,
              suggest: {
                showIcons: true,
                showStatusBar: false,
                preview: true,
                previewMode: 'subwordSmart',
              },
              placeholder,
              scrollbar: {
                verticalScrollbarSize: 8,
                horizontalScrollbarSize: 8,
              },
            }}
            theme={resolvedTheme === "dark" ? "vs-dark" : "vs-light"}
          />
        </div>
        {/*
          keep an invisible textarea-shaped overlay for consistent spacing with
          the rest of the form sections.
        */}
        <textarea
          value={value}
          readOnly
          aria-hidden="true"
          className="sr-only"
        />
        {parseError ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 border-t-2 border-red-200/80 bg-red-50/95 backdrop-blur-sm px-4 py-2.5 text-xs font-bold text-red-700 shadow-[0_-4px_10px_rgba(239,68,68,0.1)] z-20 flex items-center gap-2 animate-in slide-in-from-bottom-2">
            <div className="flex h-4 w-4 items-center justify-center rounded-full bg-red-500/20">
              <span className="text-red-600">!</span>
            </div>
            {parseError}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function EnvVarBadge({
  token,
  englishName,
  chineseName,
  description,
  tone,
}: {
  token: string;
  englishName: string;
  chineseName: string;
  description: string;
  tone: 'builtin' | 'custom';
}) {
  const badgeClass =
    tone === 'builtin'
      ? 'border-violet-200/80 bg-violet-50 text-violet-700 dark:border-violet-500/35 dark:bg-violet-500/10 dark:text-violet-300'
      : 'border-sky-200/80 bg-sky-50 text-sky-700 dark:border-sky-500/35 dark:bg-sky-500/10 dark:text-sky-300';
  return (
    <div className="group/env relative">
      <span className={`inline-flex h-8 items-center rounded-lg border px-3 text-[13px] font-bold shadow-sm transition-all hover:shadow-md ${badgeClass}`}>
        <span className="font-mono">{token}</span>
      </span>
      <div className="pointer-events-none absolute left-0 top-10 z-20 hidden w-80 rounded-2xl border border-border/40 bg-background/95 p-4 text-xs text-foreground shadow-2xl backdrop-blur-md group-hover/env:block animate-in fade-in slide-in-from-top-1">
        <div className="space-y-2">
          <div><span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mr-2">英文名</span><span className="font-mono font-bold text-sm">{englishName}</span></div>
          <div><span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mr-2">中文名</span><span className="font-medium">{chineseName}</span></div>
          <div className="pt-2 border-t border-border/40 text-muted-foreground leading-relaxed mt-1">{description}</div>
        </div>
      </div>
    </div>
  );
}

function AvailableEnvVarsPanel({
  customEnvVars,
  onAddEnvVar,
  onEditEnvVar,
  onRemoveEnvVar,
}: {
  customEnvVars: VendorEnvVarDefinition[];
  onAddEnvVar: () => void;
  onEditEnvVar: (item: VendorEnvVarDefinition) => void;
  onRemoveEnvVar: (key: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-border/40 bg-background/50 p-4 shadow-sm mb-4">
      <div className="flex items-center justify-between border-b border-border/40 pb-3 mb-3">
        <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">环境变量池 (Env Vars)</div>
        <Button type="button" variant="outline" size="sm" className="h-8 px-3 text-xs font-bold rounded-lg shadow-sm" onClick={() => onAddEnvVar()}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          定义新变量
        </Button>
      </div>
      <div className="flex flex-wrap gap-2.5">
        {BUILTIN_ENV_VAR_META.map((item) => (
          <EnvVarBadge
            key={item.token}
            token={item.token}
            englishName={item.englishName}
            chineseName={item.chineseName}
            description={item.autoDescription}
            tone="builtin"
          />
        ))}
        {customEnvVars.map((item) => (
          <div
            key={item.key}
            className="group/env relative inline-flex h-8 items-center gap-1.5 rounded-lg border border-sky-200/80 bg-sky-50 px-3 text-[13px] font-bold text-sky-700 shadow-sm transition-all hover:shadow-md dark:border-sky-500/35 dark:bg-sky-500/10 dark:text-sky-300"
          >
            <span className="font-mono">{`$${item.key}`}</span>
            {item.optional ? (
              <span className="inline-flex h-5 items-center rounded-md border border-amber-200 bg-amber-50 px-1.5 text-[9px] font-bold uppercase tracking-wider text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
                选填
              </span>
            ) : null}
            <div className="ml-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/env:opacity-100">
              <button
                type="button"
                className="flex h-5 w-5 items-center justify-center rounded-md text-sky-700/85 transition hover:bg-sky-200 hover:text-sky-900 dark:text-sky-300 dark:hover:bg-sky-500/30"
                onClick={() => onEditEnvVar(item)}
                title={`编辑变量 $${item.key}`}
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                type="button"
                className="flex h-5 w-5 items-center justify-center rounded-md text-red-600 transition hover:bg-red-200 hover:text-red-700 dark:hover:bg-red-500/30"
                onClick={() => onRemoveEnvVar(item.key)}
                title={`删除变量 $${item.key}`}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
            <div className="pointer-events-none absolute left-0 top-10 z-20 hidden w-80 rounded-2xl border border-border/40 bg-background/95 p-4 text-xs text-foreground shadow-2xl backdrop-blur-md group-hover/env:block animate-in fade-in slide-in-from-top-1">
              <div className="space-y-2">
                <div><span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mr-2">英文名</span><span className="font-mono font-bold text-sm">{item.key}</span></div>
                <div><span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mr-2">中文名</span><span className="font-medium">{item.label}</span></div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mr-2">要求</span>
                  <span className={cn("font-bold", item.optional ? "text-amber-500" : "text-rose-500")}>{item.optional ? '选填' : '必填'}</span>
                </div>
                {item.optional ? (
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mr-2">默认值</span>
                    <span className="font-mono font-bold">{item.defaultValue?.trim() || '（空）'}</span>
                  </div>
                ) : null}
                <div className="pt-2 border-t border-border/40 text-muted-foreground leading-relaxed mt-1">
                  {item.meaning && item.meaning.trim()
                    ? item.meaning.trim()
                    : '可在控制台配置中手动填写该变量值'}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RequestConfigEditor({
  config,
  onChange,
  customEnvVars,
  onAddEnvVar,
  onEditEnvVar,
  onRemoveEnvVar,
  onValidationChange,
}: {
  config: RequestRegionBase;
  onChange: (next: RequestRegionBase) => void;
  customEnvVars: VendorEnvVarDefinition[];
  onAddEnvVar: () => void;
  onEditEnvVar: (item: VendorEnvVarDefinition) => void;
  onRemoveEnvVar: (key: string) => void;
  onValidationChange?: (state: RequestJsonValidationState) => void;
}) {
  const toSemanticJson = (value: unknown): string => {
    try {
      return JSON.stringify(value ?? {});
    } catch {
      return '';
    }
  };

  const [queryParamsText, setQueryParamsText] = useState(JSON.stringify(config.queryParams ?? {}, null, 2));
  const [requestHeadersText, setRequestHeadersText] = useState(JSON.stringify(config.requestHeaders ?? {}, null, 2));
  const [requestBodyText, setRequestBodyText] = useState(JSON.stringify(config.requestBody ?? {}, null, 2));
  const [queryParamsJsonError, setQueryParamsJsonError] = useState<string | null>(null);
  const [requestHeadersJsonError, setRequestHeadersJsonError] = useState<string | null>(null);
  const [requestBodyJsonError, setRequestBodyJsonError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<RequestEditorTab>('params');
  const queryParamsSignatureRef = useRef<string>(toSemanticJson(config.queryParams ?? {}));
  const requestHeadersSignatureRef = useRef<string>(toSemanticJson(config.requestHeaders ?? {}));
  const requestBodySignatureRef = useRef<string>(toSemanticJson(config.requestBody ?? {}));
  const templateVariables = useMemo(
    () => buildTemplateVariables(customEnvVars),
    [customEnvVars],
  );
  const countJsonEntries = (text: string): number => {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) return parsed.length;
      if (parsed && typeof parsed === 'object') return Object.keys(parsed as Record<string, unknown>).length;
      return 0;
    } catch {
      return 0;
    }
  };
  const paramsCount = countJsonEntries(queryParamsText);
  const headersCount = countJsonEntries(requestHeadersText);
  const bodyCount = countJsonEntries(requestBodyText);

  useEffect(() => {
    const nextSignature = toSemanticJson(config.queryParams ?? {});
    if (nextSignature !== queryParamsSignatureRef.current) {
      setQueryParamsText(JSON.stringify(config.queryParams ?? {}, null, 2));
      queryParamsSignatureRef.current = nextSignature;
    }
  }, [config.queryParams]);

  useEffect(() => {
    const nextSignature = toSemanticJson(config.requestHeaders ?? {});
    if (nextSignature !== requestHeadersSignatureRef.current) {
      setRequestHeadersText(JSON.stringify(config.requestHeaders ?? {}, null, 2));
      requestHeadersSignatureRef.current = nextSignature;
    }
  }, [config.requestHeaders]);

  useEffect(() => {
    const nextSignature = toSemanticJson(config.requestBody ?? {});
    if (nextSignature !== requestBodySignatureRef.current) {
      setRequestBodyText(JSON.stringify(config.requestBody ?? {}, null, 2));
      requestBodySignatureRef.current = nextSignature;
    }
  }, [config.requestBody]);

  useEffect(() => {
    setQueryParamsJsonError(validateJsonTextContent(queryParamsText));
  }, [queryParamsText]);

  useEffect(() => {
    setRequestHeadersJsonError(validateJsonTextContent(requestHeadersText));
  }, [requestHeadersText]);

  useEffect(() => {
    setRequestBodyJsonError(validateJsonTextContent(requestBodyText));
  }, [requestBodyText]);

  useEffect(() => {
    if (!onValidationChange) {
      return;
    }
    const issues: string[] = [];
    if (queryParamsJsonError) {
      issues.push(`Params：${queryParamsJsonError}`);
    }
    if (requestHeadersJsonError) {
      issues.push(`Headers：${requestHeadersJsonError}`);
    }
    if (requestBodyJsonError) {
      issues.push(`Body：${requestBodyJsonError}`);
    }
    onValidationChange({ hasError: issues.length > 0, issues });
  }, [onValidationChange, queryParamsJsonError, requestBodyJsonError, requestHeadersJsonError]);

  useEffect(
    () => () => {
      onValidationChange?.({ hasError: false, issues: [] });
    },
    [onValidationChange],
  );

  return (
    <div className="space-y-4 rounded-2xl border border-border/40 bg-muted/10 p-5 mt-4">
      <div className="flex items-center gap-2">
        <div className="h-4 w-1 rounded-full bg-primary/60" />
        <div className="text-sm font-bold text-foreground">请求发送配置 (Request Dispatch)</div>
      </div>
      <AvailableEnvVarsPanel
        customEnvVars={customEnvVars}
        onAddEnvVar={onAddEnvVar}
        onEditEnvVar={onEditEnvVar}
        onRemoveEnvVar={onRemoveEnvVar}
      />
      <div className="overflow-hidden rounded-xl border border-border/60 bg-background shadow-sm">
        <div role="tablist" className="flex items-center gap-1 border-b border-border/40 bg-muted/20 px-2 pt-2">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'params'}
            className={cn("inline-flex h-9 items-center gap-2 rounded-t-lg px-4 text-xs font-bold transition-all duration-200",
              activeTab === 'params'
                ? 'bg-background text-primary shadow-[0_-2px_10px_rgba(0,0,0,0.05)] border-t border-x border-border/60'
                : 'text-muted-foreground hover:bg-background/50 hover:text-foreground'
            )}
            onClick={() => setActiveTab('params')}
          >
            <span>Params</span>
            {paramsCount > 0 ? (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-md bg-primary/15 px-1.5 text-[10px] text-primary">
                {paramsCount}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'headers'}
            className={cn("inline-flex h-9 items-center gap-2 rounded-t-lg px-4 text-xs font-bold transition-all duration-200",
              activeTab === 'headers'
                ? 'bg-background text-primary shadow-[0_-2px_10px_rgba(0,0,0,0.05)] border-t border-x border-border/60'
                : 'text-muted-foreground hover:bg-background/50 hover:text-foreground'
            )}
            onClick={() => setActiveTab('headers')}
          >
            <span>Headers</span>
            {headersCount > 0 ? (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-md bg-primary/15 px-1.5 text-[10px] text-primary">
                {headersCount}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'body'}
            className={cn("inline-flex h-9 items-center gap-2 rounded-t-lg px-4 text-xs font-bold transition-all duration-200",
              activeTab === 'body'
                ? 'bg-background text-primary shadow-[0_-2px_10px_rgba(0,0,0,0.05)] border-t border-x border-border/60'
                : 'text-muted-foreground hover:bg-background/50 hover:text-foreground'
            )}
            onClick={() => setActiveTab('body')}
          >
            <span>Body</span>
            {bodyCount > 0 ? (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-md bg-primary/15 px-1.5 text-[10px] text-primary">
                {bodyCount}
              </span>
            ) : null}
          </button>
        </div>
        <div className="p-4 bg-background">
          {activeTab === 'params' ? (
            <JsonTemplateField
              label="Query Params（JSON）"
              value={queryParamsText}
              onChangeText={(text) => {
                setQueryParamsText(text);
                try {
                  const parsed = JSON.parse(text) as Record<string, string | number | boolean>;
                  queryParamsSignatureRef.current = toSemanticJson(parsed);
                  onChange({ ...config, queryParams: parsed });
                } catch {
                  // typing buffer
                }
              }}
              placeholder={'{\n  "start_date": "$oneYearAgoDate",\n  "end_date": "$tomorrowDate"\n}'}
              templateVariables={templateVariables}
              fieldType="query"
            />
          ) : null}
          {activeTab === 'headers' ? (
            <JsonTemplateField
              label="Request Headers（JSON）"
              value={requestHeadersText}
              onChangeText={(text) => {
                setRequestHeadersText(text);
                try {
                  const parsed = JSON.parse(text) as Record<string, string>;
                  requestHeadersSignatureRef.current = toSemanticJson(parsed);
                  onChange({ ...config, requestHeaders: parsed });
                } catch {
                  // typing buffer
                }
              }}
              placeholder={'{\n  "Authorization": "Bearer $apiKey"\n}'}
              templateVariables={templateVariables}
              fieldType="headers"
            />
          ) : null}
          {activeTab === 'body' ? (
            <JsonTemplateField
              label="Request Body（JSON）"
              value={requestBodyText}
              onChangeText={(text) => {
                setRequestBodyText(text);
                try {
                  const parsed = JSON.parse(text) as Record<string, unknown>;
                  requestBodySignatureRef.current = toSemanticJson(parsed);
                  onChange({ ...config, requestBody: parsed });
                } catch {
                  // typing buffer
                }
              }}
              placeholder={'{\n  \n}'}
              templateVariables={templateVariables}
              fieldType="body"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DisplayCardConfigurator({
  displayName,
  regionConfig,
  onChange,
  envVars,
  onAddEnvVar,
  onEditEnvVar,
  onRemoveEnvVar,
  selectionResetToken,
  onRequestJsonValidationChange,
}: {
  displayName: string;
  regionConfig: VendorRegionConfig;
  onChange: (next: VendorRegionConfig) => void;
  envVars: VendorEnvVarDefinition[];
  onAddEnvVar: () => void;
  onEditEnvVar: (item: VendorEnvVarDefinition) => void;
  onRemoveEnvVar: (key: string) => void;
  selectionResetToken: number;
  onRequestJsonValidationChange: (state: RequestJsonValidationState) => void;
}) {
  const [activeSection, setActiveSection] = useState<DisplaySection | null>('vendor_remaining');
  const [previewEnteredAt] = useState(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `${y}/${m}/${d} ${hh}:${mm}:${ss}`;
  });
  const middleMode = regionConfig.middle.mode;

  useEffect(() => {
    if (selectionResetToken > 0) {
      setActiveSection(null);
    }
  }, [selectionResetToken]);

  const emitRegionChange = (next: VendorRegionConfig) => {
    onChange(next);
  };

  const updateMetricRegion = (
    key: keyof VendorRegionConfig['regions'],
    updater: (current: RegionMetricConfig) => RegionMetricConfig,
  ) => {
    const current = regionConfig.regions[key] ?? defaultMetricRegion();
    emitRegionChange({
      ...regionConfig,
      regions: {
        ...regionConfig.regions,
        [key]: updater(current),
      },
    });
  };

  const updateMiddleMode = (mode: MiddleDisplayMode) => {
    emitRegionChange({
      ...regionConfig,
      middle: {
        ...regionConfig.middle,
        mode,
        token_usage:
          mode === 'token_usage'
            ? (regionConfig.middle.token_usage ?? defaultTokenUsageRegion())
            : regionConfig.middle.token_usage,
        reset_date:
          mode === 'reset_date'
            ? (regionConfig.middle.reset_date ?? defaultResetDateRegion())
            : regionConfig.middle.reset_date,
      },
    });
  };

  const updateTokenUsageRegion = (updater: (current: RegionTokenUsageConfig) => RegionTokenUsageConfig) => {
    const current = regionConfig.middle.token_usage ?? defaultTokenUsageRegion();
    emitRegionChange({
      ...regionConfig,
      middle: {
        ...regionConfig.middle,
        mode: 'token_usage',
        token_usage: updater(current),
      },
    });
  };

  const updateResetDateRegion = (updater: (current: RegionResetDateConfig) => RegionResetDateConfig) => {
    const current = regionConfig.middle.reset_date ?? defaultResetDateRegion();
    emitRegionChange({
      ...regionConfig,
      middle: {
        ...regionConfig.middle,
        mode: 'reset_date',
        reset_date: updater(current),
      },
    });
  };

  const updateRefreshTokenRegion = (updater: (current: RequestRegionBase) => RequestRegionBase) => {
    const current = regionConfig.refreshToken ?? defaultRefreshTokenRegion();
    emitRegionChange({
      ...regionConfig,
      refreshToken: updater(current),
    });
  };
  const updateDailyCheckinRegion = (updater: (current: RegionDailyCheckinConfig) => RegionDailyCheckinConfig) => {
    const current = regionConfig.dailyCheckin ?? defaultDailyCheckinRegion();
    emitRegionChange({
      ...regionConfig,
      dailyCheckin: updater(current),
    });
  };
  const refreshTokenFeatureEnabled = regionConfig.refreshTokenEnabled !== false;
  const dailyCheckinFeatureEnabled = regionConfig.dailyCheckinEnabled === true;
  const toggleRefreshTokenFeature = (enabled: boolean) => {
    emitRegionChange({
      ...regionConfig,
      refreshTokenEnabled: enabled,
      refreshToken: regionConfig.refreshToken ?? defaultRefreshTokenRegion(),
    });
  };
  const toggleDailyCheckinFeature = (enabled: boolean) => {
    emitRegionChange({
      ...regionConfig,
      dailyCheckinEnabled: enabled,
      dailyCheckin: regionConfig.dailyCheckin ?? defaultDailyCheckinRegion(),
    });
  };

  const vendorRemainingRegion = regionConfig.regions.vendor_remaining;
  const vendorUsedRegion = regionConfig.regions.vendor_used;
  const endpointRemainingRegion = regionConfig.regions.endpoint_remaining;
  const endpointUsedRegion = regionConfig.regions.endpoint_used;
  const endpointTotalRegion = regionConfig.regions.endpoint_total;
  const refreshTokenRegion = regionConfig.refreshToken ?? defaultRefreshTokenRegion();
  const dailyCheckinRegion = regionConfig.dailyCheckin ?? defaultDailyCheckinRegion();
  const refreshResponseMappings =
    Array.isArray(refreshTokenRegion.refreshResponseMappings) && refreshTokenRegion.refreshResponseMappings.length > 0
      ? refreshTokenRegion.refreshResponseMappings
      : defaultRefreshResponseMappings();
  const tokenUsageRegion = regionConfig.middle.token_usage;
  const resetDateRegion = regionConfig.middle.reset_date;
  const allCustomEnvVars = envVars;
  const refreshEnvVarSuggestions = useMemo(() => {
    const seed = ['AccessToken', 'RefreshToken'];
    const next: string[] = [...seed];
    const seen = new Set(seed.map((item) => item.toLowerCase()));
    for (const item of allCustomEnvVars) {
      const key = normalizeEnvVarKey(item.key);
      if (!key) continue;
      const lowered = key.toLowerCase();
      if (seen.has(lowered)) continue;
      seen.add(lowered);
      next.push(key);
    }
    return next;
  }, [allCustomEnvVars]);

  const sectionLabel =
    activeSection === null
      ? '未选择'
      : activeSection === 'vendor_remaining'
      ? '供应商余额'
      : activeSection === 'vendor_used'
        ? '供应商已用'
        : activeSection === 'endpoint_remaining'
          ? '端点余额'
          : activeSection === 'endpoint_used'
            ? '端点已用'
            : activeSection === 'endpoint_total'
              ? '端点总额'
              : activeSection === 'daily_checkin'
                ? '每日签到'
              : activeSection === 'refresh_token'
                ? '刷新令牌'
              : '中部信息条';
  const readAggregateMode = (
    key: 'vendor_remaining' | 'vendor_used',
  ): 'independent_request' | 'endpoint_sum' =>
    regionConfig.aggregation?.[key] ??
    (key === 'vendor_used' ? 'endpoint_sum' : 'independent_request');
  const currentVendorAggregateMode =
    activeSection === 'vendor_remaining'
      ? readAggregateMode('vendor_remaining')
      : activeSection === 'vendor_used'
        ? readAggregateMode('vendor_used')
        : null;
  const updateVendorAggregateMode = (
    key: 'vendor_remaining' | 'vendor_used',
    mode: 'independent_request' | 'endpoint_sum',
  ) => {
    emitRegionChange({
      ...regionConfig,
      aggregation: {
        vendor_remaining: readAggregateMode('vendor_remaining'),
        vendor_used: readAggregateMode('vendor_used'),
        [key]: mode,
      },
    });
  };
  const readEndpointTotalMode = (): 'independent_request' | 'sum_from_parts' | 'manual_total' => {
    const mode = regionConfig.endpointTotalMode;
    if (mode === 'sum_from_parts' || mode === 'manual_total') {
      return mode;
    }
    return 'independent_request';
  };
  const readEndpointMetricMode = (
    key: 'endpoint_remaining' | 'endpoint_used',
  ): 'independent_request' | 'subtract_from_total' => {
    const mode = regionConfig.endpointMetricModes?.[key];
    return mode === 'subtract_from_total' ? 'subtract_from_total' : 'independent_request';
  };
  const endpointTotalMode = readEndpointTotalMode();
  const currentEndpointMetricMode =
    activeSection === 'endpoint_remaining'
      ? readEndpointMetricMode('endpoint_remaining')
      : activeSection === 'endpoint_used'
        ? readEndpointMetricMode('endpoint_used')
        : null;
  const endpointMetricModesSnapshot = {
    endpoint_remaining: readEndpointMetricMode('endpoint_remaining'),
    endpoint_used: readEndpointMetricMode('endpoint_used'),
  } as const;
  const updateEndpointTotalMode = (mode: 'independent_request' | 'sum_from_parts' | 'manual_total') => {
    if (mode === 'sum_from_parts' && (
      endpointMetricModesSnapshot.endpoint_remaining === 'subtract_from_total'
      || endpointMetricModesSnapshot.endpoint_used === 'subtract_from_total'
    )) {
      toast.warning('禁止切换', '当前端点余额/端点已用包含减法计算，不能切到加和计算');
      return;
    }
    emitRegionChange({
      ...regionConfig,
      endpointTotalMode: mode,
      endpointMetricModes: {
        endpoint_remaining: endpointMetricModesSnapshot.endpoint_remaining,
        endpoint_used: endpointMetricModesSnapshot.endpoint_used,
      },
    });
  };
  const updateEndpointMetricMode = (
    key: 'endpoint_remaining' | 'endpoint_used',
    mode: 'independent_request' | 'subtract_from_total',
  ) => {
    let nextRemaining: 'independent_request' | 'subtract_from_total' =
      key === 'endpoint_remaining' ? mode : endpointMetricModesSnapshot.endpoint_remaining;
    let nextUsed: 'independent_request' | 'subtract_from_total' =
      key === 'endpoint_used' ? mode : endpointMetricModesSnapshot.endpoint_used;

    if (nextRemaining === 'subtract_from_total' && nextUsed === 'subtract_from_total') {
      toast.warning('禁止切换', '端点余额与端点已用不能同时设置为减法计算');
      return;
    }

    if (
      endpointTotalMode === 'sum_from_parts'
      && (nextRemaining === 'subtract_from_total' || nextUsed === 'subtract_from_total')
    ) {
      toast.warning('禁止切换', '端点总额为加和计算时，端点余额/端点已用不能使用减法计算');
      return;
    }

    emitRegionChange({
      ...regionConfig,
      endpointTotalMode,
      endpointMetricModes: {
        endpoint_remaining: nextRemaining,
        endpoint_used: nextUsed,
      },
    });
  };

  const shouldShowRequestConfigEditor =
    activeSection !== null
    && (activeSection === 'middle'
      ? middleMode === 'token_usage' || middleMode === 'reset_date'
      : activeSection === 'daily_checkin'
        ? dailyCheckinFeatureEnabled
      : activeSection === 'refresh_token'
        ? refreshTokenFeatureEnabled
      : !(((activeSection === 'vendor_remaining' || activeSection === 'vendor_used')
            && currentVendorAggregateMode === 'endpoint_sum')
          || (activeSection === 'endpoint_total' && endpointTotalMode !== 'independent_request')));

  useEffect(() => {
    if (!shouldShowRequestConfigEditor) {
      onRequestJsonValidationChange({ hasError: false, issues: [] });
    }
  }, [onRequestJsonValidationChange, shouldShowRequestConfigEditor]);


  const previewTokenUsed = 2930630;
  const previewTokenRemaining = 5000000;
  const previewTokenTotal = previewTokenUsed + previewTokenRemaining;
  const previewTokenPct = previewTokenTotal > 0 ? (previewTokenUsed / previewTokenTotal) * 100 : 0;

  const regionClass = (
    region: DisplaySection,
    tone: string,
    density: 'compact' | 'flush' = 'compact'
  ): string =>
    `group/region relative rounded-lg border-2 ${
      density === 'flush' ? 'px-1 py-0.5' : 'px-2 py-1'
    } text-left transition-all duration-300 ${tone} ${
      activeSection === region
        ? 'border-primary bg-primary/10 shadow-[0_0_15px_rgba(var(--primary-rgb),0.25)] scale-[1.05] ring-4 ring-primary/20 z-30'
        : 'border-transparent hover:border-primary/40 hover:bg-primary/5'
    }`;

  return (
    <Card className="overflow-hidden border-border/40 shadow-xl backdrop-blur-xl">
      <div className="border-b bg-muted/30 p-6">
        <CardTitle className="flex items-center gap-2 text-lg">
          <div className="h-4 w-1 rounded-full bg-primary" />
          控制台式区域分配器
        </CardTitle>
        <p className="mt-2 text-xs text-muted-foreground leading-relaxed max-w-2xl">
          直观映射并点击下方样例卡片中的特定区域（如余额、已用、Token），以在此下方配置该区域对应的数据提取与API交互逻辑。
        </p>
      </div>
      <CardContent className="p-4 md:p-5 space-y-6 bg-background/30">
        <div className="space-y-4">
          <div className="rounded-3xl border border-border/60 bg-card/60 shadow-lg backdrop-blur-sm overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/40 bg-muted/20 px-4 py-3.5 md:px-6">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
                <div className="text-lg font-bold tracking-tight text-foreground">样例服务商</div>
                <div className="flex flex-wrap gap-1.5">
                  <span className="inline-flex h-6 items-center rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 text-[11px] font-bold uppercase tracking-wider text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300 shadow-sm">
                    {displayName || '未设置显示名称'}
                  </span>
                  <span className="inline-flex h-6 items-center rounded-lg border border-border/60 bg-background/50 px-2.5 text-[11px] font-bold text-muted-foreground shadow-sm">
                    1 个端点
                  </span>
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-1 text-[11px] font-medium text-muted-foreground border border-border/40 ml-2">
                  <Clock className="h-3.5 w-3.5" />
                  最后更新：{previewEnteredAt}
                </div>
              </div>

              <div className="flex w-full flex-wrap items-center gap-4 md:w-auto">
                <div className="flex items-center gap-1.5 rounded-xl border border-border/60 bg-background/80 px-2 py-2 shadow-sm backdrop-blur-sm">
                  <button
                    type="button"
                    onClick={() => setActiveSection('vendor_remaining')}
                    className={regionClass('vendor_remaining', 'flex flex-col justify-center min-w-[70px]')}
                    title="点击配置供应商余额"
                  >
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">余额</span>
                    <span className="font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400">
                      $36.88
                    </span>
                    <span className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 w-max whitespace-nowrap rounded-lg border border-border/60 bg-background/95 backdrop-blur-sm px-3 py-1.5 text-[10px] font-bold text-primary opacity-0 shadow-lg transition-all group-hover/region:opacity-100 z-10">
                      配置: 供应商余额
                    </span>
                  </button>
                  
                  <div className="h-10 w-px bg-border/60" />
                  
                  <button
                    type="button"
                    onClick={() => setActiveSection('vendor_used')}
                    className={regionClass('vendor_used', 'flex flex-col justify-center min-w-[70px]')}
                    title="点击配置供应商已用"
                  >
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">已用</span>
                    <span className="font-mono text-sm font-bold text-red-600 dark:text-red-400">
                      $63.12
                    </span>
                    <span className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 w-max whitespace-nowrap rounded-lg border border-border/60 bg-background/95 backdrop-blur-sm px-3 py-1.5 text-[10px] font-bold text-primary opacity-0 shadow-lg transition-all group-hover/region:opacity-100 z-10">
                      配置: 供应商已用
                    </span>
                  </button>
                </div>

                <div className="flex items-center gap-1.5 rounded-2xl border border-border/60 bg-background/50 p-1 shadow-sm">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setActiveSection('daily_checkin')}
                    className={cn("h-10 rounded-xl px-4 text-sm font-bold transition-all duration-300 border", activeSection === 'daily_checkin' ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shadow-sm" : "border-transparent text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-600")}
                  >
                    <CircleCheckBig className="h-4 w-4 mr-2" />
                    每日签到
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setActiveSection('refresh_token')}
                    className={cn("h-10 rounded-xl px-4 text-sm font-bold transition-all duration-300 border", activeSection === 'refresh_token' ? "border-primary/60 bg-primary/10 text-primary shadow-sm" : "border-transparent text-muted-foreground hover:bg-primary/10 hover:text-primary")}
                  >
                    <RefreshCcw className="h-4 w-4 mr-2" />
                    刷新令牌
                  </Button>
                </div>
              </div>
            </div>

            <div className="p-4 md:p-5">
              <div className="group relative rounded-2xl border border-border/60 bg-background/50 p-5 transition-all duration-300 hover:border-primary/40 hover:bg-background hover:shadow-lg dark:hover:bg-white/[0.02]">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between mb-4">
                  <div className="flex min-w-0 flex-1 flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="inline-flex h-7 items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 shadow-sm">
                        <CircleCheckBig className="h-4 w-4 text-green-500 shrink-0" aria-label="渠道已启用" />
                        <span className="truncate max-w-[200px] text-xs font-bold text-foreground" title="样例端点">
                          样例端点
                        </span>
                      </div>
                      <span className="inline-flex h-7 w-fit items-center rounded-md border border-sky-200 bg-sky-50 px-3 text-xs font-bold tracking-wider text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300 shadow-sm">
                        按量
                      </span>
                      <span className="inline-flex h-7 w-fit items-center rounded-md border border-emerald-500/20 bg-emerald-500/15 px-3 text-xs font-bold text-emerald-700 dark:text-emerald-300 shadow-sm">
                        正常
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground font-medium">
                      <div className="flex items-center gap-2 font-mono opacity-70 hover:opacity-100 transition-opacity max-w-[300px] truncate" title="https://openai.com/">
                        <span className="truncate">https://openai.com/</span>
                        <button
                          type="button"
                          className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-background shadow-sm text-sky-600 transition-colors hover:bg-sky-50 dark:hover:bg-sky-500/10"
                          title="打开控制台网址"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="h-4 w-px bg-border/60" />
                      <div className="flex items-center gap-1.5 font-mono text-muted-foreground">
                        <KeyRound className="h-4 w-4" />
                        <span>sk-kEm1****mgWD</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 items-center gap-4 rounded-xl border border-border/40 bg-muted/20 px-4 py-3 shadow-inner lg:grid-cols-3">
                  {/* Left: Financial Metrics */}
                  <div className="flex items-center justify-center gap-5 lg:justify-start">
                    <button
                      type="button"
                      onClick={() => setActiveSection('endpoint_remaining')}
                      className={regionClass('endpoint_remaining', 'flex flex-col justify-center min-w-[70px]')}
                      title="点击配置端点余额"
                    >
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">余额</span>
                      <span className="font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400">
                        $36.88
                      </span>
                      <span className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 w-max whitespace-nowrap rounded-lg border border-border/60 bg-background/95 backdrop-blur-sm px-3 py-1.5 text-[10px] font-bold text-primary opacity-0 shadow-lg transition-all group-hover/region:opacity-100 z-10">
                        配置: 端点余额
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveSection('endpoint_used')}
                      className={regionClass('endpoint_used', 'flex flex-col justify-center min-w-[70px]')}
                      title="点击配置端点已用"
                    >
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">已用</span>
                      <span className="font-mono text-sm font-bold text-red-600 dark:text-red-400">
                        $63.12
                      </span>
                      <span className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 w-max whitespace-nowrap rounded-lg border border-border/60 bg-background/95 backdrop-blur-sm px-3 py-1.5 text-[10px] font-bold text-primary opacity-0 shadow-lg transition-all group-hover/region:opacity-100 z-10">
                        配置: 端点已用
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveSection('endpoint_total')}
                      className={regionClass('endpoint_total', 'flex flex-col justify-center min-w-[70px]')}
                      title="点击配置端点总额"
                    >
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">总额</span>
                      <span className="font-mono text-sm font-bold text-foreground/70">
                        $100.00
                      </span>
                      <span className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 w-max whitespace-nowrap rounded-lg border border-border/60 bg-background/95 backdrop-blur-sm px-3 py-1.5 text-[10px] font-bold text-primary opacity-0 shadow-lg transition-all group-hover/region:opacity-100 z-10">
                        配置: 端点总额
                      </span>
                    </button>
                  </div>

                  {/* Center: Token and Reset Info */}
                  <div className="flex items-center justify-center">
                    <button
                      type="button"
                      onClick={() => setActiveSection('middle')}
                      className={regionClass('middle', 'w-full flex justify-center py-2')}
                      title="点击配置中部信息条"
                    >
                      {middleMode === 'token_usage' ? (
                        <div className="flex h-10 items-center gap-3 rounded-xl border-2 border-emerald-500/30 bg-emerald-500/10 px-4 text-[11px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 shadow-lg">
                          <PieChart className="h-5 w-5" />
                          <div className="flex items-center gap-2">
                            <span className="font-mono">2,930,630</span>
                            <div className="h-2 w-20 overflow-hidden rounded-full bg-muted/40 shadow-inner">
                              <div className="h-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" style={{ width: `58%` }} />
                            </div>
                            <span className="font-mono">5,000,000</span>
                          </div>
                        </div>
                      ) : middleMode === 'reset_date' ? (
                        <div className="flex h-10 items-center gap-3 rounded-xl border-2 border-red-500/30 bg-red-500/10 px-4 text-[11px] font-black uppercase tracking-widest text-red-500 shadow-lg">
                          <Clock className="h-5 w-5" />
                          <span>RESET: 2026-02-20</span>
                        </div>
                      ) : (
                        <span className="inline-flex h-10 items-center justify-center w-full rounded-xl border-2 border-dashed border-border/60 bg-muted/10 text-xs font-black text-muted-foreground/40 uppercase tracking-widest">
                          Hidden
                        </span>
                      )}
                      <span className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 w-max whitespace-nowrap rounded-lg border border-border/40 bg-background/95 backdrop-blur-md px-3 py-1.5 text-[10px] font-bold text-primary opacity-0 shadow-lg transition-all group-hover/region:opacity-100 z-10">
                        配置: 中部信息条
                      </span>
                    </button>
                  </div>

                  {/* Right: Latency and Updated At */}
                  <div className="flex items-center justify-center gap-5 text-[11px] font-black text-muted-foreground/80 lg:justify-end">
                    <span className="rounded-xl border-2 border-border/40 bg-background/80 px-4 py-2 font-mono text-emerald-600 dark:text-emerald-400 shadow-lg">66ms</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-border/40 bg-background/50 p-5 md:p-6 shadow-sm backdrop-blur-md">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-sm border border-primary/20">
                  <Settings2 className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-lg font-bold tracking-tight text-foreground">配置检查器</div>
                  <div className="text-xs font-medium text-muted-foreground mt-0.5">选中上方预览卡片中的特定区域进行精细化设置</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {activeSection === 'refresh_token' || activeSection === 'daily_checkin' ? (
                  <label className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-foreground bg-muted/20 px-3 py-1.5 rounded-xl border border-border/40 shadow-sm cursor-pointer">
                    启用该功能
                    <button
                      type="button"
                      role="switch"
                      aria-checked={activeSection === 'refresh_token' ? refreshTokenFeatureEnabled : dailyCheckinFeatureEnabled}
                      data-state={(activeSection === 'refresh_token' ? refreshTokenFeatureEnabled : dailyCheckinFeatureEnabled) ? 'checked' : 'unchecked'}
                      onClick={() => {
                        if (activeSection === 'refresh_token') {
                          toggleRefreshTokenFeature(!refreshTokenFeatureEnabled);
                          return;
                        }
                        toggleDailyCheckinFeature(!dailyCheckinFeatureEnabled);
                      }}
                      className="peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-input focus-visible:border-ring focus-visible:ring-ring/50 dark:data-[state=unchecked]:bg-input/80 inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:ring-[3px] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span
                        data-state={(activeSection === 'refresh_token' ? refreshTokenFeatureEnabled : dailyCheckinFeatureEnabled) ? 'checked' : 'unchecked'}
                        className="bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0"
                      />
                    </button>
                  </label>
                ) : null}
                <div className="inline-flex items-center rounded-xl border border-primary/20 bg-primary/5 px-4 py-2 text-sm font-bold text-primary shadow-sm">
                  <div className="h-2 w-2 rounded-full bg-primary animate-pulse mr-2" />
                  当前编辑区域：{sectionLabel}
                </div>
              </div>
            </div>

            <div className="mt-6">
                {activeSection === null ? (
                  <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 bg-muted/5 py-16 text-center">
                    <div className="rounded-full bg-muted/50 p-4 mb-4">
                      <Plus className="h-6 w-6 text-muted-foreground/50" />
                    </div>
                    <div className="text-sm font-bold text-muted-foreground">尚未选择编辑区域</div>
                    <div className="text-xs font-medium text-muted-foreground/70 mt-1">请点击上方卡片中高亮的任意区域以开始配置</div>
                  </div>
                ) : activeSection === 'daily_checkin' ? (
                  <div className="space-y-6">
                    {dailyCheckinFeatureEnabled ? (
                      <>
                        <div className="space-y-3 rounded-lg border border-sky-200/80 bg-sky-50/30 p-3 dark:border-sky-500/30 dark:bg-sky-500/5">
                          <div className="space-y-0.5">
                            <div className="text-sm font-semibold text-foreground">请求发送配置</div>
                          </div>
                                                      <div className="grid gap-6 md:grid-cols-[180px_1fr_320px] items-start px-1">
                                                        <div className="space-y-2">
                                                          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground ml-1">HTTP 方法</label>
                                                          <Select
                                                            value={dailyCheckinRegion.method}
                                                            onValueChange={(value) =>
                                                              updateDailyCheckinRegion((current) => ({
                                                                ...current,
                                                                method: value as 'GET' | 'POST' | 'PUT',
                                                              }))
                                                            }
                                                          >
                                                            <SelectTrigger className="w-full h-12 min-h-12 py-0 rounded-2xl border-border/60 bg-muted/10 px-5 font-bold focus:ring-primary/20"><SelectValue /></SelectTrigger>
                                                            <SelectContent className="rounded-xl border-border/40 shadow-xl">
                                                              <SelectItem value="GET" className="rounded-lg font-medium">GET</SelectItem>
                                                              <SelectItem value="POST" className="rounded-lg font-medium">POST</SelectItem>
                                                              <SelectItem value="PUT" className="rounded-lg font-medium">PUT</SelectItem>
                                                            </SelectContent>
                                                          </Select>
                                                        </div>
                                                        <RequestPathField
                                                          label="请求 URL 路径"
                                                          value={dailyCheckinRegion.path}
                                                          onChangePath={(value) =>
                                                            updateDailyCheckinRegion((current) => ({
                                                              ...current,
                                                              path: value,
                                                            }))
                                                          }
                                                          replacements={dailyCheckinRegion.baseUrlReplacements}
                                                          onChangeReplacements={(rules) =>
                                                            updateDailyCheckinRegion((current) => ({
                                                              ...current,
                                                              baseUrlReplacements: rules,
                                                            }))
                                                          }
                                                          placeholder="/api/user/checkin"
                                                        />                            <RequestAutoHandleSwitches
                              config={dailyCheckinRegion}
                              onChange={(next) => updateDailyCheckinRegion((current) => ({ ...current, ...next }))}
                              allowAuto401={refreshTokenFeatureEnabled}
                            />
                          </div>

                          <RequestConfigEditor
                            config={dailyCheckinRegion}
                            onChange={(next) => updateDailyCheckinRegion((current) => ({ ...current, ...next }))}
                            customEnvVars={allCustomEnvVars}
                            onAddEnvVar={onAddEnvVar}
                            onEditEnvVar={onEditEnvVar}
                            onRemoveEnvVar={onRemoveEnvVar}
                            onValidationChange={onRequestJsonValidationChange}
                          />
                        </div>

                        <div className="space-y-4 rounded-2xl border border-emerald-200/80 bg-emerald-50/30 p-5 dark:border-emerald-500/30 dark:bg-emerald-500/5">
                          <div className="flex items-center gap-2 border-b border-emerald-200/80 dark:border-emerald-500/30 pb-3">
                            <div className="h-4 w-1 rounded-full bg-emerald-500" />
                            <div className="text-sm font-bold text-foreground">字段提取与计算</div>
                          </div>
                          <div className="grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(140px,1fr)_120px]">
                            <InputField
                              label="签到日期字段路径"
                              value={dailyCheckinRegion.dateField ?? ''}
                              onChange={(value) =>
                                updateDailyCheckinRegion((current) => ({
                                  ...current,
                                  dateField: value || null,
                                }))
                              }
                              placeholder="如 data.checkin_date"
                              mono
                            />
                            <InputField
                              label="签到奖励字段路径"
                              value={dailyCheckinRegion.awardedField ?? ''}
                              onChange={(value) =>
                                updateDailyCheckinRegion((current) => ({
                                  ...current,
                                  awardedField: value || null,
                                }))
                              }
                              placeholder="如 data.quota_awarded"
                              mono
                            />
                            <div className="space-y-2">
                              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">签到奖励公式</label>
                              <Select
                                value={dailyCheckinRegion.awardedFormula?.type ?? 'direct'}
                                onValueChange={(value) =>
                                  updateDailyCheckinRegion((current) => ({
                                    ...current,
                                    awardedFormula:
                                      value === 'divide'
                                        ? {
                                            type: 'divide',
                                            divisor: current.awardedFormula?.type === 'divide' ? (current.awardedFormula.divisor ?? 1) : 1,
                                          }
                                        : { type: 'direct' },
                                  }))
                                }
                              >
                                <SelectTrigger className="w-full h-12 min-h-12 py-0 rounded-2xl border-border/60 bg-muted/10 px-5 font-bold focus:ring-primary/20"><SelectValue /></SelectTrigger>
                                <SelectContent className="rounded-xl border-border/40 shadow-xl">
                                  <SelectItem value="direct" className="rounded-lg font-medium">直接使用</SelectItem>
                                  <SelectItem value="divide" className="rounded-lg font-medium">除以系数</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2 animate-in fade-in slide-in-from-left-2" style={{ display: dailyCheckinRegion.awardedFormula?.type === 'divide' ? 'block' : 'none' }}>
                              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">转换系数</label>
                              <input
                                type="number"
                                value={dailyCheckinRegion.awardedFormula?.type === 'divide' ? (dailyCheckinRegion.awardedFormula.divisor ?? 1) : 1}
                                onChange={(event) =>
                                  updateDailyCheckinRegion((current) => ({
                                    ...current,
                                    awardedFormula: {
                                      type: 'divide',
                                      divisor: Number(event.target.value) || 1,
                                    },
                                  }))
                                }
                                disabled={dailyCheckinRegion.awardedFormula?.type !== 'divide'}
                                className="w-full h-12 min-h-12 py-0 w-full rounded-2xl border border-border/60 bg-muted/10 px-4 text-sm font-bold outline-none transition-all focus:border-primary/40 focus:bg-background focus:ring-4 focus:ring-primary/10 shadow-sm disabled:opacity-50"
                              />
                            </div>
                          </div>
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : activeSection === 'refresh_token' ? (
                  <div className="mt-3 space-y-3">
                    {refreshTokenFeatureEnabled ? (
                      <>
                      <div className="space-y-3 rounded-lg border border-sky-200/80 bg-sky-50/30 p-3 dark:border-sky-500/30 dark:bg-sky-500/5">
                        <div className="space-y-0.5">
                          <div className="text-sm font-semibold text-foreground">请求发送配置</div>
                        </div>
                            <div className="grid gap-6 md:grid-cols-[180px_1fr_320px] items-start px-1">
                              <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground ml-1">HTTP 方法</label>
                                <Select
                                  value={refreshTokenRegion.method}
                                  onValueChange={(value) =>
                                    updateRefreshTokenRegion((current) => ({
                                      ...current,
                                      method: value as 'GET' | 'POST' | 'PUT',
                                    }))
                                  }
                                >
                                  <SelectTrigger className="w-full h-12 min-h-12 py-0 rounded-2xl border-border/60 bg-muted/10 px-5 font-bold focus:ring-primary/20"><SelectValue /></SelectTrigger>
                                  <SelectContent className="rounded-xl border-border/40 shadow-xl">
                                    <SelectItem value="GET" className="rounded-lg font-medium">GET</SelectItem>
                                    <SelectItem value="POST" className="rounded-lg font-medium">POST</SelectItem>
                                    <SelectItem value="PUT" className="rounded-lg font-medium">PUT</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <RequestPathField
                                label="请求 URL 路径"
                                value={refreshTokenRegion.path}
                                onChangePath={(value) =>
                                  updateRefreshTokenRegion((current) => ({
                                    ...current,
                                    path: value,
                                  }))
                                }
                                replacements={refreshTokenRegion.baseUrlReplacements}
                                onChangeReplacements={(rules) =>
                                  updateRefreshTokenRegion((current) => ({
                                    ...current,
                                    baseUrlReplacements: rules,
                                  }))
                                }
                                placeholder="/api/auth/refresh"
                              />
                          <RequestAutoHandleSwitches
                            config={refreshTokenRegion}
                            onChange={(next) => updateRefreshTokenRegion((current) => ({ ...current, ...next }))}
                            allowAuto401={refreshTokenFeatureEnabled}
                          />
                        </div>

                        <RequestConfigEditor
                          config={refreshTokenRegion}
                          onChange={(next) => updateRefreshTokenRegion((current) => ({ ...current, ...next }))}
                          customEnvVars={allCustomEnvVars}
                          onAddEnvVar={onAddEnvVar}
                          onEditEnvVar={onEditEnvVar}
                          onRemoveEnvVar={onRemoveEnvVar}
                          onValidationChange={onRequestJsonValidationChange}
                        />
                      </div>

                      <div className="space-y-4 rounded-2xl border border-emerald-200/80 bg-emerald-50/30 p-5 dark:border-emerald-500/30 dark:bg-emerald-500/5">
                        <div className="flex items-center justify-between gap-2 border-b border-emerald-200/80 dark:border-emerald-500/30 pb-3">
                          <div className="flex items-center gap-2">
                            <div className="h-4 w-1 rounded-full bg-emerald-500" />
                            <div className="text-sm font-bold text-foreground">字段提取与计算</div>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              updateRefreshTokenRegion((current) => ({
                                ...current,
                                refreshResponseMappings: [
                                  ...(Array.isArray(current.refreshResponseMappings) ? current.refreshResponseMappings : refreshResponseMappings),
                                  {
                                    field: '',
                                    envVarKey: '',
                                    formula: { type: 'direct' },
                                  },
                                ],
                              }))
                            }
                            className="inline-flex items-center rounded-lg border border-border/60 bg-background px-3 py-1.5 text-xs font-bold text-muted-foreground shadow-sm transition-all hover:border-emerald-500/40 hover:bg-emerald-500/5 hover:text-emerald-600 active:scale-95"
                          >
                            <Plus className="mr-1.5 h-3.5 w-3.5" />
                            新增字段
                          </button>
                        </div>

                        <div className="space-y-3">
                          {refreshResponseMappings.map((mapping, index) => (
                            <div
                              key={`refresh-map-${index}`}
                              className="grid gap-4 rounded-xl border border-border/60 bg-background/80 p-4 shadow-sm md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_120px_100px_40px] items-center transition-colors hover:border-emerald-500/30"
                            >
                              <input
                                type="text"
                                value={mapping.field}
                                onChange={(event) =>
                                  updateRefreshTokenRegion((current) => {
                                    const list = Array.isArray(current.refreshResponseMappings)
                                      ? [...current.refreshResponseMappings]
                                      : [...refreshResponseMappings];
                                    const next = { ...(list[index] ?? { field: '', envVarKey: '', formula: { type: 'direct' } }) };
                                    next.field = event.target.value;
                                    list[index] = next;
                                    return {
                                      ...current,
                                      refreshResponseMappings: list,
                                    };
                                  })
                                }
                                placeholder="返回字段路径，如 data.access_token"
                                className="w-full h-12 min-h-12 py-0 w-full rounded-2xl border border-border/60 bg-muted/10 px-5 text-sm font-medium outline-none transition-all focus:border-emerald-500/40 focus:bg-background focus:ring-4 focus:ring-emerald-500/10"
                              />
                              <div>
                                <input
                                  list="refresh-envvar-suggestions"
                                  type="text"
                                  value={mapping.envVarKey}
                                  onChange={(event) =>
                                    updateRefreshTokenRegion((current) => {
                                      const list = Array.isArray(current.refreshResponseMappings)
                                        ? [...current.refreshResponseMappings]
                                        : [...refreshResponseMappings];
                                      const next = { ...(list[index] ?? { field: '', envVarKey: '', formula: { type: 'direct' } }) };
                                      next.envVarKey = event.target.value;
                                      list[index] = next;
                                      return {
                                        ...current,
                                        refreshResponseMappings: list,
                                      };
                                    })
                                  }
                                  placeholder="更新到环境变量（不含$）"
                                  className="w-full h-12 min-h-12 py-0 w-full rounded-2xl border border-border/60 bg-muted/10 px-5 text-sm font-medium outline-none transition-all focus:border-emerald-500/40 focus:bg-background focus:ring-4 focus:ring-emerald-500/10"
                                />
                                <datalist id="refresh-envvar-suggestions">
                                  {refreshEnvVarSuggestions.map((key) => (
                                    <option key={`refresh-envvar-${key}`} value={key} />
                                  ))}
                                </datalist>
                              </div>
                              <Select
                                value={mapping.formula?.type ?? 'direct'}
                                onValueChange={(value) =>
                                  updateRefreshTokenRegion((current) => {
                                    const list = Array.isArray(current.refreshResponseMappings)
                                      ? [...current.refreshResponseMappings]
                                      : [...refreshResponseMappings];
                                    const next = { ...(list[index] ?? { field: '', envVarKey: '', formula: { type: 'direct' } }) };
                                    next.formula =
                                      value === 'divide'
                                        ? {
                                            type: 'divide',
                                            divisor: next.formula?.type === 'divide' ? (next.formula.divisor ?? 1) : 1,
                                          }
                                        : { type: 'direct' };
                                    list[index] = next;
                                    return {
                                      ...current,
                                      refreshResponseMappings: list,
                                    };
                                  })
                                }
                              >
                                <SelectTrigger className="w-full h-12 min-h-12 py-0 rounded-2xl border-border/60 bg-muted/10 px-5 font-bold focus:ring-emerald-500/20"><SelectValue /></SelectTrigger>
                                <SelectContent className="rounded-xl border-border/40 shadow-xl">
                                  <SelectItem value="direct" className="rounded-lg font-medium">直接使用</SelectItem>
                                  <SelectItem value="divide" className="rounded-lg font-medium">除以系数</SelectItem>
                                </SelectContent>
                              </Select>
                              <div style={{ visibility: mapping.formula?.type === 'divide' ? 'visible' : 'hidden' }}>
                                <input
                                  type="number"
                                  value={mapping.formula?.type === 'divide' ? (mapping.formula.divisor ?? 1) : 1}
                                  onChange={(event) =>
                                    updateRefreshTokenRegion((current) => {
                                      const list = Array.isArray(current.refreshResponseMappings)
                                        ? [...current.refreshResponseMappings]
                                        : [...refreshResponseMappings];
                                      const next = { ...(list[index] ?? { field: '', envVarKey: '', formula: { type: 'direct' } }) };
                                      next.formula = {
                                        type: 'divide',
                                        divisor: Number(event.target.value) || 1,
                                      };
                                      list[index] = next;
                                      return {
                                        ...current,
                                        refreshResponseMappings: list,
                                      };
                                    })
                                  }
                                  disabled={mapping.formula?.type !== 'divide'}
                                  className="w-full h-12 min-h-12 py-0 w-full rounded-2xl border border-border/60 bg-muted/10 px-5 text-sm font-bold outline-none transition-all focus:border-emerald-500/40 focus:bg-background focus:ring-4 focus:ring-emerald-500/10 disabled:opacity-50"
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  updateRefreshTokenRegion((current) => {
                                    const list = Array.isArray(current.refreshResponseMappings)
                                      ? [...current.refreshResponseMappings]
                                      : [...refreshResponseMappings];
                                    list.splice(index, 1);
                                    return {
                                      ...current,
                                      refreshResponseMappings: list.length > 0 ? list : [],
                                    };
                                  })
                                }
                                className="flex h-12 w-full md:w-12 shrink-0 items-center justify-center rounded-2xl border border-border/40 bg-muted/10 text-muted-foreground transition-all hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-500 active:scale-95"
                                title="删除字段映射"
                              >
                                <Trash2 className="h-5 w-5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                      </>
                    ) : null}
                  </div>
                ) : activeSection !== 'middle' ? (
                  <div className="mt-3 space-y-3">
                    {(() => {
                      const metricKey =
                        activeSection === 'vendor_remaining'
                          ? 'vendor_remaining'
                          : activeSection === 'vendor_used'
                            ? 'vendor_used'
                            : activeSection === 'endpoint_remaining'
                              ? 'endpoint_remaining'
                              : activeSection === 'endpoint_used'
                                ? 'endpoint_used'
                                : 'endpoint_total';
                      const metric = regionConfig.regions[metricKey] ?? defaultMetricRegion();
                      const fieldLabel =
                        activeSection === 'vendor_remaining'
                          ? '供应商余额字段路径'
                          : activeSection === 'vendor_used'
                            ? '供应商已用字段路径'
                            : activeSection === 'endpoint_remaining'
                              ? '端点余额字段路径'
                              : activeSection === 'endpoint_used'
                                ? '端点已用字段路径'
                                : '端点总额字段路径';
                      const formulaLabel =
                        activeSection === 'vendor_remaining'
                          ? '供应商余额'
                          : activeSection === 'vendor_used'
                            ? '供应商已用'
                            : activeSection === 'endpoint_remaining'
                              ? '端点余额'
                              : activeSection === 'endpoint_used'
                                ? '端点已用'
                                : '端点总额';
                      const isVendorMetricSection =
                        activeSection === 'vendor_remaining' || activeSection === 'vendor_used';
                      const isEndpointMetricSection =
                        activeSection === 'endpoint_remaining' || activeSection === 'endpoint_used';
                      const isEndpointTotalSection = activeSection === 'endpoint_total';
                      const vendorEndpointSumToggleLabel =
                        activeSection === 'vendor_remaining' ? '参与服务商余额求和' : '参与服务商已用求和';
                      const scopedCustomEnvVars = envVars;

                      return (
                        <>
                          {isVendorMetricSection ? (
                            <div className="space-y-1 rounded-lg border border-border/70 bg-muted/20 p-3">
                              <label className="text-xs font-medium text-muted-foreground">汇总方式</label>
                              <div className="inline-flex h-12 w-full items-center rounded-2xl border border-border/60 bg-muted/10 p-1 shadow-sm">
                                <button
                                  type="button"
                                  className={`h-full flex-1 rounded-xl text-xs font-bold transition-all duration-200 ${
                                    currentVendorAggregateMode === 'independent_request'
                                      ? 'bg-background text-foreground shadow-md ring-1 ring-border/20'
                                      : 'text-muted-foreground hover:bg-white/40 hover:text-foreground'                                  }`}
                                  onClick={() =>
                                    updateVendorAggregateMode(
                                      activeSection === 'vendor_remaining' ? 'vendor_remaining' : 'vendor_used',
                                      'independent_request',
                                    )
                                  }
                                >
                                  独立请求
                                </button>
                                <button
                                  type="button"
                                  className={`h-full flex-1 rounded-xl text-xs font-bold transition-all duration-200 ${
                                    currentVendorAggregateMode === 'endpoint_sum'
                                      ? 'bg-background text-foreground shadow-md ring-1 ring-border/20'
                                      : 'text-muted-foreground hover:bg-white/40 hover:text-foreground'                                  }`}
                                  onClick={() =>
                                    updateVendorAggregateMode(
                                      activeSection === 'vendor_remaining' ? 'vendor_remaining' : 'vendor_used',
                                      'endpoint_sum',
                                    )
                                  }
                                >
                                  端点求和
                                </button>
                              </div>
                            </div>
                          ) : null}
                          {isEndpointTotalSection ? (
                            <div className="space-y-1 rounded-lg border border-border/70 bg-muted/20 p-3">
                              <label className="text-xs font-medium text-muted-foreground">总额计算方式</label>
                              <div className="inline-flex h-12 w-full items-center rounded-2xl border border-border/60 bg-muted/10 p-1 shadow-sm">
                                <button
                                  type="button"
                                  className={`h-full flex-1 rounded-xl text-xs font-bold transition-all duration-200 ${
                                    endpointTotalMode === 'independent_request'
                                      ? 'bg-background text-foreground shadow-md ring-1 ring-border/20'
                                      : 'text-muted-foreground hover:bg-white/40 hover:text-foreground'                                  }`}
                                  onClick={() => updateEndpointTotalMode('independent_request')}
                                >
                                  独立请求
                                </button>
                                <button
                                  type="button"
                                  className={`h-full flex-1 rounded-xl text-xs font-bold transition-all duration-200 ${
                                    endpointTotalMode === 'sum_from_parts'
                                      ? 'bg-background text-foreground shadow-md ring-1 ring-border/20'
                                      : 'text-muted-foreground hover:bg-white/40 hover:text-foreground'                                  }`}
                                  onClick={() => updateEndpointTotalMode('sum_from_parts')}
                                >
                                  加和计算
                                </button>
                                <button
                                  type="button"
                                  className={`h-full flex-1 rounded-xl text-xs font-bold transition-all duration-200 ${
                                    endpointTotalMode === 'manual_total'
                                      ? 'bg-background text-foreground shadow-md ring-1 ring-border/20'
                                      : 'text-muted-foreground hover:bg-white/40 hover:text-foreground'                                  }`}
                                  onClick={() => updateEndpointTotalMode('manual_total')}
                                >
                                  手动设置
                                </button>
                              </div>
                            </div>
                          ) : null}
                          {isEndpointMetricSection ? (
                            <div className="space-y-1 rounded-lg border border-border/70 bg-muted/20 p-3">
                              <label className="text-xs font-medium text-muted-foreground">计算方式</label>
                              <div className="inline-flex h-12 w-full items-center rounded-2xl border border-border/60 bg-muted/10 p-1 shadow-sm">
                                <button
                                  type="button"
                                  className={`h-full flex-1 rounded-xl text-xs font-bold transition-all duration-200 ${
                                    currentEndpointMetricMode === 'independent_request'
                                      ? 'bg-background text-foreground shadow-md ring-1 ring-border/20'
                                      : 'text-muted-foreground hover:bg-white/40 hover:text-foreground'                                  }`}
                                  onClick={() =>
                                    updateEndpointMetricMode(
                                      activeSection === 'endpoint_remaining' ? 'endpoint_remaining' : 'endpoint_used',
                                      'independent_request',
                                    )
                                  }
                                >
                                  独立请求
                                </button>
                                <button
                                  type="button"
                                  className={`h-full flex-1 rounded-xl text-xs font-bold transition-all duration-200 ${
                                    currentEndpointMetricMode === 'subtract_from_total'
                                      ? 'bg-background text-foreground shadow-md ring-1 ring-border/20'
                                      : 'text-muted-foreground hover:bg-white/40 hover:text-foreground'                                  }`}
                                  onClick={() =>
                                    updateEndpointMetricMode(
                                      activeSection === 'endpoint_remaining' ? 'endpoint_remaining' : 'endpoint_used',
                                      'subtract_from_total',
                                    )
                                  }
                                >
                                  减法计算
                                </button>
                              </div>
                            </div>
                          ) : null}

                          {isVendorMetricSection && currentVendorAggregateMode === 'endpoint_sum' ? (
                            <div className="rounded-lg border border-amber-200/80 bg-amber-50/40 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                              当前区域使用端点求和。可在控制台端点配置里通过“{vendorEndpointSumToggleLabel}”开关控制每个端点是否纳入汇总。
                            </div>
                          ) : isEndpointTotalSection && endpointTotalMode === 'sum_from_parts' ? (
                            <div className="rounded-lg border border-amber-200/80 bg-amber-50/40 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                              当前为「加和计算」模式，加载后自动按「端点余额 + 端点已用」计算端点总额。
                            </div>
                          ) : isEndpointTotalSection && endpointTotalMode === 'manual_total' ? (
                            <>
                              <div className="rounded-lg border border-amber-200/80 bg-amber-50/40 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                                当前为「手动设置」模式，需要在各个端点中手动独立设置环境变量 totalAmount 作为总额。
                              </div>
                              <AvailableEnvVarsPanel
                                customEnvVars={scopedCustomEnvVars}
                                onAddEnvVar={onAddEnvVar}
                                onEditEnvVar={onEditEnvVar}
                                onRemoveEnvVar={onRemoveEnvVar}
                              />
                            </>
                          ) : isEndpointMetricSection && currentEndpointMetricMode === 'subtract_from_total' ? (
                            <div className="rounded-lg border border-amber-200/80 bg-amber-50/40 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                              {activeSection === 'endpoint_remaining'
                                ? '当前为「减法计算」模式，加载后自动按「端点总额 - 端点已用」计算端点余额。'
                                : '当前为「减法计算」模式，加载后自动按「端点总额 - 端点余额」计算端点已用。'}
                            </div>
                          ) : (
                            <>
                          <div className="space-y-3 rounded-lg border border-sky-200/80 bg-sky-50/30 p-3 dark:border-sky-500/30 dark:bg-sky-500/5">
                            <div className="space-y-0.5">
                              <div className="text-sm font-semibold text-foreground">请求发送配置</div>
                            </div>
                            <div className="grid gap-6 md:grid-cols-[180px_1fr_320px] items-start px-1">
                              <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground ml-1">HTTP 方法</label>
                                <Select
                                  value={metric.method}
                                  onValueChange={(value) =>
                                    updateMetricRegion(metricKey, (current) => ({
                                      ...current,
                                      method: value as 'GET' | 'POST' | 'PUT',
                                    }))
                                  }
                                >
                                  <SelectTrigger className="w-full h-12 min-h-12 py-0 rounded-2xl border-border/60 bg-muted/10 px-5 font-bold focus:ring-primary/20"><SelectValue /></SelectTrigger>
                                  <SelectContent className="rounded-xl border-border/40 shadow-xl">
                                    <SelectItem value="GET" className="rounded-lg font-medium">GET</SelectItem>
                                    <SelectItem value="POST" className="rounded-lg font-medium">POST</SelectItem>
                                    <SelectItem value="PUT" className="rounded-lg font-medium">PUT</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <RequestPathField
                                label="请求 URL 路径"
                                value={metric.path}
                                onChangePath={(value) =>
                                  updateMetricRegion(metricKey, (current) => ({
                                    ...current,
                                    path: value,
                                  }))
                                }
                                replacements={metric.baseUrlReplacements}
                                onChangeReplacements={(rules) =>
                                  updateMetricRegion(metricKey, (current) => ({
                                    ...current,
                                    baseUrlReplacements: rules,
                                  }))
                                }
                                placeholder="/v1/dashboard/billing/usage"
                              />
                              <RequestAutoHandleSwitches
                                config={metric}
                                onChange={(next) => updateMetricRegion(metricKey, (current) => ({ ...current, ...next }))}
                                allowAuto401={refreshTokenFeatureEnabled}
                              />
                            </div>

                            <RequestConfigEditor
                              config={metric}
                              onChange={(next) => updateMetricRegion(metricKey, () => ({ ...metric, ...next }))}
                              customEnvVars={scopedCustomEnvVars}
                              onAddEnvVar={onAddEnvVar}
                              onEditEnvVar={onEditEnvVar}
                              onRemoveEnvVar={onRemoveEnvVar}
                              onValidationChange={onRequestJsonValidationChange}
                            />
                          </div>

                          <div className="space-y-4 rounded-2xl border border-emerald-200/80 bg-emerald-50/30 p-5 dark:border-emerald-500/30 dark:bg-emerald-500/5">
                            <div className="flex items-center gap-2 border-b border-emerald-200/80 dark:border-emerald-500/30 pb-3">
                              <div className="h-4 w-1 rounded-full bg-emerald-500" />
                              <div className="text-sm font-bold text-foreground">字段提取与计算</div>
                            </div>
                            <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(160px,1fr)_minmax(120px,0.8fr)]">
                              <InputField
                                label={fieldLabel}
                                value={metric.field ?? ''}
                                onChange={(value) =>
                                  updateMetricRegion(metricKey, (current) => ({
                                    ...current,
                                    field: value || null,
                                  }))
                                }
                                placeholder="如 data.quota.remaining"
                                mono
                              />
                              <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{formulaLabel}公式</label>
                                <Select
                                  value={metric.formula?.type ?? 'direct'}
                                  onValueChange={(value) =>
                                    updateMetricRegion(metricKey, (current) => ({
                                      ...current,
                                      formula:
                                        value === 'divide'
                                          ? {
                                              type: 'divide',
                                              divisor: current.formula?.type === 'divide' ? (current.formula.divisor ?? 1) : 1,
                                            }
                                          : { type: 'direct' },
                                    }))
                                  }
                                >
                                  <SelectTrigger className="w-full h-12 min-h-12 py-0 rounded-2xl border-border/60 bg-muted/10 px-5 font-bold focus:ring-primary/20"><SelectValue /></SelectTrigger>
                                  <SelectContent className="rounded-xl border-border/40 shadow-xl">
                                    <SelectItem value="direct" className="rounded-lg font-medium">直接使用</SelectItem>
                                    <SelectItem value="divide" className="rounded-lg font-medium">除以系数</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-2 animate-in fade-in slide-in-from-left-2" style={{ display: metric.formula?.type === 'divide' ? 'block' : 'none' }}>
                                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">转换系数</label>
                                <input
                                  type="number"
                                  value={metric.formula?.type === 'divide' ? (metric.formula.divisor ?? 1) : 1}
                                  onChange={(event) =>
                                    updateMetricRegion(metricKey, (current) => ({
                                      ...current,
                                      formula: {
                                        type: 'divide',
                                        divisor: Number(event.target.value) || 1,
                                      },
                                    }))
                                  }
                                  disabled={metric.formula?.type !== 'divide'}
                                  className="w-full h-12 min-h-12 py-0 w-full rounded-2xl border border-border/60 bg-muted/10 px-4 text-sm font-bold outline-none transition-all focus:border-primary/40 focus:bg-background focus:ring-4 focus:ring-primary/10 shadow-sm disabled:opacity-50"
                                />
                              </div>
                            </div>
                          </div>
                            </>
                          )}
                        </>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">显示模式</label>
                  <div className="inline-flex h-12 w-full items-center rounded-2xl border border-border/60 bg-muted/10 p-1 shadow-sm">
                    <button
                      type="button"
                      className={`h-full flex-1 rounded-xl text-xs font-bold transition-all duration-200 ${
                        middleMode === 'token_usage'
                          ? 'bg-background text-foreground shadow-md ring-1 ring-border/20'
                          : 'text-muted-foreground hover:bg-white/40 hover:text-foreground'                      }`}
                      onClick={() => updateMiddleMode('token_usage')}
                    >
                      已用/剩余Token
                    </button>
                    <button
                      type="button"
                      className={`h-full flex-1 rounded-xl text-xs font-bold transition-all duration-200 ${
                        middleMode === 'reset_date'
                          ? 'bg-background text-foreground shadow-md ring-1 ring-border/20'
                          : 'text-muted-foreground hover:bg-white/40 hover:text-foreground'                      }`}
                      onClick={() => updateMiddleMode('reset_date')}
                    >
                      上次重置日期
                    </button>
                    <button
                      type="button"
                      className={`h-full flex-1 rounded-xl text-xs font-bold transition-all duration-200 ${
                        middleMode === 'none'
                          ? 'bg-background text-foreground shadow-md ring-1 ring-border/20'
                          : 'text-muted-foreground hover:bg-white/40 hover:text-foreground'                      }`}
                      onClick={() => updateMiddleMode('none')}
                    >
                      不显示
                    </button>
                  </div>
                </div>
                {middleMode !== 'none' && (
                  <div className="space-y-3">
                    {middleMode === 'token_usage' && tokenUsageRegion ? (
                      <>
                        <div className="space-y-3 rounded-lg border border-sky-200/80 bg-sky-50/30 p-3 dark:border-sky-500/30 dark:bg-sky-500/5">
                          <div className="space-y-0.5">
                            <div className="text-sm font-semibold text-foreground">请求发送配置</div>
                          </div>
                          <div className="grid gap-6 md:grid-cols-[180px_1fr_320px] items-start px-1">
                            <div className="space-y-2">
                              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground ml-1">HTTP 方法</label>
                              <Select
                                value={tokenUsageRegion.method}
                                onValueChange={(value) =>
                                  updateTokenUsageRegion((current) => ({
                                    ...current,
                                    method: value as 'GET' | 'POST' | 'PUT',
                                  }))
                                }
                              >
                                <SelectTrigger className="w-full h-12 min-h-12 py-0 rounded-2xl border-border/60 bg-muted/10 px-5 font-bold focus:ring-primary/20"><SelectValue /></SelectTrigger>
                                <SelectContent className="rounded-xl border-border/40 shadow-xl">
                                  <SelectItem value="GET" className="rounded-lg font-medium">GET</SelectItem>
                                  <SelectItem value="POST" className="rounded-lg font-medium">POST</SelectItem>
                                  <SelectItem value="PUT" className="rounded-lg font-medium">PUT</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <RequestPathField
                              label="请求 URL 路径"
                              value={tokenUsageRegion.path}
                              onChangePath={(value) =>
                                updateTokenUsageRegion((current) => ({
                                  ...current,
                                  path: value,
                                }))
                              }
                              replacements={tokenUsageRegion.baseUrlReplacements}
                              onChangeReplacements={(rules) =>
                                updateTokenUsageRegion((current) => ({
                                  ...current,
                                  baseUrlReplacements: rules,
                                }))
                              }
                              placeholder="/api/usage/token/"
                            />
                            <RequestAutoHandleSwitches
                              config={tokenUsageRegion}
                              onChange={(next) => updateTokenUsageRegion((current) => ({ ...current, ...next }))}
                              allowAuto401={refreshTokenFeatureEnabled}
                            />
                          </div>

                            <RequestConfigEditor
                              config={tokenUsageRegion}
                              onChange={(next) => updateTokenUsageRegion((current) => ({ ...current, ...next }))}
                              customEnvVars={allCustomEnvVars}
                              onAddEnvVar={onAddEnvVar}
                              onEditEnvVar={onEditEnvVar}
                              onRemoveEnvVar={onRemoveEnvVar}
                              onValidationChange={onRequestJsonValidationChange}
                            />
                        </div>

                        <div className="space-y-4 rounded-2xl border border-emerald-200/80 bg-emerald-50/30 p-5 dark:border-emerald-500/30 dark:bg-emerald-500/5">
                          <div className="flex items-center gap-2 border-b border-emerald-200/80 dark:border-emerald-500/30 pb-3">
                            <div className="h-4 w-1 rounded-full bg-emerald-500" />
                            <div className="text-sm font-bold text-foreground">字段提取与计算</div>
                          </div>
                          <div className="grid gap-6 md:grid-cols-2">
                            <InputField
                              label="已用Token字段"
                              value={tokenUsageRegion.usedField ?? ''}
                              onChange={(value) =>
                                updateTokenUsageRegion((current) => ({
                                  ...current,
                                  usedField: value || null,
                                }))
                              }
                              placeholder="如 total_used"
                              mono
                            />
                            <InputField
                              label="剩余Token字段"
                              value={tokenUsageRegion.remainingField ?? ''}
                              onChange={(value) =>
                                updateTokenUsageRegion((current) => ({
                                  ...current,
                                  remainingField: value || null,
                                }))
                              }
                              placeholder="如 total_available"
                              mono
                            />
                          </div>
                          <div className="grid gap-6 md:grid-cols-2">
                            <FormulaEditor
                              label="已用Token"
                              formula={tokenUsageRegion.usedFormula ?? null}
                              onChange={(formula) =>
                                updateTokenUsageRegion((current) => ({
                                  ...current,
                                  usedFormula: formula,
                                }))
                              }
                            />
                            <FormulaEditor
                              label="剩余Token"
                              formula={tokenUsageRegion.remainingFormula ?? null}
                              onChange={(formula) =>
                                updateTokenUsageRegion((current) => ({
                                  ...current,
                                  remainingFormula: formula,
                                }))
                              }
                            />
                          </div>
                        </div>
                      </>
                    ) : null}
                    {middleMode === 'reset_date' && resetDateRegion ? (
                      <>
                        <div className="space-y-3 rounded-lg border border-sky-200/80 bg-sky-50/30 p-3 dark:border-sky-500/30 dark:bg-sky-500/5">
                          <div className="space-y-0.5">
                            <div className="text-sm font-semibold text-foreground">请求发送配置</div>
                          </div>
                          <div className="grid gap-6 md:grid-cols-[180px_1fr_320px] items-start px-1">
                            <div className="space-y-2">
                              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground ml-1">HTTP 方法</label>
                              <Select
                                value={resetDateRegion.method}
                                onValueChange={(value) =>
                                  updateResetDateRegion((current) => ({
                                    ...current,
                                    method: value as 'GET' | 'POST' | 'PUT',
                                  }))
                                }
                              >
                                <SelectTrigger className="w-full h-12 min-h-12 py-0 rounded-2xl border-border/60 bg-muted/10 px-5 font-bold focus:ring-primary/20"><SelectValue /></SelectTrigger>
                                <SelectContent className="rounded-xl border-border/40 shadow-xl">
                                  <SelectItem value="GET" className="rounded-lg font-medium">GET</SelectItem>
                                  <SelectItem value="POST" className="rounded-lg font-medium">POST</SelectItem>
                                  <SelectItem value="PUT" className="rounded-lg font-medium">PUT</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <RequestPathField
                              label="请求 URL 路径"
                              value={resetDateRegion.path}
                              onChangePath={(value) =>
                                updateResetDateRegion((current) => ({
                                  ...current,
                                  path: value,
                                }))
                              }
                              replacements={resetDateRegion.baseUrlReplacements}
                              onChangeReplacements={(rules) =>
                                updateResetDateRegion((current) => ({
                                  ...current,
                                  baseUrlReplacements: rules,
                                }))
                              }
                              placeholder="/api/auth/me"
                            />
                            <RequestAutoHandleSwitches
                              config={resetDateRegion}
                              onChange={(next) => updateResetDateRegion((current) => ({ ...current, ...next }))}
                              allowAuto401={refreshTokenFeatureEnabled}
                            />
                          </div>

                          <RequestConfigEditor
                            config={resetDateRegion}
                            onChange={(next) => updateResetDateRegion((current) => ({ ...current, ...next }))}
                            customEnvVars={allCustomEnvVars}
                            onAddEnvVar={onAddEnvVar}
                            onEditEnvVar={onEditEnvVar}
                            onRemoveEnvVar={onRemoveEnvVar}
                            onValidationChange={onRequestJsonValidationChange}
                          />
                        </div>

                        <div className="space-y-4 rounded-2xl border border-emerald-200/80 bg-emerald-50/30 p-5 dark:border-emerald-500/30 dark:bg-emerald-500/5">
                          <div className="flex items-center gap-2 border-b border-emerald-200/80 dark:border-emerald-500/30 pb-3">
                            <div className="h-4 w-1 rounded-full bg-emerald-500" />
                            <div className="text-sm font-bold text-foreground">字段提取与计算</div>
                          </div>
                          <InputField
                            label="重置时间字段路径"
                            value={resetDateRegion.resetField ?? ''}
                            onChange={(value) =>
                              updateResetDateRegion((current) => ({
                                ...current,
                                resetField: value || null,
                              }))
                            }
                            placeholder="如 lastCreditReset"
                            mono
                          />
                        </div>
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        </div>

      </CardContent>
    </Card>
  );
}

export function VendorDefinitionEditor({ definition, isNew, onSave, onCancel }: {
  definition: VendorDefinition | null;
  isNew: boolean;
  onSave: (data: {
    vendorType: string;
    displayName: string;
    description: string | null;
    regionConfig: VendorRegionConfig;
    envVars: VendorEnvVarDefinition[];
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const withEditorRegionDefaults = (value: VendorRegionConfig): VendorRegionConfig => {
    const refreshTokenRaw =
      value.refreshToken === undefined
        ? defaultRefreshTokenRegion()
        : value.refreshToken;
    const dailyCheckinRaw =
      value.dailyCheckin === undefined
        ? defaultDailyCheckinRegion()
        : value.dailyCheckin;
    const refreshTokenNormalized = refreshTokenRaw
      ? {
          ...refreshTokenRaw,
          refreshResponseMappings:
            Array.isArray(refreshTokenRaw.refreshResponseMappings) && refreshTokenRaw.refreshResponseMappings.length > 0
              ? refreshTokenRaw.refreshResponseMappings
              : defaultRefreshResponseMappings(),
        }
      : refreshTokenRaw;
    const dailyCheckinNormalized = dailyCheckinRaw
      ? {
          ...dailyCheckinRaw,
          awardedFormula: dailyCheckinRaw.awardedFormula ?? { type: 'direct' },
        }
      : dailyCheckinRaw;

    return {
      ...value,
      refreshTokenEnabled: value.refreshTokenEnabled !== false,
      refreshToken: refreshTokenNormalized,
      dailyCheckinEnabled: value.dailyCheckinEnabled === true,
      dailyCheckin: dailyCheckinNormalized,
      endpointMetricModes: {
        endpoint_remaining: value.endpointMetricModes?.endpoint_remaining === 'subtract_from_total' ? 'subtract_from_total' : 'independent_request',
        endpoint_used: value.endpointMetricModes?.endpoint_used === 'subtract_from_total' ? 'subtract_from_total' : 'independent_request',
      },
      aggregation: {
        vendor_remaining: value.aggregation?.vendor_remaining ?? 'independent_request',
        vendor_used: value.aggregation?.vendor_used ?? 'endpoint_sum',
      },
    };
  };

  const hasAggregationFallback =
    definition !== null
    && definition !== undefined
    && (definition.regionConfig?.aggregation === undefined
      || definition.regionConfig?.aggregation === null);
  const hasEndpointTotalModeFallback =
    definition !== null
    && definition !== undefined
    && (definition.regionConfig?.endpointTotalMode === undefined
      || definition.regionConfig?.endpointTotalMode === null);
  const [vendorType, setVendorType] = useState(definition?.vendorType ?? '');
  const [displayName, setDisplayName] = useState(definition?.displayName ?? '');
  const [description, setDescription] = useState(definition?.description ?? '');
  const [regionConfig, setRegionConfig] = useState<VendorRegionConfig>(
    withEditorRegionDefaults(definition?.regionConfig ?? emptyRegionConfig()),
  );
  const [envVars, setEnvVars] = useState<VendorEnvVarDefinition[]>(definition?.envVars ?? []);
  const [envVarDialogOpen, setEnvVarDialogOpen] = useState(false);
  const [envVarKeyDraft, setEnvVarKeyDraft] = useState('');
  const [envVarLabelDraft, setEnvVarLabelDraft] = useState('');
  const [envVarMeaningDraft, setEnvVarMeaningDraft] = useState('');
  const [envVarOptionalDraft, setEnvVarOptionalDraft] = useState(false);
  const [envVarDefaultDraft, setEnvVarDefaultDraft] = useState('');
  const [envVarScopeDraft, setEnvVarScopeDraft] = useState<'vendor' | 'endpoint'>('endpoint');
  const [editingEnvVarKey, setEditingEnvVarKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sectionSelectionResetToken, setSectionSelectionResetToken] = useState(0);
  const [requestJsonValidation, setRequestJsonValidation] = useState<RequestJsonValidationState>({
    hasError: false,
    issues: [],
  });
  const isEditingEnvVar = editingEnvVarKey !== null;
  const isEditingLockedEnvVar = isTotalAmountEnvKey(editingEnvVarKey);

  useEffect(() => {
    setEnvVars((current) => {
      if (regionConfig.endpointTotalMode === 'manual_total') {
        if (current.some((item) => isTotalAmountEnvKey(item.key))) {
          return current;
        }
        return [...current, createTotalAmountEnvVarDefinition()];
      }

      const filtered = current.filter((item) => !isTotalAmountEnvKey(item.key));
      return filtered.length === current.length ? current : filtered;
    });

    if (regionConfig.endpointTotalMode !== 'manual_total' && isTotalAmountEnvKey(editingEnvVarKey)) {
      setEditingEnvVarKey(null);
    }
  }, [editingEnvVarKey, regionConfig.endpointTotalMode]);

  const saveEnvVar = () => {
    const key = isEditingLockedEnvVar ? TOTAL_AMOUNT_ENV_KEY : normalizeEnvVarKey(envVarKeyDraft);
    if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      toast.warning('环境变量格式错误', '英文名仅支持英文、数字、下划线，且不能以数字开头');
      return;
    }
    const label = envVarLabelDraft.trim();
    if (!label) {
      toast.warning('环境变量格式错误', '环境变量中文名不能为空');
      return;
    }
    const duplicated = envVars.some(
      (item) =>
        item.key.toLowerCase() === key.toLowerCase()
        && item.key.toLowerCase() !== (editingEnvVarKey ?? '').toLowerCase(),
    );
    if (duplicated) {
      toast.warning('环境变量重复', `变量 $${key} 已存在`);
      return;
    }
    const meaning = envVarMeaningDraft.trim();
    const nextEnvVar: VendorEnvVarDefinition = {
      key,
      label,
      scope: envVarScopeDraft,
      meaning: meaning || null,
      optional: envVarOptionalDraft,
      defaultValue: envVarOptionalDraft ? (envVarDefaultDraft.trim() || null) : null,
    };
    setEnvVars((current) => {
      if (!editingEnvVarKey) {
        return [...current, nextEnvVar];
      }
      return current.map((item) => (item.key === editingEnvVarKey ? nextEnvVar : item));
    });
    setEnvVarKeyDraft('');
    setEnvVarLabelDraft('');
    setEnvVarMeaningDraft('');
    setEnvVarOptionalDraft(false);
    setEnvVarDefaultDraft('');
    setEnvVarScopeDraft('endpoint');
    setEditingEnvVarKey(null);
    setEnvVarDialogOpen(false);
  };

  const removeEnvVar = (key: string) => {
    if (isTotalAmountEnvKey(key)) {
      toast.warning('系统变量不可删除', '$totalAmount 用于手动设置端点总额，不能删除');
      return;
    }
    setEnvVars((current) => current.filter((item) => item.key !== key));
  };

  const openAddEnvVarDialog = () => {
    setEditingEnvVarKey(null);
    setEnvVarScopeDraft('endpoint');
    setEnvVarKeyDraft('');
    setEnvVarLabelDraft('');
    setEnvVarMeaningDraft('');
    setEnvVarOptionalDraft(false);
    setEnvVarDefaultDraft('');
    setEnvVarDialogOpen(true);
  };

  const openEditEnvVarDialog = (item: VendorEnvVarDefinition) => {
    setEditingEnvVarKey(item.key);
    setEnvVarScopeDraft(item.scope);
    setEnvVarKeyDraft(item.key);
    setEnvVarLabelDraft(item.label);
    setEnvVarMeaningDraft(item.meaning ?? '');
    setEnvVarOptionalDraft(Boolean(item.optional));
    setEnvVarDefaultDraft(item.defaultValue ?? '');
    setEnvVarDialogOpen(true);
  };

  const closeEnvVarDialog = () => {
    setEnvVarDialogOpen(false);
    setEditingEnvVarKey(null);
    setEnvVarKeyDraft('');
    setEnvVarLabelDraft('');
    setEnvVarMeaningDraft('');
    setEnvVarOptionalDraft(false);
    setEnvVarDefaultDraft('');
    setEnvVarScopeDraft('endpoint');
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      if (requestJsonValidation.hasError) {
        toast.error('保存失败', `请先修复 Params / Headers / Body 的 JSON 错误：${requestJsonValidation.issues.join('；')}`);
        return;
      }

      const undefinedVariableIssues = collectUndefinedTemplateVariableIssues(regionConfig, envVars);
      if (undefinedVariableIssues.length > 0) {
        toast.error('保存失败', `JSON 中存在未定义环境变量：${undefinedVariableIssues.join('；')}`);
        return;
      }

      const endpointRemainingMode = regionConfig.endpointMetricModes?.endpoint_remaining ?? 'independent_request';
      const endpointUsedMode = regionConfig.endpointMetricModes?.endpoint_used ?? 'independent_request';
      if (endpointRemainingMode === 'subtract_from_total' && endpointUsedMode === 'subtract_from_total') {
        toast.error('保存失败', '端点余额与端点已用不能同时设置为减法计算');
        return;
      }
      if (
        regionConfig.endpointTotalMode === 'sum_from_parts'
        && (endpointRemainingMode === 'subtract_from_total' || endpointUsedMode === 'subtract_from_total')
      ) {
        toast.error('保存失败', '端点总额为加和计算时，端点余额/端点已用不能使用减法计算');
        return;
      }
      if (regionConfig.endpointTotalMode === 'manual_total') {
        const totalAmountEnv = envVars.find((item) => isTotalAmountEnvKey(item.key));
        if (!totalAmountEnv) {
          toast.error('保存失败', '手动设置模式需要环境变量 $totalAmount，请先新增该变量');
          return;
        }
        if (totalAmountEnv.optional) {
          toast.error('保存失败', '手动设置模式下 $totalAmount 不能设为选填');
          return;
        }
      }

      const refreshMappings = regionConfig.refreshToken?.refreshResponseMappings ?? [];
      for (let i = 0; i < refreshMappings.length; i += 1) {
        const row = refreshMappings[i];
        const field = (row.field || '').trim();
        const envVarKey = normalizeEnvVarKey(row.envVarKey || '');
        if (!field) {
          toast.error('保存失败', `刷新令牌字段映射第 ${i + 1} 行缺少返回字段路径`);
          return;
        }
        if (!/^[A-Za-z0-9_]+(?:\[[0-9]+\])?(?:\.[A-Za-z0-9_]+(?:\[[0-9]+\])?)*$/.test(field)) {
          toast.error('保存失败', `刷新令牌字段映射第 ${i + 1} 行字段路径格式无效`);
          return;
        }
        if (!envVarKey || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(envVarKey)) {
          toast.error('保存失败', `刷新令牌字段映射第 ${i + 1} 行环境变量英文名无效`);
          return;
        }
      }

      await onSave({
        vendorType: vendorType.trim().toLowerCase(),
        displayName: displayName.trim(),
        description: description.trim() || null,
        regionConfig,
        envVars,
      });
      setSectionSelectionResetToken((current) => current + 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error('保存失败', message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      {(hasAggregationFallback || hasEndpointTotalModeFallback) ? (
        <div className="rounded-xl border border-amber-300/70 bg-amber-50/80 px-4 py-3 text-sm font-medium text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200 flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
            <span className="text-amber-600 dark:text-amber-400">!</span>
          </div>
          <p>
            当前定义缺少关键字段：
            {hasAggregationFallback ? ' aggregation' : ''}
            {hasAggregationFallback && hasEndpointTotalModeFallback ? '、' : ''}
            {hasEndpointTotalModeFallback ? ' endpointTotalMode' : ''}
            。编辑器已显示兼容回退值，请保存以写入显式定义并消除静默回退。
          </p>
        </div>
      ) : null}

      <div className="relative flex flex-wrap items-center justify-between gap-6 overflow-hidden rounded-3xl border border-border/50 bg-card/40 p-8 shadow-md backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.02]">
        <div className="absolute -left-20 -top-20 h-64 w-64 rounded-full bg-amber-500/5 blur-[100px]" />
        
        <div className="relative z-10 space-y-2">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 shadow-sm border border-amber-500/20">
              <Shapes className="h-6 w-6" />
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">
              {isNew ? '新增' : '编辑'} <span className="text-amber-500">类型</span>
              {!isNew && <span className="ml-4 text-xl text-muted-foreground font-medium italic">/ {definition?.displayName}</span>}
            </h1>
          </div>
          <p className="text-base text-muted-foreground">
            通过控制台式区域分配器，直接映射卡片并编辑各区域的 HTTP 接口、请求参数与提取计算逻辑。
          </p>
        </div>
        
        <div className="relative z-10">
          <Button 
            variant="outline" 
            onClick={onCancel}
            className="rounded-xl h-11 px-8 font-bold shadow-sm hover:bg-muted transition-all active:scale-95"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            返回列表
          </Button>
        </div>
      </div>

      <div className="space-y-8">
        <div className="space-y-8">
          <Card className="overflow-hidden border-border/40 shadow-xl backdrop-blur-xl">
            <CardHeader className="border-b bg-muted/30 p-6">
              <CardTitle className="flex items-center gap-2 text-lg">
                <div className="h-4 w-1 rounded-full bg-blue-500" />
                基本信息
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 md:p-8 space-y-6 bg-background/30">
              <div className="grid gap-6 md:grid-cols-2">
                <InputField
                  label="类型标识 (Vendor Type)"
                  value={vendorType}
                  onChange={setVendorType}
                  placeholder="如 my_custom_api"
                  disabled={!isNew}
                  mono
                />
                <InputField
                  label="显示名称 (Display Name)"
                  value={displayName}
                  onChange={setDisplayName}
                  placeholder="如 My Custom API"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">类型描述</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="请简要描述该服务商类型的适用范围和特点（可选）"
                  className="min-h-[100px] w-full resize-y rounded-2xl border border-border/60 bg-muted/10 px-5 py-4 text-sm font-medium outline-none transition-all focus:border-blue-500/40 focus:bg-background focus:ring-4 focus:ring-blue-500/10 shadow-sm"
                />
              </div>
            </CardContent>
          </Card>

          <DisplayCardConfigurator
            displayName={displayName}
            regionConfig={regionConfig}
            onChange={setRegionConfig}
            envVars={envVars}
            onAddEnvVar={openAddEnvVarDialog}
            onEditEnvVar={openEditEnvVarDialog}
            onRemoveEnvVar={removeEnvVar}
            selectionResetToken={sectionSelectionResetToken}
            onRequestJsonValidationChange={setRequestJsonValidation}
          />

          <div className="flex items-center justify-end gap-3 pt-6 pb-2">
            <Button 
              variant="outline" 
              onClick={onCancel} 
              disabled={saving}
              className="rounded-xl h-11 px-8 font-bold transition-all active:scale-95"
            >
              放弃修改
            </Button>
            <Button 
              onClick={handleSubmit} 
              disabled={saving}
              className="rounded-xl h-11 px-10 font-bold shadow-lg shadow-primary/20 transition-all active:scale-95"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  保存中...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-5 w-5" />
                  保存配置
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {envVarDialogOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm transition-all duration-300">
          <div className="w-full max-w-md overflow-hidden rounded-3xl border border-border/40 bg-background shadow-2xl animate-in fade-in zoom-in-95 duration-200" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border/40 bg-muted/20 px-6 py-5">
              <div className="text-lg font-bold tracking-tight">{isEditingEnvVar ? '编辑环境变量' : '新增环境变量'}</div>
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
                onClick={closeEnvVarDialog}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-6 px-6 py-6">
              <div className="space-y-4">
                <InputField
                  label="英文名（不含$）"
                  value={envVarKeyDraft}
                  onChange={setEnvVarKeyDraft}
                  placeholder="示例：orgId"
                  mono
                  disabled={isEditingLockedEnvVar}
                />
                {isEditingLockedEnvVar ? (
                  <div className="text-[11px] font-bold text-muted-foreground/80 bg-muted/20 p-2.5 rounded-lg border border-border/40">
                    * 系统变量 `$totalAmount` 的英文名固定，不可修改。
                  </div>
                ) : null}
              </div>
              <InputField
                label="中文名"
                value={envVarLabelDraft}
                onChange={setEnvVarLabelDraft}
                placeholder="例如 组织 ID"
              />
              <InputField
                label="值含义（可选）"
                value={envVarMeaningDraft}
                onChange={setEnvVarMeaningDraft}
                placeholder="示例：用于指定组织 ID，按组织维度发起查询"
              />
              <div className="flex flex-col gap-3 rounded-2xl border border-border/40 bg-muted/10 p-4">
                <label className="flex items-center justify-between gap-2 text-sm font-bold text-foreground cursor-pointer">
                  <span>允许选填该变量</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={envVarOptionalDraft}
                    data-state={envVarOptionalDraft ? 'checked' : 'unchecked'}
                    onClick={() => {
                      const next = !envVarOptionalDraft;
                      setEnvVarOptionalDraft(next);
                      if (!next) {
                        setEnvVarDefaultDraft('');
                      }
                    }}
                    className="peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-input focus-visible:border-ring focus-visible:ring-ring/50 dark:data-[state=unchecked]:bg-input/80 inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:ring-[3px] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span
                      data-state={envVarOptionalDraft ? 'checked' : 'unchecked'}
                      className="bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0"
                    />
                  </button>
                </label>
                {envVarOptionalDraft && (
                  <div className="flex items-center gap-3 pt-2 border-t border-border/40 animate-in fade-in slide-in-from-top-1">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground shrink-0">默认值</span>
                    <input
                      value={envVarDefaultDraft}
                      onChange={(event) => setEnvVarDefaultDraft(event.target.value)}
                      placeholder="未填则使用此值"
                      className="w-full h-12 min-h-12 py-0 w-full rounded-2xl border border-border/60 bg-background px-5 text-sm font-medium shadow-inner outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/40 dark:bg-black/20"
                    />
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-border/40 bg-muted/20 px-6 py-5">
              <Button type="button" variant="outline" onClick={closeEnvVarDialog} className="rounded-xl h-11 px-8 font-bold">
                取消
              </Button>
              <Button type="button" onClick={saveEnvVar} className="rounded-xl h-11 px-10 font-bold shadow-lg shadow-primary/20">
                {isEditingEnvVar ? '保存修改' : '确认添加'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
