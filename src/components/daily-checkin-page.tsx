'use client';

import { AlertCircle, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock, Loader2, Pencil, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatedStatCard } from '@/components/ui/animated-stat-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { withBasePath } from '@/lib/client/base-path';
import { toast } from '@/lib/toast';
import { cn, formatDateTime, formatUsd } from '@/lib/utils';

type CheckinStatus = 'ok' | 'unauthorized' | 'network_error' | 'unsupported' | 'parse_error' | 'not_checked';

type DailyCheckinEnabledVendor = {
  id: number;
  name: string;
  vendorType: string;
  displayName: string;
};

type DailyCheckinSummary = {
  dayKey: string;
  totalAwardedUsd: number;
  vendorCount: number;
  awardedVendorCount: number;
  updatedAt: string | null;
};

type DailyCheckinDetail = {
  dayKey: string;
  vendorId: number;
  vendorName: string;
  vendorType: string;
  awardedUsd: number | null;
  status: CheckinStatus;
  message: string | null;
  endpointId: number | null;
  checkinDate: string | null;
  source: string | null;
  rawResponseText: string | null;
  attempts: number;
  firstSuccessAt: string | null;
  lastAttemptAt: string;
  updatedAt: string;
};

type DailyCheckinHistoryResponse = {
  ok: boolean;
  generatedAt: string;
  month: string;
  day: string;
  today: string;
  todayTotalUsd: number;
  dayTotalUsd: number;
  monthTotalUsd: number;
  enabledVendorCount: number;
  enabledVendors: DailyCheckinEnabledVendor[];
  summary: DailyCheckinSummary[];
  details: DailyCheckinDetail[];
  message?: string;
};

type CheckinAllTaskState = {
  id: string;
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  totalAwardedUsd: number;
  currentVendorName: string | null;
  status: 'running' | 'completed' | 'failed';
  message: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

type CheckinTaskStartResponse = {
  ok: boolean;
  task?: CheckinAllTaskState;
  message?: string;
};

type DailyCheckinPatchResponse = {
  ok: boolean;
  message?: string;
};

const STATUS_LABELS: Record<CheckinStatus, string> = {
  ok: '成功',
  unauthorized: '鉴权失败',
  network_error: '网络异常',
  unsupported: '未支持',
  parse_error: '解析失败',
  not_checked: '未检查',
};

function parseMonthKey(value: string): { year: number; month: number } | null {
  if (!/^\d{4}-\d{2}$/.test(value)) {
    return null;
  }
  const [yearRaw, monthRaw] = value.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  return { year, month };
}

function formatMonthLabel(monthKey: string): string {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) return monthKey;
  return `${parsed.year} 年 ${String(parsed.month).padStart(2, '0')} 月`;
}

function monthShift(monthKey: string, delta: number): string {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) return monthKey;
  const date = new Date(parsed.year, parsed.month - 1 + delta, 1);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function toDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getCalendarCells(monthKey: string): Array<{
  dayKey: string;
  dayLabel: string;
  inMonth: boolean;
}> {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) {
    return [];
  }

  const firstDay = new Date(parsed.year, parsed.month - 1, 1);
  const start = new Date(firstDay);
  start.setDate(firstDay.getDate() - firstDay.getDay());

  const cells: Array<{ dayKey: string; dayLabel: string; inMonth: boolean }> = [];
  for (let index = 0; index < 42; index += 1) {
    const current = new Date(start);
    current.setDate(start.getDate() + index);
    const inMonth = current.getMonth() === (parsed.month - 1);
    cells.push({
      dayKey: toDayKey(current),
      dayLabel: String(current.getDate()),
      inMonth,
    });
  }
  return cells;
}

function detailStatusClass(status: CheckinStatus): string {
  if (status === 'ok') {
    return 'text-emerald-700 bg-emerald-500/10 border-emerald-400/30';
  }
  if (status === 'unauthorized' || status === 'network_error' || status === 'parse_error') {
    return 'text-red-700 bg-red-500/10 border-red-400/30';
  }
  if (status === 'unsupported') {
    return 'text-amber-700 bg-amber-500/10 border-amber-400/30';
  }
  return 'text-muted-foreground bg-muted/60 border-border';
}

function resolveDisplayStatus(detail: DailyCheckinDetail): CheckinStatus {
  if (detail.awardedUsd !== null && detail.awardedUsd > 0) {
    return 'ok';
  }
  return detail.status;
}

function formatRawResponseText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }
  try {
    const parsed = JSON.parse(trimmed);
    const pretty = JSON.stringify(parsed, null, 2);
    if (pretty.length > 8000) {
      return `${pretty.slice(0, 8000)}\n...（内容过长，已截断）`;
    }
    return pretty;
  } catch {
    if (trimmed.length > 8000) {
      return `${trimmed.slice(0, 8000)}\n...（内容过长，已截断）`;
    }
    return trimmed;
  }
}

function resolveStatusTooltip(detail: DailyCheckinDetail, displayStatus: CheckinStatus): {
  message: string | null;
  rawResponseText: string | null;
} | null {
  const message = (detail.message || '').trim();
  const rawResponseText = (detail.rawResponseText || '').trim();
  const canShowMessage = displayStatus === 'parse_error' || displayStatus === 'network_error';
  if ((!canShowMessage || !message) && !rawResponseText) {
    return null;
  }
  return {
    message: canShowMessage ? (message || null) : null,
    rawResponseText: rawResponseText || null,
  };
}

export function DailyCheckinPage({ initialData }: { initialData: DailyCheckinHistoryResponse }) {
  const [data, setData] = useState<DailyCheckinHistoryResponse>(initialData);
  const [loading, setLoading] = useState(false);
  const [checkinTask, setCheckinTask] = useState<CheckinAllTaskState | null>(null);
  const [checkinTaskVisible, setCheckinTaskVisible] = useState(false);
  const [editingRecordKey, setEditingRecordKey] = useState<string | null>(null);
  const [editingAmountDraft, setEditingAmountDraft] = useState('');
  const [savingEditedAmount, setSavingEditedAmount] = useState(false);
  const [detailCardMaxHeight, setDetailCardMaxHeight] = useState<number | null>(null);
  const calendarCardRef = useRef<HTMLDivElement | null>(null);
  const checkinEventSourceRef = useRef<EventSource | null>(null);
  const checkinHideTimerRef = useRef<number | null>(null);

  const clearCheckinStream = useCallback(() => {
    if (checkinEventSourceRef.current) {
      checkinEventSourceRef.current.close();
      checkinEventSourceRef.current = null;
    }
  }, []);

  const clearCheckinHideTimer = useCallback(() => {
    if (checkinHideTimerRef.current !== null) {
      window.clearTimeout(checkinHideTimerRef.current);
      checkinHideTimerRef.current = null;
    }
  }, []);

  const scheduleCheckinHide = useCallback((delayMs = 2600) => {
    clearCheckinHideTimer();
    checkinHideTimerRef.current = window.setTimeout(() => {
      setCheckinTaskVisible(false);
      setCheckinTask(null);
      checkinHideTimerRef.current = null;
    }, delayMs);
  }, [clearCheckinHideTimer]);

  useEffect(() => () => {
    clearCheckinStream();
    clearCheckinHideTimer();
  }, [clearCheckinStream, clearCheckinHideTimer]);

  useEffect(() => {
    const card = calendarCardRef.current;
    if (!card) {
      return;
    }

    const update = () => {
      const height = Math.round(card.getBoundingClientRect().height);
      setDetailCardMaxHeight(height > 0 ? height : null);
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
    observer.observe(card);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  const loadHistory = useCallback(async (month: string, day: string, silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    try {
      const params = new URLSearchParams({ month, day });
      const response = await fetch(withBasePath(`/api/daily-checkin/history?${params.toString()}`), {
        cache: 'no-store',
      });
      const body = (await response.json()) as DailyCheckinHistoryResponse;
      if (!response.ok || !body.ok) {
        throw new Error(body.message || '加载签到历史失败');
      }
      setData(body);
    } catch (error) {
      toast.error('加载签到历史失败', error instanceof Error ? error.message : String(error));
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  const cancelAmountEditing = useCallback(() => {
    if (savingEditedAmount) {
      return;
    }
    setEditingRecordKey(null);
    setEditingAmountDraft('');
  }, [savingEditedAmount]);

  const saveEditedAmount = useCallback(async (detail: DailyCheckinDetail) => {
    const parsed = Number(editingAmountDraft);
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error('金额格式错误', '请输入大于等于 0 的数字');
      return;
    }

    setSavingEditedAmount(true);
    try {
      const response = await fetch(withBasePath('/api/daily-checkin/history'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set-awarded-usd',
          dayKey: detail.dayKey,
          vendorId: detail.vendorId,
          awardedUsd: parsed,
        }),
      });
      const body = (await response.json()) as DailyCheckinPatchResponse;
      if (!response.ok || !body.ok) {
        throw new Error(body.message || '更新金额失败');
      }

      toast.success('金额已更新', `${detail.vendorName} 已设置为 $${formatUsd(parsed)}`);
      setEditingRecordKey(null);
      setEditingAmountDraft('');
      await loadHistory(data.month, data.day, true);
    } catch (error) {
      toast.error('更新金额失败', error instanceof Error ? error.message : String(error));
    } finally {
      setSavingEditedAmount(false);
    }
  }, [data.day, data.month, editingAmountDraft, loadHistory]);

  const startCheckinAll = useCallback(async () => {
    if (checkinTask?.status === 'running') {
      return;
    }

    clearCheckinHideTimer();
    clearCheckinStream();
    setCheckinTaskVisible(true);

    try {
      const response = await fetch(withBasePath('/api/daily-checkin/tasks'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const body = (await response.json()) as CheckinTaskStartResponse;
      if (!response.ok || !body.ok || !body.task) {
        throw new Error(body.message || '启动一键签到失败');
      }

      setCheckinTask(body.task);

      if (body.task.total <= 0) {
        toast.warning('暂无可签到服务商');
        scheduleCheckinHide(1800);
        return;
      }

      const eventSource = new EventSource(
        withBasePath(`/api/daily-checkin/tasks/${encodeURIComponent(body.task.id)}/events`),
      );
      checkinEventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as {
            ok?: boolean;
            message?: string;
            task?: CheckinAllTaskState;
          };
          if (!payload.ok || !payload.task) {
            clearCheckinStream();
            if (payload.message) {
              toast.error('签到任务失败', payload.message);
            }
            scheduleCheckinHide();
            return;
          }
          setCheckinTask(payload.task);

          if (payload.task.status !== 'running') {
            clearCheckinStream();
            const today = data.today || toDayKey(new Date());
            const targetMonth = today.slice(0, 7);
            void loadHistory(targetMonth, today, true);

            if (payload.task.status === 'completed') {
              toast.success(
                '一键签到完成',
                `成功 ${payload.task.succeeded} / ${payload.task.total}，新增 $${formatUsd(payload.task.totalAwardedUsd)}`,
              );
            } else {
              toast.error('一键签到失败', payload.task.message || '任务执行失败');
            }
            scheduleCheckinHide();
          }
        } catch {
          // ignore malformed events
        }
      };

      eventSource.onerror = () => {
        const running = checkinTask?.status === 'running';
        clearCheckinStream();
        if (running) {
          setCheckinTask((current) => (current
            ? {
              ...current,
              status: 'failed',
              message: current.message || '签到任务连接中断',
            }
            : current));
          toast.error('签到任务中断', '事件流连接已断开');
          scheduleCheckinHide();
        }
      };
    } catch (error) {
      setCheckinTaskVisible(false);
      setCheckinTask(null);
      toast.error('启动一键签到失败', error instanceof Error ? error.message : String(error));
    }
  }, [checkinTask?.status, clearCheckinHideTimer, clearCheckinStream, data.today, loadHistory, scheduleCheckinHide]);

  const summaryMap = useMemo(() => {
    const map = new Map<string, DailyCheckinSummary>();
    for (const item of data.summary) {
      map.set(item.dayKey, item);
    }
    return map;
  }, [data.summary]);

  const calendarCells = useMemo(() => getCalendarCells(data.month), [data.month]);
  const calendarRows = useMemo(() => {
    const rows: Array<typeof calendarCells> = [];
    for (let i = 0; i < calendarCells.length; i += 7) {
      rows.push(calendarCells.slice(i, i + 7));
    }
    return rows;
  }, [calendarCells]);

  const taskProgressPercent = useMemo(() => {
    if (!checkinTask) {
      return 0;
    }
    if (checkinTask.total <= 0) {
      return checkinTask.status === 'running' ? 0 : 100;
    }
    return Math.max(0, Math.min(100, (checkinTask.completed / checkinTask.total) * 100));
  }, [checkinTask]);

  const todayKeyLocal = toDayKey(new Date());

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-10 md:px-6">
      <div className="relative flex flex-wrap items-center justify-between gap-6 overflow-hidden rounded-3xl border border-border/50 bg-card/40 p-8 shadow-md backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.02]">
        {/* Decorative background gradients */}
        <div className="absolute -left-20 -top-20 h-64 w-64 rounded-full bg-emerald-500/5 blur-[100px]" />
        <div className="absolute -right-20 -bottom-20 h-64 w-64 rounded-full bg-teal-500/5 blur-[100px]" />

        <div className="relative z-10 space-y-2">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 shadow-sm border border-emerald-500/20">
              <Sparkles className="h-6 w-6" />
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">
              一键签到 <span className="text-emerald-500">中心</span>
            </h1>
          </div>
          <p className="max-w-2xl text-base text-muted-foreground">
            自动管理服务商每日签到任务，实时追踪奖励金额与历史记录。
          </p>
        </div>

        <div className="relative z-10">
          <Button
            onClick={startCheckinAll}
            disabled={checkinTask?.status === 'running' || data.enabledVendorCount <= 0}
            variant="default"
            size="lg"
            className="rounded-2xl h-12 px-8 shadow-lg shadow-emerald-500/20 bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
          >
            {checkinTask?.status === 'running' ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-5 w-5" />
            )}
            一键签到
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <AnimatedStatCard
          title="今日签到金额"
          value={`$${formatUsd(data.todayTotalUsd)}`}
          icon={Sparkles}
          glowClassName="bg-emerald-500/10"
          iconWrapClassName="bg-emerald-500/10 dark:bg-emerald-500/15"
          iconClassName="text-emerald-500"
          valueClassName="text-emerald-600 dark:text-emerald-400"
        />
        <AnimatedStatCard
          title="当月签到总额"
          value={`$${formatUsd(data.monthTotalUsd)}`}
          icon={CheckCircle2}
          glowClassName="bg-blue-500/10"
          iconWrapClassName="bg-blue-500/10 dark:bg-blue-500/15"
          iconClassName="text-blue-500"
          valueClassName="text-blue-600 dark:text-blue-400"
        />
        <AnimatedStatCard
          title="可签到服务商"
          value={data.enabledVendorCount}
          icon={Sparkles}
          glowClassName="bg-amber-500/10"
          iconWrapClassName="bg-amber-500/10 dark:bg-amber-500/15"
          iconClassName="text-amber-500"
          valueClassName="text-amber-600 dark:text-amber-400"
        />
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.5fr_1fr] lg:items-start">
        <div ref={calendarCardRef} className="self-start">
          <Card className="border-border/40 shadow-md backdrop-blur-xl overflow-hidden">
            <CardHeader className="border-b bg-muted/20 px-6 py-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-1 rounded-full bg-emerald-500" />
                  <CardTitle className="text-xl font-bold">签到日历</CardTitle>
                </div>
                <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/50 p-1 shadow-sm">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      const next = monthShift(data.month, -1);
                      void loadHistory(next, `${next}-01`);
                    }}
                    disabled={loading}
                    className="h-8 w-8 rounded-lg"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="min-w-[100px] text-center text-sm font-bold tracking-tight">
                    {formatMonthLabel(data.month)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      const next = monthShift(data.month, 1);
                      void loadHistory(next, `${next}-01`);
                    }}
                    disabled={loading}
                    className="h-8 w-8 rounded-lg"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-7 gap-3 pb-4 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map((weekday) => (
                  <div key={weekday}>{weekday}</div>
                ))}
              </div>
              <div className={cn('space-y-3 transition-opacity duration-300', loading && 'opacity-50')}>
                {calendarRows.map((row, rowIndex) => (
                  <div key={`${data.month}-${rowIndex}`} className="grid grid-cols-7 gap-3">
                    {row.map((cell) => {
                      const summary = summaryMap.get(cell.dayKey) ?? null;
                      const dayTotal = summary?.totalAwardedUsd ?? 0;
                      const hasRecord = Boolean(summary);
                      const isSelected = cell.dayKey === data.day;
                      const isToday = cell.dayKey === todayKeyLocal;
                      return (
                        <button
                          key={cell.dayKey}
                          type="button"
                          onClick={() => {
                            if (cell.inMonth) {
                              void loadHistory(data.month, cell.dayKey);
                            } else {
                              void loadHistory(cell.dayKey.slice(0, 7), cell.dayKey);
                            }
                          }}
                          className={cn(
                            'group relative flex h-24 flex-col justify-between rounded-2xl border p-3 text-left transition-all duration-300',
                            cell.inMonth 
                              ? 'border-border/60 bg-background/50 hover:border-emerald-500/40 hover:bg-emerald-500/5 hover:shadow-md' 
                              : 'border-border/20 bg-muted/10 text-muted-foreground/40',
                            isSelected && 'border-emerald-500/60 bg-emerald-500/5 ring-4 ring-emerald-500/10 shadow-inner',
                          )}
                        >
                          <div className={cn(
                            'text-xs font-bold transition-colors', 
                            isToday ? 'text-emerald-600' : 'text-foreground/60 group-hover:text-foreground'
                          )}>
                            {cell.dayLabel}
                          </div>
                          {hasRecord && (
                            <div className="mt-auto flex w-full animate-in fade-in slide-in-from-bottom-1 duration-500">
                              {dayTotal > 0 ? (
                                <div className="inline-flex items-center justify-center w-full gap-0.5 rounded-md bg-emerald-500/15 px-0.5 py-0.5 text-[10px] font-bold text-emerald-600 shadow-sm border border-emerald-500/10">
                                  <Check className="h-2.5 w-2.5 shrink-0" />
                                  <span className="tracking-tighter">${formatUsd(dayTotal)}</span>
                                </div>
                              ) : (
                                <div className="inline-flex items-center justify-center w-full rounded-md bg-muted px-0.5 py-0.5 text-[10px] font-bold text-muted-foreground border border-border/60 shadow-sm">
                                  已尝试
                                </div>
                              )}
                            </div>
                          )}
                          {isToday && <div className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div
          className="min-h-0 self-start overflow-hidden"
          style={detailCardMaxHeight ? { height: `${detailCardMaxHeight}px`, maxHeight: `${detailCardMaxHeight}px` } : undefined}
        >
          <Card className="border-border/40 shadow-md backdrop-blur-xl overflow-hidden h-full min-h-0 flex flex-col">
            <CardHeader className="shrink-0 border-b bg-muted/20 px-6 py-5">
              <div className="flex items-center gap-2">
                <div className="h-4 w-1 rounded-full bg-blue-500" />
                <CardTitle className="text-xl font-bold">当日明细</CardTitle>
              </div>
              <div className="mt-1 flex items-center gap-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                <span>{data.day}</span>
                <div className="h-3 w-px bg-border/60" />
                <span className="text-foreground">总计: <span className="font-mono text-emerald-600">${formatUsd(data.dayTotalUsd)}</span></span>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 overflow-y-auto flex-1 min-h-0 p-6 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden bg-background/30">
              {data.details.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 p-12 text-center bg-muted/5">
                  <Sparkles className="h-8 w-8 text-muted-foreground/30" />
                  <p className="mt-4 text-sm font-medium text-muted-foreground">当天暂无签到记录</p>
                </div>
              ) : (
                data.details.map((detail) => {
                  const displayStatus = resolveDisplayStatus(detail);
                  const statusTooltip = resolveStatusTooltip(detail, displayStatus);
                  const recordKey = `${detail.dayKey}-${detail.vendorId}`;
                  const isEditingAmount = editingRecordKey === recordKey;
                  const canEditAmount = detail.status !== 'not_checked';
                  return (
                    <div key={recordKey} className="group relative rounded-2xl border border-border/60 bg-background/50 p-4 transition-all duration-300 hover:border-primary/40 hover:bg-background hover:shadow-lg">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="truncate text-sm font-bold text-foreground">{detail.vendorName}</div>
                            <span className="rounded-md border border-border/60 bg-muted/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              {detail.vendorType}
                            </span>
                          </div>
                          <div className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground opacity-70">
                            <div className="flex items-center gap-1.5">
                              <Clock className="h-3 w-3" />
                              <span>最近尝试: {formatDateTime(detail.lastAttemptAt)}</span>
                            </div>
                            {detail.firstSuccessAt && (
                              <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400/80">
                                <CheckCircle2 className="h-3 w-3" />
                                <span>首次成功: {formatDateTime(detail.firstSuccessAt)}</span>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0 space-y-2 text-right">
                          {isEditingAmount ? (
                            <div className="flex items-center justify-end gap-1.5 animate-in fade-in zoom-in-95">
                              <input
                                type="number"
                                min={0}
                                step="0.0001"
                                value={editingAmountDraft}
                                onChange={(event) => setEditingAmountDraft(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault();
                                    void saveEditedAmount(detail);
                                  }
                                  if (event.key === 'Escape') {
                                    event.preventDefault();
                                    cancelAmountEditing();
                                  }
                                }}
                                disabled={savingEditedAmount}
                                className="h-8 w-24 rounded-lg border border-border/60 bg-background px-3 text-xs font-bold font-mono outline-none focus:ring-4 focus:ring-primary/10 transition-all"
                                autoFocus
                              />
                              <div className="flex gap-1">
                                <button
                                  type="button"
                                  onClick={() => void saveEditedAmount(detail)}
                                  disabled={savingEditedAmount}
                                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all shadow-sm"
                                >
                                  {savingEditedAmount ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelAmountEditing}
                                  disabled={savingEditedAmount}
                                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground border border-border/60 hover:bg-muted/80 transition-all shadow-sm"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-2">
                              <div className="font-mono text-base font-extrabold text-foreground tracking-tight">${formatUsd(detail.awardedUsd)}</div>
                              {canEditAmount && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingRecordKey(recordKey);
                                    setEditingAmountDraft(detail.awardedUsd === null ? '' : String(detail.awardedUsd));
                                  }}
                                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-border/60 bg-background/50 text-muted-foreground transition-all hover:bg-muted hover:text-foreground opacity-0 group-hover:opacity-100 shadow-sm"
                                  title="编辑金额"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          )}
                          
                          {statusTooltip ? (
                            <div className="group/tooltip relative inline-flex justify-end">
                              <span
                                tabIndex={0}
                                className={cn(
                                  'inline-flex cursor-help rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider outline-none transition-all hover:shadow-sm',
                                  detailStatusClass(displayStatus),
                                )}
                              >
                                {STATUS_LABELS[displayStatus] || displayStatus}
                              </span>
                              <div
                                role="tooltip"
                                className="pointer-events-none absolute right-0 top-full z-20 mt-2 w-max max-w-[280px] rounded-xl border border-border/40 bg-background/95 p-4 text-left text-xs text-foreground opacity-0 shadow-2xl backdrop-blur-md transition-all duration-200 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100 animate-in fade-in slide-in-from-top-1"
                              >
                                <div className="space-y-3">
                                  {statusTooltip.message && (
                                    <div className="space-y-1.5">
                                      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">错误说明</div>
                                      <div className="font-medium leading-relaxed">{statusTooltip.message}</div>
                                    </div>
                                  )}
                                  {statusTooltip.rawResponseText && (
                                    <div className="space-y-1.5">
                                      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">原始响应 (Raw Body)</div>
                                      <div className="relative overflow-hidden rounded-lg border border-border/60 bg-muted/30">
                                        <pre className="max-h-40 overflow-auto p-3 font-mono text-[10px] leading-relaxed [scrollbar-width:none]">
                                          {formatRawResponseText(statusTooltip.rawResponseText)}
                                        </pre>
                                      </div>
                                    </div>
                                  )}
                                </div>
                                <div className="absolute -top-1 right-4 h-2 w-2 rotate-45 border-l border-t border-border/40 bg-background/95" />
                              </div>
                            </div>
                          ) : (
                            <div
                              className={cn(
                                'inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider',
                                detailStatusClass(displayStatus),
                              )}
                            >
                              {STATUS_LABELS[displayStatus] || displayStatus}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {checkinTaskVisible && checkinTask && (
        <div className="pointer-events-none fixed bottom-6 right-6 z-[120] flex w-full max-w-[380px] flex-col outline-none">
          <div className="pointer-events-auto group relative flex w-full flex-col gap-3 overflow-hidden rounded-[1.25rem] border border-border/40 bg-background/95 p-5 shadow-2xl backdrop-blur-xl transition-all hover:shadow-primary/5 dark:bg-zinc-950/95 animate-in slide-in-from-right-full fade-in duration-500">
            {/* Accent side bar */}
            <div className={cn(
              "absolute left-0 top-0 bottom-0 w-1.5",
              checkinTask.status === 'running' ? "bg-primary" : 
              checkinTask.status === 'completed' ? "bg-emerald-500" : "bg-rose-500"
            )} />

            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
                  checkinTask.status === 'running' ? "bg-primary/10 text-primary" : 
                  checkinTask.status === 'completed' ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500"
                )}>
                  {checkinTask.status === 'running' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : checkinTask.status === 'completed' ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <AlertCircle className="h-4 w-4" />
                  )}
                </div>
                <div className="flex flex-col justify-center">
                  <span className="text-sm font-black tracking-tight text-foreground uppercase italic leading-none pt-0.5">
                    {checkinTask.status === 'running'
                      ? '一键签到进行中'
                      : checkinTask.status === 'completed'
                        ? '一键签到已完成'
                        : '一键签到失败'}
                  </span>
                  <span className="text-[11px] font-bold text-muted-foreground/80 mt-1">
                    进度: {Math.min(checkinTask.completed, checkinTask.total)} / {checkinTask.total}
                  </span>
                </div>
              </div>
              <div className="text-xl font-black font-mono text-foreground/20">
                {Math.round(taskProgressPercent)}%
              </div>
            </div>

            <div className="h-2 w-full overflow-hidden rounded-full bg-muted/50 shadow-inner">
              <div
                className={cn(
                  'h-full transition-all duration-300 ease-out rounded-full',
                  checkinTask.status === 'failed' ? 'bg-rose-500' : 
                  checkinTask.status === 'completed' ? 'bg-emerald-500' : 'bg-primary',
                )}
                style={{ width: `${taskProgressPercent}%` }}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  成功: {checkinTask.succeeded}
                </span>
                <span className={cn(
                  "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold border",
                  checkinTask.failed > 0 
                    ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20" 
                    : "bg-muted/30 text-muted-foreground border-border/40"
                )}>
                  失败: {checkinTask.failed}
                </span>
                <span className="inline-flex items-center rounded-md bg-blue-500/10 px-2 py-0.5 text-[10px] font-bold text-blue-600 dark:text-blue-400 border border-blue-500/20 ml-auto">
                  新增: ${formatUsd(checkinTask.totalAwardedUsd)}
                </span>
              </div>
              <div className="text-[11px] font-medium text-muted-foreground truncate" title={checkinTask.status === 'running' ? (checkinTask.currentVendorName ?? '-') : '-'}>
                {checkinTask.status === 'running' ? `正在签到: ${checkinTask.currentVendorName ?? '...'}` : '所有服务商签到完毕'}
              </div>
            </div>

            {checkinTask.status === 'failed' && checkinTask.message && (
              <div className="mt-1 rounded-lg border border-rose-500/20 bg-rose-500/10 p-2.5 text-xs font-medium text-rose-700 dark:text-rose-400 line-clamp-2">
                {checkinTask.message}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
