'use client';

import { Activity, Sparkles, CalendarClock, Database, TrendingUp, LineChart } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatedStatCard } from '@/components/ui/animated-stat-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { withBasePath } from '@/lib/client/base-path';
import { toast } from '@/lib/toast';
import { cn, formatDateTime, formatUsd } from '@/lib/utils';

type VendorOption = {
  id: number;
  name: string;
  vendorType: string | null;
  envVars: Record<string, string>;
  displayOrder?: number | null;
  updatedAt: string | null;
};

type VendorBalanceHistoryRange = '6h' | '24h' | '3d' | '7d' | '30d' | '90d' | 'all';

type VendorBalanceHistoryPoint = {
  id: number;
  vendorId: number;
  vendorName: string;
  vendorType: string;
  remainingUsd: number | null;
  usedUsd: number | null;
  checkedAt: string;
  sourceScope: 'manual_refresh_all' | 'scheduled_refresh_all' | 'refresh_vendor' | 'refresh_endpoint';
  createdAt: string;
};

type VendorBalanceHistoryResponse = {
  ok: boolean;
  generatedAt: string;
  range: VendorBalanceHistoryRange;
  vendorId: number | null;
  vendor: VendorOption | null;
  vendors: VendorOption[];
  points: VendorBalanceHistoryPoint[];
  latestPoint: VendorBalanceHistoryPoint | null;
  message?: string;
};

type VendorBalanceDailyDelta = {
  dateKey: string;
  dateLabel: string;
  pointCount: number;
  startCheckedAt: string;
  endCheckedAt: string;
  remainingDelta: number | null;
  usedDelta: number | null;
};

const RANGE_OPTIONS: Array<{ value: VendorBalanceHistoryRange; label: string }> = [
  { value: '6h', label: '6 小时' },
  { value: '24h', label: '24 小时' },
  { value: '3d', label: '3 天' },
  { value: '7d', label: '7 天' },
  { value: '30d', label: '30 天' },
  { value: '90d', label: '90 天' },
  { value: 'all', label: '全部' },
];

function hasFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function resolveSourceLabel(sourceScope: VendorBalanceHistoryPoint['sourceScope']): string {
  if (sourceScope === 'scheduled_refresh_all') return '自动全量刷新';
  if (sourceScope === 'manual_refresh_all') return '手动全量刷新';
  if (sourceScope === 'refresh_vendor') return '按服务商刷新';
  return '按端点刷新';
}

function formatHistoryDateKey(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function formatHistoryDateLabel(value: string): string {
  return formatHistoryDateKey(value).replace(/\//g, '-');
}

function formatDeltaUsd(value: number | null): string {
  if (!hasFiniteNumber(value)) {
    return '-';
  }
  if (Math.abs(value) < 0.00005) {
    return '$0';
  }
  return `${value > 0 ? '+' : '-'}$${formatUsd(Math.abs(value))}`;
}

function HistoryTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{
    name?: string;
    value?: number | null;
    color?: string;
  }>;
  label?: number | string;
}) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const labelText = (() => {
    const date = new Date(Number(label));
    return Number.isNaN(date.getTime()) ? String(label ?? '-') : formatDateTime(date.toISOString());
  })();

  return (
    <div className="rounded-xl border border-border/60 bg-background/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <div className="mb-2 font-semibold text-foreground">{labelText}</div>
      <div className="space-y-1.5">
        {payload.map((item) => (
          <div key={item.name} className="flex items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 text-muted-foreground">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: item.color || 'currentColor' }}
              />
              {item.name}
            </div>
            <div className="font-medium text-foreground">
              {hasFiniteNumber(item.value) ? `$${formatUsd(item.value)}` : '-'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function historyDotStyle(color: string) {
  return {
    r: 3.5,
    fill: color,
    stroke: 'var(--background)',
    strokeWidth: 1.5,
  };
}

function historyActiveDotStyle(color: string) {
  return {
    r: 5,
    fill: color,
    stroke: 'var(--background)',
    strokeWidth: 2,
  };
}

function HistoryLineChart({
  points,
  showRemaining,
  showUsed,
}: {
  points: VendorBalanceHistoryPoint[];
  showRemaining: boolean;
  showUsed: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [chartWidth, setChartWidth] = useState(0);

  const chartData = useMemo(() => {
    const parsed = points
      .map((point) => {
        const timestamp = new Date(point.checkedAt).getTime();
        if (!Number.isFinite(timestamp)) {
          return null;
        }
        return {
          date: formatDateTime(point.checkedAt),
          timestamp,
          remaining: hasFiniteNumber(point.remainingUsd) ? point.remainingUsd : null,
          used: hasFiniteNumber(point.usedUsd) ? point.usedUsd : null,
        };
      })
      .filter((item): item is {
        date: string;
        timestamp: number;
        remaining: number | null;
        used: number | null;
      } => item !== null);

    return parsed.sort((a, b) => a.timestamp - b.timestamp);
  }, [points]);

  const visibleValues = useMemo(() => (
    chartData.flatMap((item) => [
      showRemaining && hasFiniteNumber(item.remaining) ? item.remaining : null,
      showUsed && hasFiniteNumber(item.used) ? item.used : null,
    ]).filter(hasFiniteNumber)
  ), [chartData, showRemaining, showUsed]);

  const yAxisDomain = useMemo<[number, number]>(() => {
    if (visibleValues.length === 0) {
      return [0, 100];
    }

    const minValue = Math.min(...visibleValues);
    const maxValue = Math.max(...visibleValues);
    if (minValue === maxValue) {
      const padding = Math.max(Math.abs(minValue) * 0.12, 1);
      const low = minValue - padding;
      return [minValue >= 0 ? Math.max(low, 0) : low, maxValue + padding];
    }

    const padding = (maxValue - minValue) * 0.12;
    const low = minValue - padding;
    return [minValue >= 0 ? Math.max(low, 0) : low, maxValue + padding];
  }, [visibleValues]);

  const hasVisibleSeries = showRemaining || showUsed;

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const update = () => {
      const nextWidth = Math.floor(element.getBoundingClientRect().width);
      setChartWidth(nextWidth > 0 ? nextWidth : 0);
    };

    update();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => {
        window.removeEventListener('resize', update);
      };
    }

    const observer = new ResizeObserver(() => {
      update();
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  if (points.length === 0) {
    return (
      <div className="flex h-[320px] items-center justify-center rounded-2xl border border-dashed border-border/70 bg-muted/20 text-sm text-muted-foreground">
        暂无历史数据，请先执行一次刷新。
      </div>
    );
  }

  const chartConfig = {
    remaining: {
      label: '服务商余额',
      color: 'rgb(34, 197, 94)',
    },
    used: {
      label: '服务商已用',
      color: 'rgb(244, 63, 94)',
    },
  };

  return (
    <div>
      <div ref={containerRef} className="rounded-2xl border border-border/60 bg-background px-1 py-4 sm:p-6">
        {!hasVisibleSeries ? (
          <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
            请至少显示一条曲线。
          </div>
        ) : chartWidth > 0 ? (
          <AreaChart
            width={chartWidth - 8}
            height={320}
            data={chartData}
            margin={{
              left: 12,
              right: 12,
              top: 12,
              bottom: 12,
            }}
          >
            <defs>
              <linearGradient id="fillRemainingHistory" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={chartConfig.remaining.color} stopOpacity={0.8} />
                <stop offset="95%" stopColor={chartConfig.remaining.color} stopOpacity={0.12} />
              </linearGradient>
              <linearGradient id="fillUsedHistory" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={chartConfig.used.color} stopOpacity={0.8} />
                <stop offset="95%" stopColor={chartConfig.used.color} stopOpacity={0.12} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="4 4" className="stroke-border/70" />
            <XAxis
              dataKey="timestamp"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={(value) => {
                const date = new Date(value);
                return isNaN(date.getTime()) ? String(value) : `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
              }}
              tick={{ fill: 'currentColor', className: 'fill-muted-foreground text-[11px]' }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              domain={yAxisDomain}
              tickFormatter={(value) => '$' + formatUsd(value)}
              tick={{ fill: 'currentColor', className: 'fill-muted-foreground text-[11px]' }}
            />
            <Tooltip
              cursor={false}
              content={<HistoryTooltip />}
            />
            {showRemaining ? (
              <Area
                dataKey="remaining"
                type="monotone"
                connectNulls={false}
                name={chartConfig.remaining.label}
                fill="url(#fillRemainingHistory)"
                stroke={chartConfig.remaining.color}
                strokeWidth={2}
                dot={historyDotStyle(chartConfig.remaining.color)}
                activeDot={historyActiveDotStyle(chartConfig.remaining.color)}
              />
            ) : null}
            {showUsed ? (
              <Area
                dataKey="used"
                type="monotone"
                connectNulls={false}
                name={chartConfig.used.label}
                fill="url(#fillUsedHistory)"
                stroke={chartConfig.used.color}
                strokeWidth={2}
                dot={historyDotStyle(chartConfig.used.color)}
                activeDot={historyActiveDotStyle(chartConfig.used.color)}
              />
            ) : null}
          </AreaChart>
        ) : (
          <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
            正在计算图表尺寸...
          </div>
        )}
      </div>
    </div>
  );
}

export function VendorBalanceHistoryPage({ initialData }: { initialData: VendorBalanceHistoryResponse }) {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [showRemaining, setShowRemaining] = useState(true);
  const [showUsed, setShowUsed] = useState(true);

  const toggleRemaining = useCallback(() => {
    if (showRemaining && !showUsed) {
      toast.error('至少保留一条曲线', '请至少显示“服务商余额”或“服务商已用”中的一条。');
      return;
    }
    setShowRemaining((current) => !current);
  }, [showRemaining, showUsed]);

  const toggleUsed = useCallback(() => {
    if (showUsed && !showRemaining) {
      toast.error('至少保留一条曲线', '请至少显示“服务商余额”或“服务商已用”中的一条。');
      return;
    }
    setShowUsed((current) => !current);
  }, [showRemaining, showUsed]);

  const loadData = useCallback(async (vendorId: number | null, range: VendorBalanceHistoryRange) => {
    const params = new URLSearchParams();
    if (vendorId) {
      params.set('vendorId', String(vendorId));
    }
    params.set('range', range);

    setLoading(true);
    try {
      const response = await fetch(withBasePath(`/api/vendor-balance-history?${params.toString()}`), {
        cache: 'no-store',
      });
      const body = (await response.json()) as VendorBalanceHistoryResponse;
      if (!response.ok || !body.ok) {
        throw new Error(body.message || '加载余额历史失败');
      }
      setData(body);
    } catch (error) {
      toast.error('加载余额历史失败', error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleVendorChange = useCallback((value: string) => {
    const vendorId = Number(value);
    if (!Number.isInteger(vendorId) || vendorId <= 0) {
      return;
    }
    void loadData(vendorId, data.range);
  }, [data.range, loadData]);

  const handleRangeChange = useCallback((range: VendorBalanceHistoryRange) => {
    if (range === data.range) {
      return;
    }
    void loadData(data.vendorId, range);
  }, [data.range, data.vendorId, loadData]);

  const latestPoint = data.latestPoint;
  const hasSelectedVendor = Number.isInteger(data.vendorId) && Number(data.vendorId) > 0;
  const latestTotal = latestPoint && hasFiniteNumber(latestPoint.remainingUsd) && hasFiniteNumber(latestPoint.usedUsd)
    ? latestPoint.remainingUsd + latestPoint.usedUsd
    : null;
  const tableRows = useMemo(() => [...data.points].reverse(), [data.points]);
  const dailyDeltas = useMemo<VendorBalanceDailyDelta[]>(() => {
    const points = [...data.points].sort((left, right) => left.checkedAt.localeCompare(right.checkedAt));
    const grouped = new Map<string, VendorBalanceHistoryPoint[]>();

    for (const point of points) {
      const dateKey = formatHistoryDateKey(point.checkedAt);
      const bucket = grouped.get(dateKey) ?? [];
      bucket.push(point);
      grouped.set(dateKey, bucket);
    }

    return Array.from(grouped.entries())
      .map(([dateKey, bucket]) => {
        const firstPoint = bucket[0];
        const lastPoint = bucket[bucket.length - 1];

        const remainingDelta =
          hasFiniteNumber(firstPoint?.remainingUsd) && hasFiniteNumber(lastPoint?.remainingUsd)
            ? lastPoint.remainingUsd - firstPoint.remainingUsd
            : null;
        const usedDelta =
          hasFiniteNumber(firstPoint?.usedUsd) && hasFiniteNumber(lastPoint?.usedUsd)
            ? lastPoint.usedUsd - firstPoint.usedUsd
            : null;

        return {
          dateKey,
          dateLabel: formatHistoryDateLabel(firstPoint.checkedAt),
          pointCount: bucket.length,
          startCheckedAt: firstPoint.checkedAt,
          endCheckedAt: lastPoint.checkedAt,
          remainingDelta,
          usedDelta,
        };
      })
      .sort((left, right) => right.dateKey.localeCompare(left.dateKey));
  }, [data.points]);

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-10 md:px-6">
      
      <div className="relative flex flex-wrap items-center justify-between gap-6 overflow-hidden rounded-3xl border border-border/50 bg-card/40 p-8 shadow-md backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.02]">
        <div className="absolute inset-0 bg-radial-[at_50%_-20%] from-blue-500/10 via-transparent to-transparent"></div>
        <div className="absolute -left-20 -top-20 h-64 w-64 rounded-full bg-blue-500/15 blur-[100px]"></div>
        <div className="absolute -right-20 -bottom-20 h-64 w-64 rounded-full bg-sky-500/15 blur-[100px]"></div>
        <div className="absolute -left-20 -top-20 h-64 w-64 rounded-full bg-emerald-500/15 blur-[100px]"></div>
        <div className="absolute -right-20 -bottom-20 h-64 w-64 rounded-full bg-sky-500/10 blur-[100px]"></div>
        
        <div className="relative z-10 space-y-2">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 shadow-sm border border-blue-500/20">
              <LineChart className="h-6 w-6" aria-hidden="true" />
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">余额历史 <span className="text-blue-500">中心</span></h1>
          </div>
          <p className="max-w-2xl text-base text-muted-foreground">自动记录服务商账户余额与已用快照，实时分析额度消费走势与历史波动记录。</p>
        </div>

        
      </div>

      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-5">
        <div className="flex w-full flex-col space-y-2.5 sm:w-auto">
          <label className="ml-1 flex h-5 items-center text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">服务商</label>
          <Select value={data.vendorId ? String(data.vendorId) : ''} onValueChange={handleVendorChange}>
            <SelectTrigger className="!h-10 py-0 !min-h-10 w-full rounded-xl border-border/50 bg-card/50 px-4 text-sm font-medium shadow-sm transition-colors hover:bg-muted/30 sm:w-[280px] flex items-center justify-between data-[placeholder]:text-muted-foreground">
              <SelectValue placeholder="请选择服务商" />
            </SelectTrigger>
            <SelectContent className="rounded-xl border-border/50 shadow-lg data-[state=open]:animate-none data-[state=closed]:animate-none data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100 data-[side=bottom]:slide-in-from-top-0 data-[side=left]:slide-in-from-right-0 data-[side=right]:slide-in-from-left-0 data-[side=top]:slide-in-from-bottom-0 data-[side=bottom]:translate-y-0 data-[side=left]:translate-x-0 data-[side=right]:translate-x-0 data-[side=top]:translate-y-0">
              {data.vendors.map((vendor) => (
                <SelectItem key={vendor.id} value={String(vendor.id)} className="rounded-lg text-sm focus:bg-emerald-500/15 focus:text-blue-600">
                  {vendor.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex w-full flex-col space-y-2.5 sm:w-auto">
          <label className="ml-1 flex h-5 items-center text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">时间范围</label>
          <div className="flex h-10 min-h-10 w-full items-center rounded-xl border border-border/40 bg-muted/40 p-1 shadow-sm sm:w-auto">
            {RANGE_OPTIONS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={cn(
                  "flex h-8 flex-1 items-center justify-center whitespace-nowrap rounded-lg px-4 text-sm font-medium leading-none transition-colors sm:flex-none sm:px-5",
                  data.range === item.value 
                    ? "bg-background text-foreground shadow-sm ring-1 ring-border/20" 
                    : "text-muted-foreground hover:text-foreground hover:bg-background/40"
                )}
                onClick={() => handleRangeChange(item.value)}
                disabled={loading}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {hasSelectedVendor ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <AnimatedStatCard
              title="当前余额"
              value={latestPoint && hasFiniteNumber(latestPoint.remainingUsd) ? `${formatUsd(latestPoint.remainingUsd)}` : '$-'}
              icon={Activity}
              glowClassName="bg-emerald-500/10"
              iconWrapClassName="bg-emerald-500/10 dark:bg-emerald-500/15"
              iconClassName="text-emerald-500"
              valueClassName="text-emerald-600 dark:text-emerald-400"
            />
            <AnimatedStatCard
              title="当前已用"
              value={latestPoint && hasFiniteNumber(latestPoint.usedUsd) ? `${formatUsd(latestPoint.usedUsd)}` : '$-'}
              icon={Database}
              glowClassName="bg-rose-500/10"
              iconWrapClassName="bg-rose-500/10 dark:bg-rose-500/15"
              iconClassName="text-rose-500"
              valueClassName="text-rose-600 dark:text-rose-400"
            />
            <AnimatedStatCard
              title="当前总额"
              value={latestTotal !== null ? `${formatUsd(latestTotal)}` : '$-'}
              icon={TrendingUp}
              glowClassName="bg-blue-500/10"
              iconWrapClassName="bg-blue-500/10 dark:bg-blue-500/15"
              iconClassName="text-blue-500"
              valueClassName="text-blue-600 dark:text-blue-400"
            />
            <AnimatedStatCard
              title="样本数"
              value={String(data.points.length)}
              icon={CalendarClock}
              glowClassName="bg-amber-500/10"
              iconWrapClassName="bg-amber-500/10 dark:bg-amber-500/15"
              iconClassName="text-amber-500"
              valueClassName="text-amber-600 dark:text-amber-400"
            />
          </div>

          <Card className="rounded-3xl border-border/60 shadow-sm">
            <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center lg:gap-4">
                <CardTitle>服务商账户动态</CardTitle>
                <div className="inline-flex w-fit max-w-full items-center rounded-full border border-border/60 bg-muted/30 px-3 py-1 text-sm text-muted-foreground">
                  <span className="truncate font-medium text-foreground">
                    {data.vendor?.name || '暂无可选服务商'}
                  </span>
                  <span className="truncate text-muted-foreground/80">
                    {`（${data.vendor?.vendorType || '未设置类型'}）`}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 lg:justify-end">
                <div className="flex items-center gap-3 text-xs font-medium text-muted-foreground">
                  <button
                    type="button"
                    onClick={toggleRemaining}
                    aria-pressed={showRemaining}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 transition-colors',
                      showRemaining
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-foreground'
                        : 'border-border/60 bg-muted/20 text-muted-foreground/70',
                    )}
                  >
                    <span className={cn('h-2.5 w-2.5 rounded-full', showRemaining ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
                    服务商余额
                  </button>
                  <button
                    type="button"
                    onClick={toggleUsed}
                    aria-pressed={showUsed}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 transition-colors',
                      showUsed
                        ? 'border-rose-500/30 bg-rose-500/10 text-foreground'
                        : 'border-border/60 bg-muted/20 text-muted-foreground/70',
                    )}
                  >
                    <span className={cn('h-2.5 w-2.5 rounded-full', showUsed ? 'bg-rose-500' : 'bg-muted-foreground/40')} />
                    服务商已用
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <HistoryLineChart
                points={data.points}
                showRemaining={showRemaining}
                showUsed={showUsed}
              />
            </CardContent>
          </Card>

          <div className="flex flex-col lg:flex-row gap-6 items-start">
            <Card className="rounded-3xl border-border/60 shadow-sm flex flex-col min-w-0 w-full lg:w-0 lg:grow-[7] max-h-[620px]">
              <CardHeader className="flex-none pb-4">
              <div className="mb-1 flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 shadow-sm border border-blue-500/20">
                  <Database className="h-4 w-4" aria-hidden="true" />
                </div>
                <CardTitle>历史明细</CardTitle>
              </div>
            </CardHeader>
              <CardContent className="flex-1 overflow-y-auto min-h-0 pt-0 custom-scrollbar pr-2 mr-2">
                {tableRows.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
                    当前筛选范围内还没有历史快照。
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-2xl border border-border/60 h-full">
                    <table className="min-w-full text-sm">
                      <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground sticky top-0 z-10 backdrop-blur-sm">
                        <tr>
                          <th className="px-4 py-3">时间</th>
                          <th className="px-4 py-3">余额</th>
                          <th className="px-4 py-3">已用</th>
                          <th className="px-4 py-3">总额</th>
                          <th className="px-4 py-3">来源</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tableRows.map((point, index) => {
                          const total = hasFiniteNumber(point.remainingUsd) && hasFiniteNumber(point.usedUsd)
                            ? point.remainingUsd + point.usedUsd
                            : null;
                          return (
                            <tr
                              key={point.id}
                              className={cn(
                                'border-t border-border/50 transition-colors hover:bg-muted/30',
                                index % 2 === 0 ? 'bg-background' : 'bg-muted/10',
                              )}
                            >
                              <td className="px-4 py-3 font-medium whitespace-nowrap">{formatDateTime(point.checkedAt)}</td>
                              <td className="px-4 py-3 text-emerald-600 dark:text-emerald-400 font-medium">
                                {hasFiniteNumber(point.remainingUsd) ? `${formatUsd(point.remainingUsd)}` : '-'}
                              </td>
                              <td className="px-4 py-3 text-rose-600 dark:text-rose-400 font-medium">
                                {hasFiniteNumber(point.usedUsd) ? `${formatUsd(point.usedUsd)}` : '-'}
                              </td>
                              <td className="px-4 py-3 font-medium text-muted-foreground">{total !== null ? `${formatUsd(total)}` : '-'}</td>
                              <td className="px-4 py-3 text-xs text-muted-foreground/80">{resolveSourceLabel(point.sourceScope)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-border/60 shadow-sm flex flex-col bg-card/60 backdrop-blur-sm min-w-0 w-full lg:w-0 lg:grow-[3] max-h-[620px]">
              <CardHeader className="flex-none pb-4">
                <div className="mb-1 flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 shadow-sm border border-blue-500/20">
                    <CalendarClock className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <CardTitle>按天汇总</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="flex-1 overflow-y-auto min-h-0 pt-0 pr-2 pb-4 pl-4 mr-2 custom-scrollbar">
                {tableRows.length === 0 ? (
                  <div className="text-center py-8 text-sm text-muted-foreground">暂无汇总数据</div>
                ) : dailyDeltas.length === 0 ? (
                  <div className="text-center py-8 text-sm text-muted-foreground">暂无有效汇总数据</div>
                ) : (
                  <div className="space-y-4">
                    {dailyDeltas.map((item) => (
                      <div
                        key={item.dateKey}
                        className="relative overflow-hidden rounded-2xl border border-border/50 bg-background/80 p-4 shadow-sm transition-all hover:shadow-md hover:border-border/80"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="font-semibold text-foreground flex items-center gap-2">
                            {item.dateLabel}
                          </div>
                          <div className="inline-flex items-center rounded-full bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground border border-border/40">
                            {item.pointCount} 次快照
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-3 mt-1">
                          <div className="flex flex-col gap-1 rounded-xl bg-emerald-500/5 px-3 py-2.5 border border-emerald-500/10">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600/70 dark:text-emerald-400/70">余额变动</span>
                            <span
                              className={cn(
                                'font-mono text-sm font-bold',
                                hasFiniteNumber(item.remainingDelta)
                                  ? item.remainingDelta > 0
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : item.remainingDelta < 0
                                      ? 'text-rose-600 dark:text-rose-400'
                                      : 'text-foreground/70'
                                  : 'text-muted-foreground'
                              )}
                            >
                              {formatDeltaUsd(item.remainingDelta)}
                            </span>
                          </div>
                          
                          <div className="flex flex-col gap-1 rounded-xl bg-rose-500/5 px-3 py-2.5 border border-rose-500/10">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-rose-600/70 dark:text-rose-400/70">已用变动</span>
                            <span
                              className={cn(
                                'font-mono text-sm font-bold',
                                hasFiniteNumber(item.usedDelta)
                                  ? item.usedDelta > 0
                                    ? 'text-rose-600 dark:text-rose-400'
                                    : item.usedDelta < 0
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : 'text-foreground/70'
                                  : 'text-muted-foreground'
                              )}
                            >
                              {formatDeltaUsd(item.usedDelta)}
                            </span>
                          </div>
                        </div>
                        <div className="mt-3 text-[10px] text-muted-foreground/60 flex items-center justify-between">
                          <span>{new Date(item.startCheckedAt).toLocaleTimeString('zh-CN', {hour: '2-digit', minute:'2-digit'})} 起</span>
                          <span>{new Date(item.endCheckedAt).toLocaleTimeString('zh-CN', {hour: '2-digit', minute:'2-digit'})} 止</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}