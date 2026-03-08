'use client';

import { Clock3, GripVertical, Loader2, Lock, Plus, Save, Settings2, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DEFAULT_SYSTEM_DISPLAY_NAME } from '@/lib/app-identity';
import { withBasePath } from '@/lib/client/base-path';
import { toast } from '@/lib/toast';
import { cn, formatDateTime } from '@/lib/utils';

type SettingsPanel = 'config' | 'endpoint' | 'schedule';
type IntervalUnit = 'minutes' | 'hours' | 'days';
type DropPosition = 'before' | 'after';
type DropTarget = {
  vendorId: number;
  position: DropPosition;
};
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
const MIN_AUTO_REFRESH_INTERVAL_MINUTES = 30;

type SystemSettings = {
  systemDisplayName: string;
  proxyUrl: string | null;
  vendorTypeDocs: Record<string, string>;
  includeDisabled: boolean;
  requestTimeoutMs: number;
  concurrency: number;
  autoRefreshEnabled: boolean;
  autoRefreshIntervalMinutes: number;
  autoRefreshLastRunAt: string | null;
  autoCleanupAfterRefreshEnabled: boolean;
  dailyCheckinScheduleEnabled: boolean;
  dailyCheckinScheduleTimes: string[];
  dailyCheckinLastRunAt: string | null;
  updatedAt: string | null;
};

type SettingsApiResponse = {
  ok: boolean;
  message?: string;
  settings?: SystemSettings;
};

type CleanupApiResponse = {
  ok: boolean;
  message?: string;
  deletedEndpoints?: number;
  deletedVendors?: number;
};

type VendorOption = {
  id: number;
  name: string;
  vendorType: string | null;
  displayOrder: number | null;
  updatedAt: string | null;
};

type VendorsApiResponse = {
  ok: boolean;
  message?: string;
  vendors?: VendorOption[];
};

function parseSettingsPanel(raw: string | null | undefined): SettingsPanel {
  const normalized = (raw || '').trim().toLowerCase();
  if (normalized === 'schedule') {
    return 'schedule';
  }
  if (normalized === 'endpoint') {
    return 'endpoint';
  }
  return 'config';
}

function intervalDisplayFromMinutes(totalMinutesRaw: number): {
  value: string;
  unit: IntervalUnit;
} {
  const totalMinutes = Number.isFinite(totalMinutesRaw) && totalMinutesRaw > 0
    ? Math.trunc(totalMinutesRaw)
    : MIN_AUTO_REFRESH_INTERVAL_MINUTES;
  if (totalMinutes % (24 * 60) === 0) {
    return {
      value: String(totalMinutes / (24 * 60)),
      unit: 'days',
    };
  }
  if (totalMinutes % 60 === 0) {
    return {
      value: String(totalMinutes / 60),
      unit: 'hours',
    };
  }
  return {
    value: String(totalMinutes),
    unit: 'minutes',
  };
}

function intervalMinutesFromDraft(value: string, unit: IntervalUnit): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  const base = Math.trunc(parsed);
  if (base <= 0) {
    return null;
  }
  if (unit === 'days') {
    return base * 24 * 60;
  }
  if (unit === 'hours') {
    return base * 60;
  }
  return base;
}

function normalizeVendorTypeLabel(vendorType: string | null | undefined): string {
  const value = (vendorType || '').trim();
  if (!value) {
    return '未配置类型';
  }
  return value;
}

function applyVendorMoveOrder(
  current: VendorOption[],
  movingId: number,
  targetId: number,
  dropPosition: DropPosition,
): VendorOption[] {
  if (movingId === targetId) {
    return current;
  }

  const sourceIndex = current.findIndex((item) => item.id === movingId);
  const targetIndex = current.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) {
    return current;
  }

  const next = [...current];
  const [movingItem] = next.splice(sourceIndex, 1);
  let insertIndex = targetIndex;
  if (sourceIndex < targetIndex) {
    insertIndex = dropPosition === 'before' ? targetIndex - 1 : targetIndex;
  } else {
    insertIndex = dropPosition === 'before' ? targetIndex : targetIndex + 1;
  }
  if (insertIndex < 0) {
    insertIndex = 0;
  }
  if (insertIndex > next.length) {
    insertIndex = next.length;
  }
  next.splice(insertIndex, 0, movingItem);
  return next;
}

function ToggleSwitch({
  checked,
  onCheckedChange,
  ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        checked
          ? 'border-primary/40 bg-primary/70'
          : 'border-border bg-muted',
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-sm ring-1 ring-black/5 transition-transform duration-200',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

function PanelHeader({
  icon,
  title,
  description,
}: {
  icon: 'settings' | 'schedule';
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-4">
        <div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 sm:flex">
          {icon === 'settings'
            ? <Settings2 className="h-6 w-6 text-primary" />
            : <Clock3 className="h-6 w-6 text-primary" />}
        </div>
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground md:text-2xl">{title}</h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  );
}

export function SystemSettingsPage({
  initialSettings,
}: {
  initialSettings: SystemSettings;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialIntervalDisplay = intervalDisplayFromMinutes(initialSettings.autoRefreshIntervalMinutes);
  const [settings, setSettings] = useState<SystemSettings>(initialSettings);
  const [systemDisplayNameDraft, setSystemDisplayNameDraft] = useState(initialSettings.systemDisplayName);
  const [proxyUrlDraft, setProxyUrlDraft] = useState(initialSettings.proxyUrl ?? '');
  const [includeDisabledDraft, setIncludeDisabledDraft] = useState(initialSettings.includeDisabled);
  const [requestTimeoutMsDraft, setRequestTimeoutMsDraft] = useState(String(initialSettings.requestTimeoutMs));
  const [concurrencyDraft, setConcurrencyDraft] = useState(String(initialSettings.concurrency));
  const [autoRefreshEnabledDraft, setAutoRefreshEnabledDraft] = useState(initialSettings.autoRefreshEnabled);
  const [autoCleanupAfterRefreshEnabledDraft, setAutoCleanupAfterRefreshEnabledDraft] = useState(initialSettings.autoCleanupAfterRefreshEnabled);
  const [autoRefreshIntervalValueDraft, setAutoRefreshIntervalValueDraft] = useState(initialIntervalDisplay.value);
  const [autoRefreshIntervalUnitDraft, setAutoRefreshIntervalUnitDraft] = useState<IntervalUnit>(initialIntervalDisplay.unit);
  const [dailyCheckinEnabledDraft, setDailyCheckinEnabledDraft] = useState(initialSettings.dailyCheckinScheduleEnabled);
  const [dailyCheckinTimesDraft, setDailyCheckinTimesDraft] = useState<string[]>(initialSettings.dailyCheckinScheduleTimes);
  const [dailyCheckinHourDraft, setDailyCheckinHourDraft] = useState('09');
  const [dailyCheckinMinuteDraft, setDailyCheckinMinuteDraft] = useState('00');
  const [activePanel, setActivePanel] = useState<SettingsPanel>(
    () => parseSettingsPanel(searchParams?.get('panel')),
  );
  const [saving, setSaving] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [vendorsForOrder, setVendorsForOrder] = useState<VendorOption[]>([]);
  const [initialVendorOrderIds, setInitialVendorOrderIds] = useState<number[]>([]);
  const [vendorOrderLoading, setVendorOrderLoading] = useState(false);
  const [vendorOrderSaving, setVendorOrderSaving] = useState(false);
  const [draggingVendorId, setDraggingVendorId] = useState<number | null>(null);
  const [dragOverVendorId, setDragOverVendorId] = useState<number | null>(null);
  const [dragOverPosition, setDragOverPosition] = useState<DropPosition | null>(null);
  const draggingVendorIdRef = useRef<number | null>(null);
  const vendorRowRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const dragPreviewRef = useRef<{ vendorId: number | null; position: DropPosition | null }>({
    vendorId: null,
    position: null,
  });

  const setDragPreview = useCallback((vendorId: number | null, position: DropPosition | null) => {
    const current = dragPreviewRef.current;
    if (current.vendorId === vendorId && current.position === position) {
      return;
    }
    dragPreviewRef.current = { vendorId, position };
    setDragOverVendorId(vendorId);
    setDragOverPosition(position);
  }, []);

  const clearDragPreview = useCallback(() => {
    setDragPreview(null, null);
  }, [setDragPreview]);

  const resetDragState = useCallback(() => {
    draggingVendorIdRef.current = null;
    setDraggingVendorId(null);
    clearDragPreview();
  }, [clearDragPreview]);

  const getDraggingVendorIdFromEvent = useCallback((event: ReactDragEvent<HTMLElement>): number | null => {
    const fromRef = draggingVendorIdRef.current;
    if (typeof fromRef === 'number' && Number.isInteger(fromRef) && fromRef > 0) {
      return fromRef;
    }

    const raw = event.dataTransfer.getData('text/plain');
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }, []);

  const inferDropTargetByClientY = useCallback((clientY: number): DropTarget | null => {
    const movingId = draggingVendorIdRef.current;
    if (typeof movingId !== 'number' || !Number.isInteger(movingId) || movingId <= 0) {
      return null;
    }

    const visualRows = vendorsForOrder
      .filter((vendor) => vendor.id !== movingId)
      .map((vendor) => {
        const element = vendorRowRefs.current.get(vendor.id);
        if (!element) {
          return null;
        }
        const rect = element.getBoundingClientRect();
        return {
          vendorId: vendor.id,
          top: rect.top,
          bottom: rect.bottom,
        };
      })
      .filter((value): value is { vendorId: number; top: number; bottom: number } => value !== null)
      .sort((left, right) => left.top - right.top);

    if (visualRows.length === 0) {
      return null;
    }

    const insertionSlots: Array<{ y: number; target: DropTarget }> = [];

    const firstRow = visualRows[0];
    insertionSlots.push({
      y: firstRow.top,
      target: {
        vendorId: firstRow.vendorId,
        position: 'before',
      },
    });

    for (let i = 0; i < visualRows.length - 1; i += 1) {
      const currentRow = visualRows[i];
      const nextRow = visualRows[i + 1];
      insertionSlots.push({
        y: (currentRow.bottom + nextRow.top) / 2,
        target: {
          vendorId: nextRow.vendorId,
          position: 'before',
        },
      });
    }

    const lastRow = visualRows[visualRows.length - 1];
    insertionSlots.push({
      y: lastRow.bottom,
      target: {
        vendorId: lastRow.vendorId,
        position: 'after',
      },
    });

    let nearest = insertionSlots[0];
    let nearestDistance = Math.abs(clientY - nearest.y);
    for (let i = 1; i < insertionSlots.length; i += 1) {
      const candidate = insertionSlots[i];
      const distance = Math.abs(clientY - candidate.y);
      if (distance < nearestDistance) {
        nearest = candidate;
        nearestDistance = distance;
      }
    }

    return nearest.target;
  }, [vendorsForOrder]);

  const updateDragPreviewFromPointer = useCallback((event: ReactDragEvent<HTMLDivElement>): DropTarget | null => {
    const target = inferDropTargetByClientY(event.clientY);
    if (!target) {
      clearDragPreview();
      return null;
    }
    setDragPreview(target.vendorId, target.position);
    return target;
  }, [clearDragPreview, inferDropTargetByClientY, setDragPreview]);

  const handleVendorOrderListDragEnter = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (draggingVendorIdRef.current === null) {
      return;
    }
    event.dataTransfer.dropEffect = 'move';
    updateDragPreviewFromPointer(event);
  }, [updateDragPreviewFromPointer]);

  const handleVendorOrderListDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (draggingVendorIdRef.current === null) {
      return;
    }
    event.dataTransfer.dropEffect = 'move';
    updateDragPreviewFromPointer(event);
  }, [updateDragPreviewFromPointer]);

  const handleVendorOrderListDragLeave = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (draggingVendorIdRef.current === null) {
      return;
    }

    const relatedTarget = event.relatedTarget as Node | null;
    if (relatedTarget && event.currentTarget.contains(relatedTarget)) {
      return;
    }
    if (event.clientX === 0 && event.clientY === 0) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const stillInside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;

    if (!stillInside) {
      clearDragPreview();
    }
  }, [clearDragPreview]);

  const handleVendorOrderListDrop = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const movingId = getDraggingVendorIdFromEvent(event);
    if (movingId === null) {
      resetDragState();
      return;
    }

    const previewVendorId = dragPreviewRef.current.vendorId;
    const previewPosition = dragPreviewRef.current.position;
    const preview: DropTarget | null = previewVendorId !== null && previewPosition !== null
      ? { vendorId: previewVendorId, position: previewPosition }
      : null;
    const target = preview ?? updateDragPreviewFromPointer(event);
    if (target) {
      moveVendor(movingId, target.vendorId, target.position);
    }
    resetDragState();
  }, [getDraggingVendorIdFromEvent, moveVendor, resetDragState, updateDragPreviewFromPointer]);

  const setVendorRowRef = useCallback((vendorId: number, node: HTMLDivElement | null) => {
    if (node) {
      vendorRowRefs.current.set(vendorId, node);
      return;
    }
    vendorRowRefs.current.delete(vendorId);
  }, []);

  const vendorOrderIds = useMemo(() => vendorsForOrder.map((vendor) => vendor.id), [vendorsForOrder]);
  const vendorOrderDirty = useMemo(() => {
    if (vendorOrderIds.length !== initialVendorOrderIds.length) {
      return true;
    }
    for (let i = 0; i < vendorOrderIds.length; i += 1) {
      if (vendorOrderIds[i] !== initialVendorOrderIds[i]) {
        return true;
      }
    }
    return false;
  }, [initialVendorOrderIds, vendorOrderIds]);

  const previewVendorsForOrder = useMemo(() => {
    if (draggingVendorId === null || dragOverVendorId === null || dragOverPosition === null) {
      return vendorsForOrder;
    }
    return applyVendorMoveOrder(vendorsForOrder, draggingVendorId, dragOverVendorId, dragOverPosition);
  }, [dragOverPosition, dragOverVendorId, draggingVendorId, vendorsForOrder]);

  const loadVendorsForOrder = async () => {
    setVendorOrderLoading(true);
    try {
      const response = await fetch(withBasePath('/api/vendors'), { cache: 'no-store' });
      const body = (await response.json().catch(() => ({}))) as VendorsApiResponse;
      if (!response.ok || !body.ok || !Array.isArray(body.vendors)) {
        throw new Error(body.message || '读取服务商列表失败');
      }
      setVendorsForOrder(body.vendors);
      setInitialVendorOrderIds(body.vendors.map((vendor) => vendor.id));
      resetDragState();
    } catch (error) {
      toast.error('读取服务商列表失败', error instanceof Error ? error.message : String(error));
    } finally {
      setVendorOrderLoading(false);
    }
  };

  function moveVendor(movingId: number, targetId: number, dropPosition: DropPosition) {
    setVendorsForOrder((current) => applyVendorMoveOrder(current, movingId, targetId, dropPosition));
  }

  function moveVendorToEnd(movingId: number) {
    setVendorsForOrder((current) => {
      const sourceIndex = current.findIndex((item) => item.id === movingId);
      if (sourceIndex < 0 || sourceIndex === current.length - 1) {
        return current;
      }
      const next = [...current];
      const [movingItem] = next.splice(sourceIndex, 1);
      next.push(movingItem);
      return next;
    });
  }

  const resetVendorOrderDraft = () => {
    resetDragState();
    setVendorsForOrder((current) => {
      const map = new Map(current.map((item) => [item.id, item]));
      const reordered: VendorOption[] = [];
      for (const id of initialVendorOrderIds) {
        const item = map.get(id);
        if (item) {
          reordered.push(item);
          map.delete(id);
        }
      }
      for (const item of map.values()) {
        reordered.push(item);
      }
      return reordered;
    });
  };

  useEffect(() => {
    const nextPanel = parseSettingsPanel(searchParams?.get('panel'));
    setActivePanel((current) => (current === nextPanel ? current : nextPanel));
  }, [searchParams]);

  useEffect(() => {
    if (activePanel !== 'endpoint') {
      return;
    }
    if (vendorOrderLoading || vendorsForOrder.length > 0) {
      return;
    }
    void loadVendorsForOrder();
  }, [activePanel, vendorOrderLoading, vendorsForOrder.length]);

  const switchPanel = (nextPanel: SettingsPanel) => {
    setActivePanel(nextPanel);

    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (nextPanel === 'config') {
      params.delete('panel');
    } else {
      params.set('panel', nextPanel);
    }

    const query = params.toString();
    const href = query ? `${pathname}?${query}` : pathname;
    router.replace(href, { scroll: false });
  };

  const addDailyCheckinTime = () => {
    const normalized = `${dailyCheckinHourDraft}:${dailyCheckinMinuteDraft}`;
    setDailyCheckinTimesDraft((current) => {
      if (current.includes(normalized)) {
        return current;
      }
      return [...current, normalized].sort((left, right) => left.localeCompare(right));
    });
  };

  const removeDailyCheckinTime = (target: string) => {
    setDailyCheckinTimesDraft((current) => current.filter((time) => time !== target));
  };

  const save = async () => {
    setSaving(true);
    let shouldPersistVendorOrder = false;

    const intervalMinutes = intervalMinutesFromDraft(autoRefreshIntervalValueDraft, autoRefreshIntervalUnitDraft);
    if (intervalMinutes === null) {
      setSaving(false);
      toast.error('保存失败', '刷新间隔必须是正整数');
      return;
    }
    if (intervalMinutes < MIN_AUTO_REFRESH_INTERVAL_MINUTES) {
      setSaving(false);
      toast.warning('刷新间隔过短', '最小间隔为 30 分钟');
      return;
    }

    try {
      shouldPersistVendorOrder = vendorOrderDirty;
      const orderedVendorIdsSnapshot = [...vendorOrderIds];
      if (shouldPersistVendorOrder) {
        setVendorOrderSaving(true);
      }

      const response = await fetch(withBasePath('/api/system-settings'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          systemDisplayName: systemDisplayNameDraft.trim() || null,
          proxyUrl: proxyUrlDraft.trim() || null,
          includeDisabled: includeDisabledDraft,
          requestTimeoutMs: Number(requestTimeoutMsDraft),
          concurrency: Number(concurrencyDraft),
          autoRefreshEnabled: autoRefreshEnabledDraft,
          autoRefreshIntervalMinutes: intervalMinutes,
          autoCleanupAfterRefreshEnabled: autoCleanupAfterRefreshEnabledDraft,
          dailyCheckinScheduleEnabled: dailyCheckinEnabledDraft,
          dailyCheckinScheduleTimes: dailyCheckinTimesDraft,
        }),
      });

      const body = (await response.json()) as SettingsApiResponse;
      if (!response.ok || !body.ok || !body.settings) {
        throw new Error(body.message || '保存系统设置失败');
      }

      setSettings(body.settings);
      setSystemDisplayNameDraft(body.settings.systemDisplayName);
      setProxyUrlDraft(body.settings.proxyUrl ?? '');
      setIncludeDisabledDraft(body.settings.includeDisabled);
      setRequestTimeoutMsDraft(String(body.settings.requestTimeoutMs));
      setConcurrencyDraft(String(body.settings.concurrency));
      setAutoRefreshEnabledDraft(body.settings.autoRefreshEnabled);
      setAutoCleanupAfterRefreshEnabledDraft(body.settings.autoCleanupAfterRefreshEnabled);
      {
        const nextIntervalDisplay = intervalDisplayFromMinutes(body.settings.autoRefreshIntervalMinutes);
        setAutoRefreshIntervalValueDraft(nextIntervalDisplay.value);
        setAutoRefreshIntervalUnitDraft(nextIntervalDisplay.unit);
      }
      setDailyCheckinEnabledDraft(body.settings.dailyCheckinScheduleEnabled);
      setDailyCheckinTimesDraft(body.settings.dailyCheckinScheduleTimes);
      if (typeof document !== 'undefined') {
        document.title = body.settings.systemDisplayName;
      }

      let vendorOrderSaveError: string | null = null;
      if (shouldPersistVendorOrder) {
        try {
          const orderResponse = await fetch(withBasePath('/api/vendors/order'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              orderedVendorIds: orderedVendorIdsSnapshot,
            }),
          });
          const orderBody = (await orderResponse.json().catch(() => ({}))) as VendorsApiResponse;
          if (!orderResponse.ok || !orderBody.ok || !Array.isArray(orderBody.vendors)) {
            throw new Error(orderBody.message || '保存服务商顺序失败');
          }
          setVendorsForOrder(orderBody.vendors);
          setInitialVendorOrderIds(orderBody.vendors.map((vendor) => vendor.id));
          resetDragState();
        } catch (error) {
          vendorOrderSaveError = error instanceof Error ? error.message : String(error);
        }
      }

      if (vendorOrderSaveError) {
        toast.warning('配置已保存，服务商顺序保存失败', vendorOrderSaveError);
      } else {
        toast.success(
          '保存成功',
          shouldPersistVendorOrder ? '设置与服务商顺序已即时生效。' : '设置已即时生效。',
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      if (shouldPersistVendorOrder) {
        setVendorOrderSaving(false);
      }
      setSaving(false);
    }
  };

  const cleanupStaleData = async () => {
    setCleaning(true);
    try {
      const response = await fetch(withBasePath('/api/system-settings/cleanup'), {
        method: 'POST',
      });

      const body = (await response.json()) as CleanupApiResponse;
      if (!response.ok || !body.ok) {
        throw new Error(body.message || '清理失败');
      }

      const deletedEndpoints = Number(body.deletedEndpoints ?? 0);
      const deletedVendors = Number(body.deletedVendors ?? 0);

      if (deletedEndpoints === 0 && deletedVendors === 0) {
        toast.info('没有需要清理的过期数据');
        return;
      }

      toast.success(
        '清理完成',
        `已删除 ${deletedEndpoints} 条端点设置，清理 ${deletedVendors} 个无引用服务商`,
      );
    } catch (err) {
      toast.error('清理失败', err instanceof Error ? err.message : String(err));
    } finally {
      setCleaning(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-10 md:px-6">
      <div className="relative flex flex-wrap items-center justify-between gap-6 overflow-hidden rounded-3xl border border-border/50 bg-card/40 p-8 shadow-md backdrop-blur-xl dark:border-white/10 dark:bg-background/[0.02]">
        {/* Decorative background gradients */}
        <div className="absolute -left-20 -top-20 h-64 w-64 rounded-full bg-rose-500/5 blur-[100px]" />
        <div className="absolute -right-20 -bottom-20 h-64 w-64 rounded-full bg-red-500/5 blur-[100px]" />

        <div className="relative z-10 space-y-2">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/10 text-rose-600 shadow-sm border border-rose-500/20">
              <Settings2 className="h-6 w-6" />
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">
              系统 <span className="text-rose-500">配置</span>
            </h1>
          </div>
          <p className="max-w-2xl text-base text-muted-foreground">
            配置全局代理、自动化刷新以及任务调度。所有变更将立即同步至后端引擎。
          </p>
        </div>

        <div className="relative z-10 flex flex-col items-end gap-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/50 px-3 py-1.5 shadow-sm">
            <Clock3 className="h-3.5 w-3.5" />
            最近同步: {formatDateTime(settings.updatedAt)}
          </div>
        </div>
      </div>

      <div className="md:grid md:grid-cols-[280px_minmax(0,1fr)] md:gap-10">
        <aside className="space-y-4 md:sticky md:top-24 md:h-fit">
          <nav className="flex flex-col gap-2 rounded-2xl border border-border/40 bg-muted/20 p-2 backdrop-blur-sm shadow-sm">
            <button
              type="button"
              onClick={() => switchPanel('config')}
              className={cn(
                'relative flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold tracking-tight transition-all duration-300',
                activePanel === 'config'
                  ? 'bg-background text-foreground shadow-md ring-1 ring-border/60'
                  : 'text-muted-foreground hover:bg-background/5 hover:text-foreground',
              )}
            >
              <div className={cn(
                "flex h-8 w-8 items-center justify-center rounded-lg shadow-sm transition-colors",
                activePanel === 'config' ? "bg-rose-500 text-white" : "bg-muted text-muted-foreground"
              )}>
                <Settings2 className="h-4 w-4" />
              </div>
              <span className="flex-1 text-left">基础配置</span>
              {activePanel === 'config' && <div className="h-1.5 w-1.5 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]" />}
            </button>
            <button
              type="button"
              onClick={() => switchPanel('endpoint')}
              className={cn(
                'relative flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold tracking-tight transition-all duration-300',
                activePanel === 'endpoint'
                  ? 'bg-background text-foreground shadow-md ring-1 ring-border/60'
                  : 'text-muted-foreground hover:bg-background/5 hover:text-foreground',
              )}
            >
              <div className={cn(
                "flex h-8 w-8 items-center justify-center rounded-lg shadow-sm transition-colors",
                activePanel === 'endpoint' ? "bg-amber-500 text-white" : "bg-muted text-muted-foreground"
              )}>
                <Settings2 className="h-4 w-4" />
              </div>
              <span className="flex-1 text-left">端点配置</span>
              {activePanel === 'endpoint' && <div className="h-1.5 w-1.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]" />}
            </button>
            <button
              type="button"
              onClick={() => switchPanel('schedule')}
              className={cn(
                'relative flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold tracking-tight transition-all duration-300',
                activePanel === 'schedule'
                  ? 'bg-background text-foreground shadow-md ring-1 ring-border/60'
                  : 'text-muted-foreground hover:bg-background/5 hover:text-foreground',
              )}
            >
              <div className={cn(
                "flex h-8 w-8 items-center justify-center rounded-lg shadow-sm transition-colors",
                activePanel === 'schedule' ? "bg-blue-500 text-white" : "bg-muted text-muted-foreground"
              )}>
                <Clock3 className="h-4 w-4" />
              </div>
              <span className="flex-1 text-left">任务调度</span>
              {activePanel === 'schedule' && <div className="h-1.5 w-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]" />}
            </button>
          </nav>
          
          <div className="rounded-2xl border border-border/40 bg-muted/10 p-5 space-y-3">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">状态概览</h4>
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">自动刷新</span>
                <span className={cn("h-2 w-2 rounded-full", settings.autoRefreshEnabled ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" : "bg-muted-foreground/30")} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">定时签到</span>
                <span className={cn("h-2 w-2 rounded-full", settings.dailyCheckinScheduleEnabled ? "bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.4)]" : "bg-muted-foreground/30")} />
              </div>
            </div>
          </div>
        </aside>

        <div className="space-y-8">
          <Card className="overflow-hidden border-border/40 shadow-xl backdrop-blur-xl">
            <div className="border-b bg-muted/30 p-6 md:p-8">
              {activePanel === 'config' ? (
                <PanelHeader
                  icon="settings"
                  title="基础配置"
                  description="管理系统的核心基础参数，影响网络连通性、API 行为以及站点外观。"
                />
              ) : activePanel === 'endpoint' ? (
                <PanelHeader
                  icon="settings"
                  title="端点配置"
                  description="管理端点展示策略、页面刷新自动维护与手动系统清理。"
                />
              ) : (
                <PanelHeader
                  icon="schedule"
                  title="任务调度"
                  description="集中管理自动刷新与定时任务，按预设规则由后端引擎精准触发。"
                />
              )}
            </div>

            <CardContent className="p-6 md:p-8 space-y-8 bg-background/30">
              {activePanel === 'config' && (
                <div className="grid gap-6">
                  <div className="flex flex-col gap-4 rounded-2xl border border-border/40 bg-muted/10 p-5 shadow-sm">
                    <div className="grid md:grid-cols-[1fr,320px] gap-6 items-start">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <div className="h-4 w-1 rounded-full bg-rose-500" />
                          <label htmlFor="system-display-name" className="text-sm font-bold text-foreground tracking-tight">
                            站点视觉标识
                          </label>
                        </div>
                        <p className="text-[11px] font-medium text-muted-foreground leading-relaxed pl-3 border-l border-border/60 ml-0.5 max-w-none">
                          控制浏览器标签页标题以及全局页眉显示的系统名称。
                        </p>
                      </div>
                      <div className="relative group w-full">
                        <input
                          id="system-display-name"
                          type="text"
                          placeholder={DEFAULT_SYSTEM_DISPLAY_NAME}
                          value={systemDisplayNameDraft}
                          onChange={(event) => setSystemDisplayNameDraft(event.target.value)}
                          className="h-10 w-full rounded-xl border border-border/60 bg-background px-4 text-sm font-bold outline-none transition-all focus:border-rose-500/40 focus:ring-4 focus:ring-rose-500/10 shadow-sm"
                        />
                        <div className="absolute right-3 top-2 flex items-center gap-1.5 rounded-md bg-muted/80 px-2 py-0.5 text-[10px] font-bold text-muted-foreground border border-border/40 opacity-0 group-focus-within:opacity-100 transition-opacity">
                          LIVE: {settings.systemDisplayName}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-4 rounded-2xl border border-border/40 bg-muted/10 p-5 shadow-sm">
                    <div className="grid md:grid-cols-[1fr,320px] gap-6 items-start">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <div className="h-4 w-1 rounded-full bg-blue-500" />
                          <label htmlFor="proxy-url" className="text-sm font-bold text-foreground tracking-tight">
                            全局代理地址
                          </label>
                        </div>
                        <p className="text-[11px] font-medium text-muted-foreground leading-relaxed pl-3 border-l border-border/60 ml-0.5 max-w-none">
                          支持 <code className="text-blue-600 font-bold bg-blue-500/10 px-1 rounded">http://</code>，<code className="text-blue-600 font-bold bg-blue-500/10 px-1 rounded">https://</code>，<code className="text-blue-600 font-bold bg-blue-500/10 px-1 rounded">socks5://</code> 等主流协议，留空则直连。
                        </p>
                      </div>
                      <input
                        id="proxy-url"
                        type="text"
                        placeholder="例如 http://127.0.0.1:7890"
                        value={proxyUrlDraft}
                        onChange={(event) => setProxyUrlDraft(event.target.value)}
                        className="h-10 w-full rounded-xl border border-border/60 bg-background px-4 text-sm font-bold font-mono outline-none transition-all focus:border-blue-500/40 focus:ring-4 focus:ring-blue-500/10 shadow-sm"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-4 rounded-2xl border border-border/40 bg-muted/10 p-5 shadow-sm">

                    <div className="grid md:grid-cols-[1fr,320px] gap-6 items-start">

                      <div className="space-y-1.5">

                        <div className="flex items-center gap-2">

                          <div className="h-4 w-1 rounded-full bg-amber-500" />

                          <label htmlFor="request-timeout-ms" className="text-sm font-bold text-foreground tracking-tight">

                            请求超时界限

                          </label>

                        </div>

                        <p className="text-[11px] font-medium text-muted-foreground leading-relaxed pl-3 border-l border-border/60 ml-0.5 max-w-none">

                          发送查询请求时的最高容忍时间。范围 1,000–120,000 毫秒，默认 15,000。

                        </p>

                      </div>

                      <input

                        id="request-timeout-ms"

                        type="number"

                        min={1000}

                        max={120000}

                        step={1000}

                        value={requestTimeoutMsDraft}

                        onChange={(event) => setRequestTimeoutMsDraft(event.target.value)}

                        className="h-10 w-full rounded-xl border border-border/60 bg-background px-4 text-sm font-bold font-mono outline-none transition-all focus:border-amber-500/40 focus:ring-4 focus:ring-amber-500/10 shadow-sm"

                      />

                    </div>

                  </div>

                  

                  <div className="flex flex-col gap-4 rounded-2xl border border-border/40 bg-muted/10 p-5 shadow-sm">

                    <div className="grid md:grid-cols-[1fr,320px] gap-6 items-start">

                      <div className="space-y-1.5">

                        <div className="flex items-center gap-2">

                          <div className="h-4 w-1 rounded-full bg-violet-500" />

                          <label htmlFor="concurrency" className="text-sm font-bold text-foreground tracking-tight">

                            全量刷新并发数

                          </label>

                        </div>

                        <p className="text-[11px] font-medium text-muted-foreground leading-relaxed pl-3 border-l border-border/60 ml-0.5 max-w-none">

                          同时发出的探测请求数。范围 1–30，默认 6。网络好可调大加速。

                        </p>

                      </div>

                      <input

                        id="concurrency"

                        type="number"

                        min={1}

                        max={30}

                        step={1}

                        value={concurrencyDraft}

                        onChange={(event) => setConcurrencyDraft(event.target.value)}

                        className="h-10 w-full rounded-xl border border-border/60 bg-background px-4 text-sm font-bold font-mono outline-none transition-all focus:border-violet-500/40 focus:ring-4 focus:ring-violet-500/10 shadow-sm"

                      />

                    </div>

                  </div>

                  

                </div>
              )}

              {activePanel === 'endpoint' && (
                <div className="grid gap-6">
                  <div className="flex flex-col gap-4 rounded-2xl border border-border/40 bg-muted/10 p-5 shadow-sm">
                    <div className="flex items-center justify-between gap-6">
                      <div className="space-y-1.5 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="h-4 w-1 rounded-full bg-emerald-500" />
                          <span className="text-sm font-bold text-foreground tracking-tight">
                            显示已禁用端点
                          </span>
                        </div>
                        <p className="text-[11px] font-medium text-muted-foreground leading-relaxed pl-3 border-l border-border/60 ml-0.5 max-w-none">
                          开启后，CCH 中已标记为禁用的端点也会显示在控制台列表中，便于统一排查。
                        </p>
                      </div>
                      <ToggleSwitch
                        checked={includeDisabledDraft}
                        onCheckedChange={setIncludeDisabledDraft}
                        ariaLabel="显示已禁用端点"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-4 rounded-2xl border border-border/40 bg-muted/10 p-5 shadow-sm">
                    <div className="flex items-center justify-between gap-6">
                      <div className="space-y-1.5 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="h-4 w-1 rounded-full bg-amber-500" />
                          <span className="text-sm font-bold text-foreground tracking-tight">
                            自动清理失效端点/服务商
                          </span>
                        </div>
                        <p className="text-[11px] font-medium text-muted-foreground leading-relaxed pl-3 border-l border-border/60 ml-0.5 max-w-none">
                          开启后，每次刷新前端页面会自动清理 CCH 无对应的端点与孤立服务商，也可在右侧手动清理。
                        </p>
                      </div>
                                              <div className="flex shrink-0 items-center gap-4">
                                                <Button
                                                  type="button"
                                                  variant="outline"
                                                  onClick={cleanupStaleData}
                                                  disabled={cleaning}
                                                  className="h-9 rounded-lg border-rose-300/70 px-4 font-bold text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-500/10"
                                                >
                                                  {cleaning ? (
                                                    <>
                                                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                      清理中
                                                    </>
                                                  ) : (
                                                    <>
                                                      <Trash2 className="mr-2 h-4 w-4" />
                                                      手动清理
                                                    </>
                                                  )}
                                                </Button>
                                                <ToggleSwitch
                                                  checked={autoCleanupAfterRefreshEnabledDraft}
                                                  onCheckedChange={setAutoCleanupAfterRefreshEnabledDraft}
                                                  ariaLabel="页面刷新后自动执行数据维护"
                                                />
                                              </div>                    </div>
                  </div>

                  <div className="flex flex-col gap-4 rounded-2xl border border-border/40 bg-muted/10 p-5 shadow-sm">
                    <div className="flex items-center justify-between gap-4">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <div className="h-4 w-1 rounded-full bg-blue-500" />
                          <span className="text-sm font-bold text-foreground tracking-tight">
                            服务商显示顺序
                          </span>
                        </div>
                        <p className="text-[11px] font-medium text-muted-foreground leading-relaxed pl-3 border-l border-border/60 ml-0.5 max-w-none">
                          未分组固定在最前，拖拽后点击页面底部“保存配置”生效；未设置顺序的新服务商会自动排在最后。
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void loadVendorsForOrder()}
                          disabled={vendorOrderLoading || vendorOrderSaving}
                          className="h-9 rounded-lg px-3"
                        >
                          {vendorOrderLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : '刷新'}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={resetVendorOrderDraft}
                          disabled={!vendorOrderDirty || vendorOrderSaving}
                          className="h-9 rounded-lg px-3"
                        >
                          撤销
                        </Button>
                      </div>
                    </div>

                                        <div className="overflow-hidden rounded-xl border border-border/40 bg-muted/5 shadow-inner">
                                          {vendorOrderLoading ? (
                                            <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                                              <Loader2 className="h-4 w-4 animate-spin" />
                                              加载服务商列表...
                                            </div>
                                          ) : (
                                            <div
                                              className="flex flex-col gap-1.5 p-2"
                                              onDragEnter={handleVendorOrderListDragEnter}
                                              onDragOver={handleVendorOrderListDragOver}
                                              onDragLeave={handleVendorOrderListDragLeave}
                                              onDrop={handleVendorOrderListDrop}
                                            >
                                              {/* Fixed 'Unsorted' row that looks like other items */}
                                              <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border/80 bg-muted/20 px-3 py-2.5 shadow-sm opacity-80">
                                                <div className="flex min-w-0 items-center gap-3">
                                                  <div className="flex items-center gap-1.5">
                                                    <Lock className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                                                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted/50 text-[10px] font-bold text-muted-foreground/70">
                                                      -
                                                    </span>
                                                  </div>
                                                  <span className="truncate text-sm font-bold text-muted-foreground">未分组（固定置顶）</span>
                                                </div>
                                                <div className="flex shrink-0 items-center gap-2">
                                                  <span className="rounded-md border border-border/40 bg-background/50 px-2 py-0.5 text-[10px] font-bold text-muted-foreground/60">
                                                    不可拖拽
                                                  </span>
                                                </div>
                                              </div>

                                              {vendorsForOrder.length === 0 ? (
                                                <div className="rounded-lg border border-dashed border-border/40 bg-background/20 px-3 py-8 text-center text-sm italic text-muted-foreground">
                                                  暂无可排序的服务商
                                                </div>
                                              ) : (
                                                <>
                                                  {previewVendorsForOrder.map((vendor, index) => {
                                                    const isDraggingSelf = draggingVendorId === vendor.id;
                                                    const isDragTarget = dragOverVendorId === vendor.id && !isDraggingSelf;
                                                    const hasBeforeGap = isDragTarget && dragOverPosition === 'before';
                                                    const hasAfterGap = isDragTarget && dragOverPosition === 'after';

                                                    return (
                                                      <div
                                                        key={vendor.id}
                                                        ref={(node) => {
                                                          setVendorRowRef(vendor.id, node);
                                                        }}
                                                        draggable={!vendorOrderSaving}
                                                        onDragStart={(event) => {
                                                          draggingVendorIdRef.current = vendor.id;
                                                          setDraggingVendorId(vendor.id);
                                                          clearDragPreview();
                                                          event.dataTransfer.effectAllowed = 'move';
                                                          event.dataTransfer.setData('text/plain', String(vendor.id));
                                                        }}
                                                        onDragEnd={resetDragState}
                                                        className={cn(
                                                          'group relative flex cursor-grab items-center justify-between gap-3 rounded-lg border px-3 py-2.5 shadow-sm transition-all duration-200 active:cursor-grabbing',
                                                          hasBeforeGap && 'mt-3',
                                                          hasAfterGap && 'mb-3',
                                                          isDraggingSelf
                                                            ? 'border-dashed border-primary/50 bg-primary/5 opacity-40 scale-[0.98] z-0'
                                                            : isDragTarget
                                                            ? 'border-border/40 bg-muted/40 z-10 scale-[1.01]'
                                                            : 'border-border/40 bg-background hover:border-border/80 hover:bg-muted/30 hover:shadow-md z-0',
                                                        )}
                                                      >
                                                        {dragOverVendorId === vendor.id && dragOverPosition === 'before' && (
                                                          <div className="absolute -top-[4px] left-0 right-0 z-50 h-[3px] rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.8)] pointer-events-none" />
                                                        )}
                                                        {dragOverVendorId === vendor.id && dragOverPosition === 'after' && (
                                                          <div className="absolute -bottom-[4px] left-0 right-0 z-50 h-[3px] rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.8)] pointer-events-none" />
                                                        )}
                                                        <div className="relative z-0 flex min-w-0 items-center gap-3 pointer-events-none">
                                                          <div className="flex items-center gap-1.5">
                                                            <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground/70" />
                                                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-bold text-muted-foreground">
                                                              {index + 1}
                                                            </span>
                                                          </div>
                                                          <span className="truncate text-sm font-semibold text-foreground">{vendor.name}</span>
                                                        </div>
                                                        <div className="relative z-0 flex shrink-0 items-center gap-2 pointer-events-none">
                                                          {vendor.displayOrder === null ? (
                                                            <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600">
                                                              未排序
                                                            </span>
                                                          ) : null}
                                                          <span className="rounded-md border border-border/60 bg-muted/50 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                                                            {normalizeVendorTypeLabel(vendor.vendorType)}
                                                          </span>
                                                        </div>
                                                      </div>
                                                    );
                                                  })}
                                                  <div
                                                    onDragEnter={(event) => {
                                                      event.preventDefault();
                                                      event.stopPropagation();
                                                      clearDragPreview();
                                                    }}
                                                    onDragOver={(event) => {
                                                      event.preventDefault();
                                                      event.stopPropagation();
                                                      event.dataTransfer.dropEffect = 'move';
                                                      clearDragPreview();
                                                    }}
                                                    onDrop={(event) => {
                                                      event.preventDefault();
                                                      event.stopPropagation();
                                                      const movingId = getDraggingVendorIdFromEvent(event);
                                                      if (movingId !== null) {
                                                        moveVendorToEnd(movingId);
                                                      }
                                                      resetDragState();
                                                    }}
                                                    className={cn(
                                                      'flex items-center justify-center rounded-lg border border-dashed px-3 py-2 text-[11px] font-medium text-muted-foreground transition-colors',
                                                      draggingVendorId !== null ? 'border-primary/40 bg-primary/5 text-primary' : 'border-border/60 bg-background/30',
                                                    )}
                                                  >
                                                    拖到此处可放到末尾
                                                  </div>
                                                </>
                                              )}
                                            </div>
                                          )}
                                                                          </div>
                  </div>
                </div>
              )}

              {activePanel === 'schedule' && (
                <div className="grid gap-10">
                  <div className="space-y-6">
                    <div className="flex items-center justify-between bg-muted/10 p-4 rounded-2xl border border-border/40">
                      <div className="flex items-center gap-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 shadow-sm">
                          <Plus className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-foreground">定时自动刷新</h3>
                          <p className="text-xs font-medium text-muted-foreground">全量检测端点状态，后台强制最小间隔 30 分钟。</p>
                        </div>
                      </div>
                      <ToggleSwitch
                        checked={autoRefreshEnabledDraft}
                        onCheckedChange={setAutoRefreshEnabledDraft}
                        ariaLabel="启用定时自动刷新"
                      />
                    </div>
                    
                    <div className="grid gap-4 md:grid-cols-[200px,1fr] items-start px-2">
                      <span className="text-sm font-bold text-foreground/70 tracking-tight pt-1">自动执行周期</span>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-muted-foreground">已设定的检测间隔</span>
                          <div className="flex items-center gap-2 rounded-lg bg-emerald-500/5 px-3 py-1.5 text-[10px] font-bold text-emerald-600 border border-emerald-500/10">
                            <Clock3 className="h-3 w-3" />
                            最近执行: {formatDateTime(settings.autoRefreshLastRunAt)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 bg-muted/20 p-1 rounded-xl border border-border/40 w-fit">
                          <input
                            id="auto-refresh-interval-value"
                            type="number"
                            min={1}
                            value={autoRefreshIntervalValueDraft}
                            onChange={(event) => setAutoRefreshIntervalValueDraft(event.target.value)}
                            className="h-9 w-20 rounded-lg border border-border/60 bg-background px-3 text-sm font-bold outline-none focus:border-primary"
                          />
                          <Select
                            value={autoRefreshIntervalUnitDraft}
                            onValueChange={(value) => setAutoRefreshIntervalUnitDraft(value as IntervalUnit)}
                          >
                            <SelectTrigger className="h-9 w-28 rounded-lg border-none bg-transparent shadow-none focus:ring-0">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl shadow-xl">
                              <SelectItem value="minutes" className="rounded-lg">分钟</SelectItem>
                              <SelectItem value="hours" className="rounded-lg">小时</SelectItem>
                              <SelectItem value="days" className="rounded-lg">天 (Days)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>

                  </div>

                  <div className="h-px bg-border/40" />

                  <div className="space-y-6">
                    <div className="flex items-center justify-between bg-muted/10 p-4 rounded-2xl border border-border/40">
                      <div className="flex items-center gap-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 shadow-sm">
                          <Clock3 className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-foreground">定时每日签到</h3>
                          <p className="text-xs font-medium text-muted-foreground">在指定的时间点自动触发全量服务商的一键签到功能。</p>
                        </div>
                      </div>
                      <ToggleSwitch
                        checked={dailyCheckinEnabledDraft}
                        onCheckedChange={setDailyCheckinEnabledDraft}
                        ariaLabel="启用定时每日签到"
                      />
                    </div>
                    <div className="grid gap-4 md:grid-cols-[200px,1fr] items-start px-2">
                      <span className="text-sm font-bold text-foreground/70 tracking-tight pt-1">
                        签到计划表
                      </span>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-muted-foreground">已设定的执行时间点</span>
                          <div className="flex items-center gap-2 rounded-lg bg-blue-500/5 px-3 py-1.5 text-[10px] font-bold text-blue-600 border border-blue-500/10">
                            <Clock3 className="h-3 w-3" />
                            最近执行: {formatDateTime(settings.dailyCheckinLastRunAt)}
                          </div>
                        </div>
                        
                        <div className="flex flex-wrap items-center gap-3">
                          {dailyCheckinTimesDraft.map((time) => (
                            <div
                              key={time}
                              className="group flex h-10 items-center gap-3 rounded-xl border border-blue-200 bg-blue-50/50 pl-4 pr-2 text-sm font-bold text-blue-700 shadow-sm transition-all hover:border-blue-400 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-400"
                            >
                              <span className="font-mono">{time}</span>
                              <button
                                type="button"
                                onClick={() => removeDailyCheckinTime(time)}
                                className="flex h-6 w-6 items-center justify-center rounded-lg transition-colors hover:bg-blue-200 dark:hover:bg-blue-500/30"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                          
                          <div className="flex items-center gap-2 bg-muted/20 p-1 rounded-xl border border-border/40 focus-within:border-primary/40 transition-colors shadow-sm">
                            <div className="flex items-center gap-0.5 font-mono">
                              <Select value={dailyCheckinHourDraft} onValueChange={setDailyCheckinHourDraft}>
                                <SelectTrigger className="h-9 w-[70px] border-none bg-transparent font-bold shadow-none focus:ring-0">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="rounded-xl shadow-xl">
                                  {HOUR_OPTIONS.map((hour) => (
                                    <SelectItem key={hour} value={hour} className="rounded-lg">{hour}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <span className="text-muted-foreground font-bold -mx-1">:</span>
                              <Select value={dailyCheckinMinuteDraft} onValueChange={setDailyCheckinMinuteDraft}>
                                <SelectTrigger className="h-9 w-[70px] border-none bg-transparent font-bold shadow-none focus:ring-0">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="rounded-xl shadow-xl">
                                  {MINUTE_OPTIONS.map((minute) => (
                                    <SelectItem key={minute} value={minute} className="rounded-lg">{minute}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <Button
                              type="button"
                              variant="default"
                              size="sm"
                              onClick={addDailyCheckinTime}
                              className="h-9 rounded-lg px-4 font-bold"
                            >
                              <Plus className="h-4 w-4 mr-1.5" />
                              添加
                            </Button>
                          </div>
                        </div>
                      
                      {dailyCheckinTimesDraft.length === 0 && (
                        <p className="text-xs font-medium text-muted-foreground bg-muted/10 p-4 rounded-xl border border-dashed border-border/60 text-center">
                          尚未配置任何签到时间点，点击“添加”创建新的调度。
                        </p>
                      )}
                    </div>
                  </div>
                  </div>
                </div>
              )}
            </CardContent>

            <div className="flex items-center justify-end gap-3 border-t border-border/40 bg-muted/20 px-8 py-6">
              <Button
                variant="outline"
                disabled={saving}
                onClick={() => {
                  setSystemDisplayNameDraft(settings.systemDisplayName);
                  setProxyUrlDraft(settings.proxyUrl ?? '');
                  setIncludeDisabledDraft(settings.includeDisabled);
                  setRequestTimeoutMsDraft(String(settings.requestTimeoutMs));
                  setConcurrencyDraft(String(settings.concurrency));
                  setAutoRefreshEnabledDraft(settings.autoRefreshEnabled);
                  setAutoCleanupAfterRefreshEnabledDraft(settings.autoCleanupAfterRefreshEnabled);
                  {
                    const nextIntervalDisplay = intervalDisplayFromMinutes(settings.autoRefreshIntervalMinutes);
                    setAutoRefreshIntervalValueDraft(nextIntervalDisplay.value);
                    setAutoRefreshIntervalUnitDraft(nextIntervalDisplay.unit);
                  }
                  setDailyCheckinEnabledDraft(settings.dailyCheckinScheduleEnabled);
                  setDailyCheckinTimesDraft(settings.dailyCheckinScheduleTimes);
                  setDailyCheckinHourDraft('09');
                  setDailyCheckinMinuteDraft('00');
                  resetVendorOrderDraft();
                }}
                className="rounded-xl h-11 px-8 font-bold transition-all active:scale-95"
              >
                放弃修改
              </Button>
              <Button 
                onClick={save} 
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
                    保存全部更改
                  </>
                )}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
