"use client";

import {
  Activity,
  AlertTriangle,
  Bell,
  Clock3,
  Database,
  GripVertical,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Save,
  Server,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PushManagementPanel } from "@/components/push-management-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DEFAULT_SYSTEM_DISPLAY_NAME } from "@/lib/app-identity";
import { withBasePath } from "@/lib/client/base-path";
import {
  type PushDeliveryRecord,
  getPushProviderLabel,
  getPushTaskLabel,
  type PushTarget,
  type PushTaskConfig,
  type PushTaskType,
  type PushTestTemplateType,
} from "@/lib/push/types";
import { toast } from "@/lib/toast";
import { cn, formatDateTime } from "@/lib/utils";

type SettingsPanel = "config" | "endpoint" | "schedule" | "push" | "status";
type IntervalUnit = "minutes" | "hours" | "days";
type DropPosition = "before" | "after";
type DropTarget = {
  vendorId: number;
  position: DropPosition;
};
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) =>
  String(i).padStart(2, "0"),
);
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) =>
  String(i).padStart(2, "0"),
);
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
  balanceRefreshAnomalyThresholdPercent: number;
  balanceRefreshAnomalyVendorIds: number[];
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

type HubSourceStatus = {
  connectionDisplay: string;
  schema: string;
  table: string;
  rawRecordCount: number;
  readableRecordCount: number;
  tableCount: number;
  tables: Array<{
    name: string;
    rowCount: number;
    readableRecordCount: number;
  }>;
};

type MonitorDatabaseStatus = {
  path: string;
  tableCount: number;
  tables: Array<{
    name: string;
    rowCount: number;
  }>;
};

type RedisStatus = {
  enabled: boolean;
  connected: boolean;
  lastUpdatedAt: string | null;
  errorMessage: string | null;
  connectionDisplay: string | null;
};

type HubSourceStatusApiResponse = {
  ok: boolean;
  message?: string;
  generatedAt?: string;
  hubSource?: HubSourceStatus;
};

type MonitorDatabaseStatusApiResponse = {
  ok: boolean;
  message?: string;
  generatedAt?: string;
  monitorDatabase?: MonitorDatabaseStatus;
};

type RedisStatusApiResponse = {
  ok: boolean;
  message?: string;
  generatedAt?: string;
  redis?: RedisStatus;
};

type PushManagementState = {
  targets: PushTarget[];
  tasks: PushTaskConfig[];
};

type PushManagementApiResponse = {
  ok: boolean;
  message?: string;
  targets?: PushTarget[];
  tasks?: PushTaskConfig[];
};

type PushTargetApiResponse = {
  ok: boolean;
  message?: string;
  target?: PushTarget;
  tasks?: PushTaskConfig[];
  result?: {
    success: boolean;
    error?: string;
    latencyMs?: number;
  };
};

type PushTaskApiResponse = {
  ok: boolean;
  message?: string;
  task?: PushTaskConfig;
};

type PushHistoryApiResponse = {
  ok: boolean;
  message?: string;
  records?: PushDeliveryRecord[];
};

function parseSettingsPanel(raw: string | null | undefined): SettingsPanel {
  const normalized = (raw || "").trim().toLowerCase();
  if (normalized === "status") {
    return "status";
  }
  if (normalized === "push") {
    return "push";
  }
  if (normalized === "schedule") {
    return "schedule";
  }
  if (normalized === "endpoint") {
    return "endpoint";
  }
  return "config";
}

function intervalDisplayFromMinutes(totalMinutesRaw: number): {
  value: string;
  unit: IntervalUnit;
} {
  const totalMinutes =
    Number.isFinite(totalMinutesRaw) && totalMinutesRaw > 0
      ? Math.trunc(totalMinutesRaw)
      : MIN_AUTO_REFRESH_INTERVAL_MINUTES;
  if (totalMinutes % (24 * 60) === 0) {
    return {
      value: String(totalMinutes / (24 * 60)),
      unit: "days",
    };
  }
  if (totalMinutes % 60 === 0) {
    return {
      value: String(totalMinutes / 60),
      unit: "hours",
    };
  }
  return {
    value: String(totalMinutes),
    unit: "minutes",
  };
}

function intervalMinutesFromDraft(
  value: string,
  unit: IntervalUnit,
): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  const base = Math.trunc(parsed);
  if (base <= 0) {
    return null;
  }
  if (unit === "days") {
    return base * 24 * 60;
  }
  if (unit === "hours") {
    return base * 60;
  }
  return base;
}

function normalizeVendorTypeLabel(
  vendorType: string | null | undefined,
): string {
  const value = (vendorType || "").trim();
  if (!value) {
    return "未配置类型";
  }
  return value;
}

function formatRecordCount(value: number): string {
  return value.toLocaleString("zh-CN");
}

const SYSTEM_STATUS_BADGE_BASE_CLASS =
  "inline-flex h-6 items-center justify-center rounded-full border px-2.5 text-[10px] font-bold leading-none tracking-widest whitespace-nowrap";

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
    insertIndex = dropPosition === "before" ? targetIndex - 1 : targetIndex;
  } else {
    insertIndex = dropPosition === "before" ? targetIndex : targetIndex + 1;
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
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        checked ? "border-primary/40 bg-primary/70" : "border-border bg-muted",
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-sm ring-1 ring-black/5 transition-transform duration-200",
          checked ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

function SelectedVendorPreview({ vendors }: { vendors: VendorOption[] }) {
  const previewHeight = 44;
  const previewRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [visibleCount, setVisibleCount] = useState(vendors.length);
  const [summaryHovered, setSummaryHovered] = useState(false);
  const [popoverHovered, setPopoverHovered] = useState(false);
  const [popoverPinned, setPopoverPinned] = useState(false);
  useEffect(() => {
    if (vendors.length === 0) {
      setVisibleCount(0);
      setSummaryHovered(false);
      setPopoverHovered(false);
      setPopoverPinned(false);
      return;
    }
    setVisibleCount(vendors.length);
  }, [vendors]);

  useEffect(() => {
    const previewElement = previewRef.current;
    if (!previewElement || typeof ResizeObserver === "undefined") {
      return;
    }

    let rafId: number | null = null;
    const observer = new ResizeObserver(() => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        setVisibleCount(vendors.length);
        rafId = null;
      });
    });
    observer.observe(previewElement);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [vendors.length]);

  useEffect(() => {
    const measureElement = measureRef.current;
    if (!measureElement || vendors.length === 0) {
      return;
    }

    if (measureElement.scrollHeight > previewHeight && visibleCount > 0) {
      setVisibleCount((current) => Math.max(0, current - 1));
    }
  }, [previewHeight, vendors.length, visibleCount]);

  useEffect(() => {
    if (visibleCount >= vendors.length) {
      setSummaryHovered(false);
      setPopoverHovered(false);
      setPopoverPinned(false);
    }
  }, [vendors.length, visibleCount]);

  if (vendors.length === 0) {
    return (
      <div className="flex h-[58px] w-full flex-col items-center justify-center gap-1.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted/60">
          <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground/60" />
        </div>
        <span className="text-[11px] font-medium text-muted-foreground/60">
          未选择任何服务商，无法执行异常检测
        </span>
      </div>
    );
  }

  const previewVendors =
    visibleCount >= vendors.length ? vendors : vendors.slice(0, visibleCount);
  const hiddenCount = Math.max(0, vendors.length - previewVendors.length);
  const hasOverflow = hiddenCount > 0;
  const popoverOpen =
    hasOverflow && (summaryHovered || popoverHovered || popoverPinned);

  return (
    <div className="relative">
      <div
        ref={measureRef}
        className="pointer-events-none invisible absolute inset-x-0 top-0 -z-10 flex flex-wrap content-start items-start gap-1"
        aria-hidden="true"
      >
        {previewVendors.map((vendor) => (
          <span
            key={`measure-${vendor.id}`}
            className="inline-flex h-5 max-w-[112px] items-center rounded-full border border-border/50 bg-background/80 px-1.5 py-0 text-[10px] font-semibold text-foreground/80"
          >
            <span className="truncate">{vendor.name}</span>
          </span>
        ))}
        {hasOverflow ? (
          <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-primary/25 bg-primary/8 px-1.5 py-0 text-[10px] font-semibold text-primary/85">
            剩余 {hiddenCount} 个
          </span>
        ) : null}
      </div>

      {popoverOpen ? (
        <div
          className="absolute bottom-full left-0 z-20 mb-2 w-full max-w-xl rounded-2xl border border-border/60 bg-background/95 p-3 shadow-2xl backdrop-blur-xl"
          onMouseEnter={() => setPopoverHovered(true)}
          onMouseLeave={() => setPopoverHovered(false)}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold text-foreground">
                全部已选服务商
              </p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {popoverPinned
                  ? "已固定，再次点击省略标签可取消固定。"
                  : "移动离开后自动关闭，点击省略标签可固定。"}
              </p>
            </div>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold",
                popoverPinned
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {popoverPinned ? "已固定" : "悬浮预览"}
            </span>
          </div>
          <div className="mt-3 flex max-h-40 flex-wrap content-start items-start gap-1.5 overflow-y-auto pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
            {vendors.map((vendor) => (
              <span
                key={`popover-${vendor.id}`}
                className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-muted/15 px-2 py-1 text-[10px] font-semibold text-foreground/80"
              >
                {vendor.name}
                <span className="text-muted-foreground/60">·</span>
                {normalizeVendorTypeLabel(vendor.vendorType)}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div
        ref={previewRef}
        className="flex flex-wrap content-start items-start gap-1 overflow-hidden"
        style={{ height: `${previewHeight}px` }}
      >
        {previewVendors.map((vendor) => (
          <span
            key={vendor.id}
            className="inline-flex h-5 max-w-[112px] items-center rounded-full border border-border/50 bg-background/80 px-1.5 py-0 text-[10px] font-semibold text-foreground/80 shadow-sm"
            title={vendor.name}
          >
            <span className="truncate">{vendor.name}</span>
          </span>
        ))}
        {hasOverflow ? (
          <button
            type="button"
            className={cn(
              "inline-flex h-5 shrink-0 items-center rounded-full border px-1.5 py-0 text-[10px] font-semibold shadow-sm transition-colors",
              popoverPinned
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-primary/25 bg-primary/8 text-primary/85 hover:bg-primary/12 hover:text-primary",
            )}
            onMouseEnter={() => setSummaryHovered(true)}
            onMouseLeave={() => setSummaryHovered(false)}
            onClick={() => setPopoverPinned((current) => !current)}
            aria-pressed={popoverPinned}
          >
            剩余 {hiddenCount} 个
          </button>
        ) : null}
      </div>
    </div>
  );
}

function PanelHeader({
  icon,
  title,
  description,
}: {
  icon: "settings" | "schedule" | "push" | "status";
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-4">
        <div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 sm:flex">
          {icon === "settings" ? (
            <Settings2 className="h-6 w-6 text-primary" />
          ) : icon === "schedule" ? (
            <Clock3 className="h-6 w-6 text-primary" />
          ) : icon === "push" ? (
            <Bell className="h-6 w-6 text-primary" />
          ) : (
            <Activity className="h-6 w-6 text-primary" />
          )}
        </div>
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground md:text-2xl">
            {title}
          </h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
    </div>
  );
}

export function SystemSettingsPage({
  initialSettings,
  initialPushManagement,
  initialPushRecords,
}: {
  initialSettings: SystemSettings;
  initialPushManagement: PushManagementState;
  initialPushRecords: PushDeliveryRecord[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialIntervalDisplay = intervalDisplayFromMinutes(
    initialSettings.autoRefreshIntervalMinutes,
  );
  const [settings, setSettings] = useState<SystemSettings>(initialSettings);
  const [systemDisplayNameDraft, setSystemDisplayNameDraft] = useState(
    initialSettings.systemDisplayName,
  );
  const [proxyUrlDraft, setProxyUrlDraft] = useState(
    initialSettings.proxyUrl ?? "",
  );
  const [includeDisabledDraft, setIncludeDisabledDraft] = useState(
    initialSettings.includeDisabled,
  );
  const [requestTimeoutMsDraft, setRequestTimeoutMsDraft] = useState(
    String(initialSettings.requestTimeoutMs),
  );
  const [concurrencyDraft, setConcurrencyDraft] = useState(
    String(initialSettings.concurrency),
  );
  const [autoRefreshEnabledDraft, setAutoRefreshEnabledDraft] = useState(
    initialSettings.autoRefreshEnabled,
  );
  const [
    autoCleanupAfterRefreshEnabledDraft,
    setAutoCleanupAfterRefreshEnabledDraft,
  ] = useState(initialSettings.autoCleanupAfterRefreshEnabled);
  const [autoRefreshIntervalValueDraft, setAutoRefreshIntervalValueDraft] =
    useState(initialIntervalDisplay.value);
  const [autoRefreshIntervalUnitDraft, setAutoRefreshIntervalUnitDraft] =
    useState<IntervalUnit>(initialIntervalDisplay.unit);
  const [dailyCheckinEnabledDraft, setDailyCheckinEnabledDraft] = useState(
    initialSettings.dailyCheckinScheduleEnabled,
  );
  const [dailyCheckinTimesDraft, setDailyCheckinTimesDraft] = useState<
    string[]
  >(initialSettings.dailyCheckinScheduleTimes);
  const [pushTargets, setPushTargets] = useState<PushTarget[]>(
    initialPushManagement.targets,
  );
  const [pushTasks, setPushTasks] = useState<PushTaskConfig[]>(
    initialPushManagement.tasks,
  );
  const [pushRecords, setPushRecords] =
    useState<PushDeliveryRecord[]>(initialPushRecords);
  const [
    dailyCheckinSummaryPushEnabledDraft,
    setDailyCheckinSummaryPushEnabledDraft,
  ] = useState(
    initialPushManagement.tasks.find(
      (task) => task.taskType === "daily_checkin_summary",
    )?.enabled ?? false,
  );
  const [
    dailyCheckinBalanceRefreshPushEnabledDraft,
    setDailyCheckinBalanceRefreshPushEnabledDraft,
  ] = useState(
    initialPushManagement.tasks.find(
      (task) => task.taskType === "daily_checkin_balance_refresh",
    )?.enabled ?? false,
  );
  const [
    balanceRefreshAnomalyPushEnabledDraft,
    setBalanceRefreshAnomalyPushEnabledDraft,
  ] = useState(
    initialPushManagement.tasks.find(
      (task) => task.taskType === "daily_checkin_balance_refresh_anomaly",
    )?.enabled ?? false,
  );
  const [
    balanceRefreshAnomalyThresholdDraft,
    setBalanceRefreshAnomalyThresholdDraft,
  ] = useState(String(initialSettings.balanceRefreshAnomalyThresholdPercent));
  const [
    balanceRefreshAnomalyVendorIdsDraft,
    setBalanceRefreshAnomalyVendorIdsDraft,
  ] = useState<number[]>(initialSettings.balanceRefreshAnomalyVendorIds);
  const [dailyCheckinHourDraft, setDailyCheckinHourDraft] = useState("09");
  const [dailyCheckinMinuteDraft, setDailyCheckinMinuteDraft] = useState("00");
  const [balanceRefreshAnomalyDialogOpen, setBalanceRefreshAnomalyDialogOpen] =
    useState(false);
  const [activePanel, setActivePanel] = useState<SettingsPanel>(() =>
    parseSettingsPanel(searchParams?.get("panel")),
  );
  const [saving, setSaving] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [vendorsForOrder, setVendorsForOrder] = useState<VendorOption[]>([]);
  const [initialVendorOrderIds, setInitialVendorOrderIds] = useState<number[]>(
    [],
  );
  const [vendorOrderLoading, setVendorOrderLoading] = useState(false);
  const [vendorOrderSaving, setVendorOrderSaving] = useState(false);
  const [draggingVendorId, setDraggingVendorId] = useState<number | null>(null);
  const [dragOverVendorId, setDragOverVendorId] = useState<number | null>(null);
  const [dragOverPosition, setDragOverPosition] = useState<DropPosition | null>(
    null,
  );
  const [statusGeneratedAt, setStatusGeneratedAt] = useState<string | null>(
    null,
  );
  const [hubSourceStatus, setHubSourceStatus] =
    useState<HubSourceStatus | null>(null);
  const [monitorDatabaseStatus, setMonitorDatabaseStatus] =
    useState<MonitorDatabaseStatus | null>(null);
  const [redisStatus, setRedisStatus] = useState<RedisStatus | null>(null);
  const [systemStatusLoading, setSystemStatusLoading] = useState(false);
  const [systemStatusError, setSystemStatusError] = useState<string | null>(
    null,
  );
  const [hubSourceLoading, setHubSourceLoading] = useState(false);
  const [monitorDatabaseLoading, setMonitorDatabaseLoading] = useState(false);
  const [redisLoading, setRedisLoading] = useState(false);
  const [hubSourceError, setHubSourceError] = useState<string | null>(null);
  const [monitorDatabaseError, setMonitorDatabaseError] = useState<
    string | null
  >(null);
  const [redisError, setRedisError] = useState<string | null>(null);
  const draggingVendorIdRef = useRef<number | null>(null);
  const systemStatusRequestIdRef = useRef(0);
  const vendorRowRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const dragPreviewRef = useRef<{
    vendorId: number | null;
    position: DropPosition | null;
  }>({
    vendorId: null,
    position: null,
  });

  const pushTasksPreview = useMemo<PushTaskConfig[]>(
    () =>
      pushTasks.map((task) =>
        task.taskType === "daily_checkin_summary"
          ? { ...task, enabled: dailyCheckinSummaryPushEnabledDraft }
          : task.taskType === "daily_checkin_balance_refresh"
            ? { ...task, enabled: dailyCheckinBalanceRefreshPushEnabledDraft }
            : task.taskType === "daily_checkin_balance_refresh_anomaly"
              ? { ...task, enabled: balanceRefreshAnomalyPushEnabledDraft }
              : task,
      ),
    [
      balanceRefreshAnomalyPushEnabledDraft,
      dailyCheckinBalanceRefreshPushEnabledDraft,
      dailyCheckinSummaryPushEnabledDraft,
      pushTasks,
    ],
  );

  const summaryPushTask = useMemo(
    () =>
      pushTasksPreview.find(
        (task) => task.taskType === "daily_checkin_summary",
      ) ?? {
        taskType: "daily_checkin_summary" as const,
        enabled: false,
        targetIds: [],
      },
    [pushTasksPreview],
  );

  const balanceRefreshPushTask = useMemo(
    () =>
      pushTasksPreview.find(
        (task) => task.taskType === "daily_checkin_balance_refresh",
      ) ?? {
        taskType: "daily_checkin_balance_refresh" as const,
        enabled: false,
        targetIds: [],
      },
    [pushTasksPreview],
  );

  const balanceRefreshAnomalyPushTask = useMemo(
    () =>
      pushTasksPreview.find(
        (task) => task.taskType === "daily_checkin_balance_refresh_anomaly",
      ) ?? {
        taskType: "daily_checkin_balance_refresh_anomaly" as const,
        enabled: false,
        targetIds: [],
      },
    [pushTasksPreview],
  );

  const selectedAnomalyVendors = useMemo(() => {
    const vendorMap = new Map(
      vendorsForOrder.map((vendor) => [vendor.id, vendor] as const),
    );
    return balanceRefreshAnomalyVendorIdsDraft
      .map((vendorId) => vendorMap.get(vendorId) ?? null)
      .filter((vendor): vendor is VendorOption => vendor !== null);
  }, [balanceRefreshAnomalyVendorIdsDraft, vendorsForOrder]);

  const setDragPreview = useCallback(
    (vendorId: number | null, position: DropPosition | null) => {
      const current = dragPreviewRef.current;
      if (current.vendorId === vendorId && current.position === position) {
        return;
      }
      dragPreviewRef.current = { vendorId, position };
      setDragOverVendorId(vendorId);
      setDragOverPosition(position);
    },
    [],
  );

  const clearDragPreview = useCallback(() => {
    setDragPreview(null, null);
  }, [setDragPreview]);

  const resetDragState = useCallback(() => {
    draggingVendorIdRef.current = null;
    setDraggingVendorId(null);
    clearDragPreview();
  }, [clearDragPreview]);

  const getDraggingVendorIdFromEvent = useCallback(
    (event: ReactDragEvent<HTMLElement>): number | null => {
      const fromRef = draggingVendorIdRef.current;
      if (
        typeof fromRef === "number" &&
        Number.isInteger(fromRef) &&
        fromRef > 0
      ) {
        return fromRef;
      }

      const raw = event.dataTransfer.getData("text/plain");
      const parsed = Number(raw);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    },
    [],
  );

  const inferDropTargetByClientY = useCallback(
    (clientY: number): DropTarget | null => {
      const movingId = draggingVendorIdRef.current;
      if (
        typeof movingId !== "number" ||
        !Number.isInteger(movingId) ||
        movingId <= 0
      ) {
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
        .filter(
          (value): value is { vendorId: number; top: number; bottom: number } =>
            value !== null,
        )
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
          position: "before",
        },
      });

      for (let i = 0; i < visualRows.length - 1; i += 1) {
        const currentRow = visualRows[i];
        const nextRow = visualRows[i + 1];
        insertionSlots.push({
          y: (currentRow.bottom + nextRow.top) / 2,
          target: {
            vendorId: nextRow.vendorId,
            position: "before",
          },
        });
      }

      const lastRow = visualRows[visualRows.length - 1];
      insertionSlots.push({
        y: lastRow.bottom,
        target: {
          vendorId: lastRow.vendorId,
          position: "after",
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
    },
    [vendorsForOrder],
  );

  const updateDragPreviewFromPointer = useCallback(
    (event: ReactDragEvent<HTMLDivElement>): DropTarget | null => {
      const target = inferDropTargetByClientY(event.clientY);
      if (!target) {
        clearDragPreview();
        return null;
      }
      setDragPreview(target.vendorId, target.position);
      return target;
    },
    [clearDragPreview, inferDropTargetByClientY, setDragPreview],
  );

  const handleVendorOrderListDragEnter = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (draggingVendorIdRef.current === null) {
        return;
      }
      event.dataTransfer.dropEffect = "move";
      updateDragPreviewFromPointer(event);
    },
    [updateDragPreviewFromPointer],
  );

  const handleVendorOrderListDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (draggingVendorIdRef.current === null) {
        return;
      }
      event.dataTransfer.dropEffect = "move";
      updateDragPreviewFromPointer(event);
    },
    [updateDragPreviewFromPointer],
  );

  const handleVendorOrderListDragLeave = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
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
    },
    [clearDragPreview],
  );

  const handleVendorOrderListDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const movingId = getDraggingVendorIdFromEvent(event);
      if (movingId === null) {
        resetDragState();
        return;
      }

      const previewVendorId = dragPreviewRef.current.vendorId;
      const previewPosition = dragPreviewRef.current.position;
      const preview: DropTarget | null =
        previewVendorId !== null && previewPosition !== null
          ? { vendorId: previewVendorId, position: previewPosition }
          : null;
      const target = preview ?? updateDragPreviewFromPointer(event);
      if (target) {
        moveVendor(movingId, target.vendorId, target.position);
      }
      resetDragState();
    },
    [
      getDraggingVendorIdFromEvent,
      moveVendor,
      resetDragState,
      updateDragPreviewFromPointer,
    ],
  );

  const setVendorRowRef = useCallback(
    (vendorId: number, node: HTMLDivElement | null) => {
      if (node) {
        vendorRowRefs.current.set(vendorId, node);
        return;
      }
      vendorRowRefs.current.delete(vendorId);
    },
    [],
  );

  const vendorOrderIds = useMemo(
    () => vendorsForOrder.map((vendor) => vendor.id),
    [vendorsForOrder],
  );
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
    if (
      draggingVendorId === null ||
      dragOverVendorId === null ||
      dragOverPosition === null
    ) {
      return vendorsForOrder;
    }
    return applyVendorMoveOrder(
      vendorsForOrder,
      draggingVendorId,
      dragOverVendorId,
      dragOverPosition,
    );
  }, [dragOverPosition, dragOverVendorId, draggingVendorId, vendorsForOrder]);

  const loadVendorsForOrder = async () => {
    setVendorOrderLoading(true);
    try {
      const response = await fetch(withBasePath("/api/vendors"), {
        cache: "no-store",
      });
      const body = (await response
        .json()
        .catch(() => ({}))) as VendorsApiResponse;
      if (!response.ok || !body.ok || !Array.isArray(body.vendors)) {
        throw new Error(body.message || "读取服务商列表失败");
      }
      setVendorsForOrder(body.vendors);
      setInitialVendorOrderIds(body.vendors.map((vendor) => vendor.id));
      resetDragState();
    } catch (error) {
      toast.error(
        "读取服务商列表失败",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setVendorOrderLoading(false);
    }
  };

  const openBalanceRefreshAnomalyDialog = useCallback(() => {
    setBalanceRefreshAnomalyDialogOpen(true);
    if (!vendorOrderLoading && vendorsForOrder.length === 0) {
      void loadVendorsForOrder();
    }
  }, [vendorOrderLoading, vendorsForOrder.length]);

  const loadHubSourceStatus = useCallback(
    async (requestId: number, showToastOnError = false) => {
      setHubSourceLoading(true);
      setHubSourceError(null);
      try {
        const response = await fetch(
          withBasePath("/api/system-settings/status/hub-source"),
          { cache: "no-store" },
        );
        const body = (await response
          .json()
          .catch(() => ({}))) as HubSourceStatusApiResponse;
        if (!response.ok || !body.ok || !body.hubSource) {
          throw new Error(body.message || "读取 PostgreSQL 源库状态失败");
        }
        if (systemStatusRequestIdRef.current !== requestId) {
          return true;
        }
        setHubSourceStatus(body.hubSource);
        if (body.generatedAt) {
          setStatusGeneratedAt(body.generatedAt);
        }
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (systemStatusRequestIdRef.current !== requestId) {
          return false;
        }
        setHubSourceError(message);
        if (showToastOnError) {
          toast.error("读取 PostgreSQL 源库状态失败", message);
        }
        return false;
      } finally {
        if (systemStatusRequestIdRef.current === requestId) {
          setHubSourceLoading(false);
        }
      }
    },
    [],
  );

  const loadMonitorDatabaseStatus = useCallback(
    async (requestId: number, showToastOnError = false) => {
      setMonitorDatabaseLoading(true);
      setMonitorDatabaseError(null);
      try {
        const response = await fetch(
          withBasePath("/api/system-settings/status/monitor-database"),
          { cache: "no-store" },
        );
        const body = (await response
          .json()
          .catch(() => ({}))) as MonitorDatabaseStatusApiResponse;
        if (!response.ok || !body.ok || !body.monitorDatabase) {
          throw new Error(body.message || "读取 SQLite 状态失败");
        }
        if (systemStatusRequestIdRef.current !== requestId) {
          return true;
        }
        setMonitorDatabaseStatus(body.monitorDatabase);
        if (body.generatedAt) {
          setStatusGeneratedAt(body.generatedAt);
        }
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (systemStatusRequestIdRef.current !== requestId) {
          return false;
        }
        setMonitorDatabaseError(message);
        if (showToastOnError) {
          toast.error("读取 SQLite 状态失败", message);
        }
        return false;
      } finally {
        if (systemStatusRequestIdRef.current === requestId) {
          setMonitorDatabaseLoading(false);
        }
      }
    },
    [],
  );

  const loadRedisStatus = useCallback(
    async (requestId: number, showToastOnError = false) => {
      setRedisLoading(true);
      setRedisError(null);
      try {
        const response = await fetch(
          withBasePath("/api/system-settings/status/redis"),
          { cache: "no-store" },
        );
        const body = (await response
          .json()
          .catch(() => ({}))) as RedisStatusApiResponse;
        if (!response.ok || !body.ok || !body.redis) {
          throw new Error(body.message || "读取 Redis 状态失败");
        }
        if (systemStatusRequestIdRef.current !== requestId) {
          return true;
        }
        setRedisStatus(body.redis);
        if (body.generatedAt) {
          setStatusGeneratedAt(body.generatedAt);
        }
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (systemStatusRequestIdRef.current !== requestId) {
          return false;
        }
        setRedisError(message);
        if (showToastOnError) {
          toast.error("读取 Redis 状态失败", message);
        }
        return false;
      } finally {
        if (systemStatusRequestIdRef.current === requestId) {
          setRedisLoading(false);
        }
      }
    },
    [],
  );

  const loadSystemStatus = useCallback(
    async (showToastOnError = false) => {
      const requestId = systemStatusRequestIdRef.current + 1;
      systemStatusRequestIdRef.current = requestId;
      setSystemStatusLoading(true);
      setSystemStatusError(null);

      const results = await Promise.all([
        loadHubSourceStatus(requestId, showToastOnError),
        loadMonitorDatabaseStatus(requestId, showToastOnError),
        loadRedisStatus(requestId, showToastOnError),
      ]);

      if (systemStatusRequestIdRef.current !== requestId) {
        return;
      }

      if (results.every((item) => item === false)) {
        setSystemStatusError("PostgreSQL、SQLite 和 Redis 状态均读取失败");
      } else {
        setSystemStatusError(null);
        setStatusGeneratedAt(new Date().toISOString());
      }
      setSystemStatusLoading(false);
    },
    [loadHubSourceStatus, loadMonitorDatabaseStatus, loadRedisStatus],
  );

  function moveVendor(
    movingId: number,
    targetId: number,
    dropPosition: DropPosition,
  ) {
    setVendorsForOrder((current) =>
      applyVendorMoveOrder(current, movingId, targetId, dropPosition),
    );
  }

  const replacePushTaskState = useCallback((task: PushTaskConfig) => {
    setPushTasks((current) =>
      current.map((item) => (item.taskType === task.taskType ? task : item)),
    );
    if (task.taskType === "daily_checkin_summary") {
      setDailyCheckinSummaryPushEnabledDraft(task.enabled);
    }
    if (task.taskType === "daily_checkin_balance_refresh") {
      setDailyCheckinBalanceRefreshPushEnabledDraft(task.enabled);
    }
    if (task.taskType === "daily_checkin_balance_refresh_anomaly") {
      setBalanceRefreshAnomalyPushEnabledDraft(task.enabled);
    }
  }, []);

  const handleCreatePushTarget = useCallback(
    async (input: Record<string, unknown>) => {
      try {
        const response = await fetch(
          withBasePath("/api/push-management/targets"),
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(input),
          },
        );
        const body = (await response
          .json()
          .catch(() => ({}))) as PushTargetApiResponse;
        if (!response.ok || !body.ok || !body.target) {
          throw new Error(body.message || "创建推送目标失败");
        }
        setPushTargets((current) => [...current, body.target!]);
        toast.success("推送目标已创建");
        return { ok: true, target: body.target };
      } catch (error) {
        toast.error(
          "创建推送目标失败",
          error instanceof Error ? error.message : String(error),
        );
        return { ok: false };
      }
    },
    [],
  );

  const handleUpdatePushTarget = useCallback(
    async (targetId: string, input: Record<string, unknown>) => {
      try {
        const response = await fetch(
          withBasePath(
            `/api/push-management/targets/${encodeURIComponent(targetId)}`,
          ),
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(input),
          },
        );
        const body = (await response
          .json()
          .catch(() => ({}))) as PushTargetApiResponse;
        if (!response.ok || !body.ok || !body.target) {
          throw new Error(body.message || "更新推送目标失败");
        }
        setPushTargets((current) =>
          current.map((item) => (item.id === targetId ? body.target! : item)),
        );
        if (body.tasks) {
          setPushTasks(body.tasks);
        }
        toast.success("推送目标已更新");
        return { ok: true, target: body.target, message: body.message };
      } catch (error) {
        toast.error(
          "更新推送目标失败",
          error instanceof Error ? error.message : String(error),
        );
        return { ok: false };
      }
    },
    [],
  );

  const handleDeletePushTarget = useCallback(async (targetId: string) => {
    try {
      const response = await fetch(
        withBasePath(
          `/api/push-management/targets/${encodeURIComponent(targetId)}`,
        ),
        {
          method: "DELETE",
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || !body.ok) {
        throw new Error(body.message || "删除推送目标失败");
      }
      setPushTargets((current) =>
        current.filter((item) => item.id !== targetId),
      );
      setPushTasks((current) =>
        current.map((task) => ({
          ...task,
          targetIds: task.targetIds.filter((id) => id !== targetId),
        })),
      );
      toast.success("推送目标已删除");
      return { ok: true };
    } catch (error) {
      toast.error(
        "删除推送目标失败",
        error instanceof Error ? error.message : String(error),
      );
      return { ok: false };
    }
  }, []);

  const handleRefreshPushRecords = useCallback(
    async (options?: { silent?: boolean }) => {
      try {
        const response = await fetch(
          withBasePath("/api/push-management/history"),
        );
        const body = (await response
          .json()
          .catch(() => ({}))) as PushHistoryApiResponse;
        if (!response.ok || !body.ok || !body.records) {
          throw new Error(body.message || "读取推送记录失败");
        }
        setPushRecords(body.records);
        if (!options?.silent) {
          toast.success("推送记录已刷新");
        }
        return { ok: true, payload: body.records };
      } catch (error) {
        if (!options?.silent) {
          toast.error(
            "读取推送记录失败",
            error instanceof Error ? error.message : String(error),
          );
        }
        return { ok: false };
      }
    },
    [],
  );

  const handleTestPushTarget = useCallback(
    async (targetId: string, templateType: PushTestTemplateType) => {
      try {
        const response = await fetch(
          withBasePath(
            `/api/push-management/targets/${encodeURIComponent(targetId)}/test`,
          ),
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              templateType,
            }),
          },
        );
        const body = (await response
          .json()
          .catch(() => ({}))) as PushTargetApiResponse;
        if (!response.ok || !body.ok || !body.target || !body.result) {
          throw new Error(body.message || "测试推送失败");
        }
        setPushTargets((current) =>
          current.map((item) => (item.id === targetId ? body.target! : item)),
        );
        if (body.result.success) {
          toast.success("测试消息已发送");
        } else {
          toast.warning("测试消息发送失败", body.result.error || "未知错误");
        }
        void handleRefreshPushRecords({ silent: true });
        return { ok: true, target: body.target, result: body.result };
      } catch (error) {
        toast.error(
          "测试推送失败",
          error instanceof Error ? error.message : String(error),
        );
        return { ok: false };
      }
    },
    [handleRefreshPushRecords],
  );

  const handleSavePushTask = useCallback(
    async (
      taskType: PushTaskType,
      input: { enabled: boolean; targetIds: string[] },
      options?: { silent?: boolean },
    ) => {
      try {
        const response = await fetch(
          withBasePath(
            `/api/push-management/tasks/${encodeURIComponent(taskType)}`,
          ),
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(input),
          },
        );
        const body = (await response
          .json()
          .catch(() => ({}))) as PushTaskApiResponse;
        if (!response.ok || !body.ok || !body.task) {
          throw new Error(body.message || "保存推送任务失败");
        }
        replacePushTaskState(body.task);
        if (!options?.silent) {
          toast.success(`${getPushTaskLabel(taskType)}已保存`);
        }
        return { ok: true, task: body.task };
      } catch (error) {
        if (!options?.silent) {
          toast.error(
            "保存推送任务失败",
            error instanceof Error ? error.message : String(error),
          );
        }
        return { ok: false };
      }
    },
    [replacePushTaskState],
  );

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
    const nextPanel = parseSettingsPanel(searchParams?.get("panel"));
    setActivePanel((current) => (current === nextPanel ? current : nextPanel));
  }, [searchParams]);

  useEffect(() => {
    if (activePanel !== "endpoint") {
      return;
    }
    if (vendorOrderLoading || vendorsForOrder.length > 0) {
      return;
    }
    void loadVendorsForOrder();
  }, [activePanel, vendorOrderLoading, vendorsForOrder.length]);

  useEffect(() => {
    if (activePanel !== "schedule") {
      return;
    }
    if (balanceRefreshAnomalyVendorIdsDraft.length === 0) {
      return;
    }
    if (vendorOrderLoading || vendorsForOrder.length > 0) {
      return;
    }
    void loadVendorsForOrder();
  }, [
    activePanel,
    balanceRefreshAnomalyVendorIdsDraft.length,
    vendorOrderLoading,
    vendorsForOrder.length,
  ]);

  useEffect(() => {
    if (activePanel !== "status" || systemStatusLoading) {
      return;
    }
    if (hubSourceStatus || monitorDatabaseStatus || redisStatus) {
      return;
    }
    void loadSystemStatus();
  }, [
    activePanel,
    hubSourceStatus,
    loadSystemStatus,
    monitorDatabaseStatus,
    redisStatus,
    systemStatusLoading,
  ]);

  const hasAnySystemStatusData = Boolean(
    hubSourceStatus || monitorDatabaseStatus || redisStatus,
  );

  const switchPanel = (nextPanel: SettingsPanel) => {
    setActivePanel(nextPanel);

    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (nextPanel === "config") {
      params.delete("panel");
    } else {
      params.set("panel", nextPanel);
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
      return [...current, normalized].sort((left, right) =>
        left.localeCompare(right),
      );
    });
  };

  const removeDailyCheckinTime = (target: string) => {
    setDailyCheckinTimesDraft((current) =>
      current.filter((time) => time !== target),
    );
  };

  const save = async () => {
    setSaving(true);
    let shouldPersistVendorOrder = false;

    const intervalMinutes = intervalMinutesFromDraft(
      autoRefreshIntervalValueDraft,
      autoRefreshIntervalUnitDraft,
    );
    if (intervalMinutes === null) {
      setSaving(false);
      toast.error("保存失败", "刷新间隔必须是正整数");
      return;
    }
    if (intervalMinutes < MIN_AUTO_REFRESH_INTERVAL_MINUTES) {
      setSaving(false);
      toast.warning("刷新间隔过短", "最小间隔为 30 分钟");
      return;
    }

    try {
      shouldPersistVendorOrder = vendorOrderDirty;
      const orderedVendorIdsSnapshot = [...vendorOrderIds];
      if (shouldPersistVendorOrder) {
        setVendorOrderSaving(true);
      }

      const response = await fetch(withBasePath("/api/system-settings"), {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
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
          balanceRefreshAnomalyThresholdPercent: Number(
            balanceRefreshAnomalyThresholdDraft,
          ),
          balanceRefreshAnomalyVendorIds: balanceRefreshAnomalyVendorIdsDraft,
        }),
      });

      const body = (await response.json()) as SettingsApiResponse;
      if (!response.ok || !body.ok || !body.settings) {
        throw new Error(body.message || "保存系统设置失败");
      }

      setSettings(body.settings);
      setSystemDisplayNameDraft(body.settings.systemDisplayName);
      setProxyUrlDraft(body.settings.proxyUrl ?? "");
      setIncludeDisabledDraft(body.settings.includeDisabled);
      setRequestTimeoutMsDraft(String(body.settings.requestTimeoutMs));
      setConcurrencyDraft(String(body.settings.concurrency));
      setAutoRefreshEnabledDraft(body.settings.autoRefreshEnabled);
      setAutoCleanupAfterRefreshEnabledDraft(
        body.settings.autoCleanupAfterRefreshEnabled,
      );
      {
        const nextIntervalDisplay = intervalDisplayFromMinutes(
          body.settings.autoRefreshIntervalMinutes,
        );
        setAutoRefreshIntervalValueDraft(nextIntervalDisplay.value);
        setAutoRefreshIntervalUnitDraft(nextIntervalDisplay.unit);
      }
      setDailyCheckinEnabledDraft(body.settings.dailyCheckinScheduleEnabled);
      setDailyCheckinTimesDraft(body.settings.dailyCheckinScheduleTimes);
      setBalanceRefreshAnomalyThresholdDraft(
        String(body.settings.balanceRefreshAnomalyThresholdPercent),
      );
      setBalanceRefreshAnomalyVendorIdsDraft(
        body.settings.balanceRefreshAnomalyVendorIds,
      );
      if (typeof document !== "undefined") {
        document.title = body.settings.systemDisplayName;
      }

      let pushSaveError: string | null = null;
      const nextPushTasks = pushTasksPreview;
      for (const task of nextPushTasks) {
        const result = await handleSavePushTask(
          task.taskType,
          {
            enabled: task.enabled,
            targetIds: task.targetIds,
          },
          { silent: true },
        );
        if (!result.ok) {
          pushSaveError = `${getPushTaskLabel(task.taskType)} 保存失败`;
          break;
        }
      }

      let vendorOrderSaveError: string | null = null;
      if (shouldPersistVendorOrder) {
        try {
          const orderResponse = await fetch(
            withBasePath("/api/vendors/order"),
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                orderedVendorIds: orderedVendorIdsSnapshot,
              }),
            },
          );
          const orderBody = (await orderResponse
            .json()
            .catch(() => ({}))) as VendorsApiResponse;
          if (
            !orderResponse.ok ||
            !orderBody.ok ||
            !Array.isArray(orderBody.vendors)
          ) {
            throw new Error(orderBody.message || "保存服务商顺序失败");
          }
          setVendorsForOrder(orderBody.vendors);
          setInitialVendorOrderIds(
            orderBody.vendors.map((vendor) => vendor.id),
          );
          resetDragState();
        } catch (error) {
          vendorOrderSaveError =
            error instanceof Error ? error.message : String(error);
        }
      }

      if (pushSaveError && vendorOrderSaveError) {
        toast.warning(
          "部分配置保存成功",
          `${pushSaveError}；${vendorOrderSaveError}`,
        );
      } else if (pushSaveError) {
        toast.warning("基础配置已保存，推送配置保存失败", pushSaveError);
      } else if (vendorOrderSaveError) {
        toast.warning("配置已保存，服务商顺序保存失败", vendorOrderSaveError);
      } else {
        toast.success(
          "保存成功",
          shouldPersistVendorOrder
            ? "设置与服务商顺序已即时生效。"
            : "设置已即时生效。",
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
      const response = await fetch(
        withBasePath("/api/system-settings/cleanup"),
        {
          method: "POST",
        },
      );

      const body = (await response.json()) as CleanupApiResponse;
      if (!response.ok || !body.ok) {
        throw new Error(body.message || "清理失败");
      }

      const deletedEndpoints = Number(body.deletedEndpoints ?? 0);
      const deletedVendors = Number(body.deletedVendors ?? 0);

      if (deletedEndpoints === 0 && deletedVendors === 0) {
        toast.info("没有需要清理的过期数据");
        return;
      }

      toast.success(
        "清理完成",
        `已删除 ${deletedEndpoints} 条端点设置，清理 ${deletedVendors} 个无引用服务商`,
      );
    } catch (err) {
      toast.error("清理失败", err instanceof Error ? err.message : String(err));
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
              onClick={() => switchPanel("config")}
              className={cn(
                "relative flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold tracking-tight transition-all duration-300",
                activePanel === "config"
                  ? "bg-background text-foreground shadow-md ring-1 ring-border/60"
                  : "text-muted-foreground hover:bg-background/5 hover:text-foreground",
              )}
            >
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg shadow-sm transition-colors",
                  activePanel === "config"
                    ? "bg-rose-500 text-white"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <Settings2 className="h-4 w-4" />
              </div>
              <span className="flex-1 text-left">基础配置</span>
              {activePanel === "config" && (
                <div className="h-1.5 w-1.5 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]" />
              )}
            </button>
            <button
              type="button"
              onClick={() => switchPanel("endpoint")}
              className={cn(
                "relative flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold tracking-tight transition-all duration-300",
                activePanel === "endpoint"
                  ? "bg-background text-foreground shadow-md ring-1 ring-border/60"
                  : "text-muted-foreground hover:bg-background/5 hover:text-foreground",
              )}
            >
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg shadow-sm transition-colors",
                  activePanel === "endpoint"
                    ? "bg-amber-500 text-white"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <Settings2 className="h-4 w-4" />
              </div>
              <span className="flex-1 text-left">端点配置</span>
              {activePanel === "endpoint" && (
                <div className="h-1.5 w-1.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
              )}
            </button>
            <button
              type="button"
              onClick={() => switchPanel("schedule")}
              className={cn(
                "relative flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold tracking-tight transition-all duration-300",
                activePanel === "schedule"
                  ? "bg-background text-foreground shadow-md ring-1 ring-border/60"
                  : "text-muted-foreground hover:bg-background/5 hover:text-foreground",
              )}
            >
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg shadow-sm transition-colors",
                  activePanel === "schedule"
                    ? "bg-blue-500 text-white"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <Clock3 className="h-4 w-4" />
              </div>
              <span className="flex-1 text-left">任务调度</span>
              {activePanel === "schedule" && (
                <div className="h-1.5 w-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]" />
              )}
            </button>
            <button
              type="button"
              onClick={() => switchPanel("push")}
              className={cn(
                "relative flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold tracking-tight transition-all duration-300",
                activePanel === "push"
                  ? "bg-background text-foreground shadow-md ring-1 ring-border/60"
                  : "text-muted-foreground hover:bg-background/5 hover:text-foreground",
              )}
            >
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg shadow-sm transition-colors",
                  activePanel === "push"
                    ? "bg-indigo-500 text-white"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <Bell className="h-4 w-4" />
              </div>
              <span className="flex-1 text-left">推送管理</span>
              {activePanel === "push" && (
                <div className="h-1.5 w-1.5 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.6)]" />
              )}
            </button>
            <button
              type="button"
              onClick={() => switchPanel("status")}
              className={cn(
                "relative flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold tracking-tight transition-all duration-300",
                activePanel === "status"
                  ? "bg-background text-foreground shadow-md ring-1 ring-border/60"
                  : "text-muted-foreground hover:bg-background/5 hover:text-foreground",
              )}
            >
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg shadow-sm transition-colors",
                  activePanel === "status"
                    ? "bg-emerald-500 text-white"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <Activity className="h-4 w-4" />
              </div>
              <span className="flex-1 text-left">系统状态</span>
              {activePanel === "status" && (
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
              )}
            </button>
          </nav>

          <div className="rounded-2xl border border-border/40 bg-muted/10 p-5 space-y-3">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              状态概览
            </h4>
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  自动刷新
                </span>
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    settings.autoRefreshEnabled
                      ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]"
                      : "bg-muted-foreground/30",
                  )}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  定时签到
                </span>
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    settings.dailyCheckinScheduleEnabled
                      ? "bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.4)]"
                      : "bg-muted-foreground/30",
                  )}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  启用推送任务
                </span>
                <span className="text-xs font-bold text-foreground">
                  {pushTasksPreview.filter((task) => task.enabled).length}
                </span>
              </div>
            </div>
          </div>
        </aside>

        <div className="space-y-8">
          <Card className="overflow-hidden border-border/40 shadow-xl backdrop-blur-xl">
            <div className="border-b bg-muted/30 p-6 md:p-8">
              {activePanel === "config" ? (
                <PanelHeader
                  icon="settings"
                  title="基础配置"
                  description="管理系统的核心基础参数，影响网络连通性、API 行为以及站点外观。"
                />
              ) : activePanel === "endpoint" ? (
                <PanelHeader
                  icon="settings"
                  title="端点配置"
                  description="管理端点展示策略、页面刷新自动维护与手动系统清理。"
                />
              ) : activePanel === "schedule" ? (
                <PanelHeader
                  icon="schedule"
                  title="任务调度"
                  description="集中管理自动刷新与定时任务，按预设规则由后端引擎精准触发。"
                />
              ) : activePanel === "push" ? (
                <PanelHeader
                  icon="push"
                  title="推送管理"
                  description="管理推送目标、任务绑定和消息测试，统一承接每日签到后的摘要与余额刷新通知。"
                />
              ) : (
                <PanelHeader
                  icon="status"
                  title="系统状态"
                  description="实时查看 Claude-Code-Hub 源表、Claude-Code-Hub Quota—Monitor 数据库以及 Redis 缓存的运行状态"
                />
              )}
            </div>

            <CardContent className="p-6 md:p-8 space-y-8 bg-background/30">
              {activePanel === "config" && (
                <div className="grid gap-6">
                  <div className="flex flex-col gap-4 rounded-2xl border border-border/40 bg-muted/10 p-5 shadow-sm">
                    <div className="grid md:grid-cols-[1fr,320px] gap-6 items-start">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <div className="h-4 w-1 rounded-full bg-rose-500" />
                          <label
                            htmlFor="system-display-name"
                            className="text-sm font-bold text-foreground tracking-tight"
                          >
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
                          onChange={(event) =>
                            setSystemDisplayNameDraft(event.target.value)
                          }
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
                          <label
                            htmlFor="proxy-url"
                            className="text-sm font-bold text-foreground tracking-tight"
                          >
                            全局代理地址
                          </label>
                        </div>
                        <p className="text-[11px] font-medium text-muted-foreground leading-relaxed pl-3 border-l border-border/60 ml-0.5 max-w-none">
                          支持{" "}
                          <code className="text-blue-600 font-bold bg-blue-500/10 px-1 rounded">
                            http://
                          </code>
                          ，
                          <code className="text-blue-600 font-bold bg-blue-500/10 px-1 rounded">
                            https://
                          </code>
                          ，
                          <code className="text-blue-600 font-bold bg-blue-500/10 px-1 rounded">
                            socks5://
                          </code>{" "}
                          等主流协议，留空则直连。
                        </p>
                      </div>
                      <input
                        id="proxy-url"
                        type="text"
                        placeholder="例如 http://127.0.0.1:7890"
                        value={proxyUrlDraft}
                        onChange={(event) =>
                          setProxyUrlDraft(event.target.value)
                        }
                        className="h-10 w-full rounded-xl border border-border/60 bg-background px-4 text-sm font-bold font-mono outline-none transition-all focus:border-blue-500/40 focus:ring-4 focus:ring-blue-500/10 shadow-sm"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-4 rounded-2xl border border-border/40 bg-muted/10 p-5 shadow-sm">
                    <div className="grid md:grid-cols-[1fr,320px] gap-6 items-start">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <div className="h-4 w-1 rounded-full bg-amber-500" />

                          <label
                            htmlFor="request-timeout-ms"
                            className="text-sm font-bold text-foreground tracking-tight"
                          >
                            请求超时界限
                          </label>
                        </div>

                        <p className="text-[11px] font-medium text-muted-foreground leading-relaxed pl-3 border-l border-border/60 ml-0.5 max-w-none">
                          发送查询请求时的最高容忍时间。范围 1,000–120,000
                          毫秒，默认 15,000。
                        </p>
                      </div>

                      <input
                        id="request-timeout-ms"
                        type="number"
                        min={1000}
                        max={120000}
                        step={1000}
                        value={requestTimeoutMsDraft}
                        onChange={(event) =>
                          setRequestTimeoutMsDraft(event.target.value)
                        }
                        className="h-10 w-full rounded-xl border border-border/60 bg-background px-4 text-sm font-bold font-mono outline-none transition-all focus:border-amber-500/40 focus:ring-4 focus:ring-amber-500/10 shadow-sm"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-4 rounded-2xl border border-border/40 bg-muted/10 p-5 shadow-sm">
                    <div className="grid md:grid-cols-[1fr,320px] gap-6 items-start">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <div className="h-4 w-1 rounded-full bg-violet-500" />

                          <label
                            htmlFor="concurrency"
                            className="text-sm font-bold text-foreground tracking-tight"
                          >
                            全量刷新并发数
                          </label>
                        </div>

                        <p className="text-[11px] font-medium text-muted-foreground leading-relaxed pl-3 border-l border-border/60 ml-0.5 max-w-none">
                          同时发出的探测请求数。范围 1–30，默认
                          6。网络好可调大加速。
                        </p>
                      </div>

                      <input
                        id="concurrency"
                        type="number"
                        min={1}
                        max={30}
                        step={1}
                        value={concurrencyDraft}
                        onChange={(event) =>
                          setConcurrencyDraft(event.target.value)
                        }
                        className="h-10 w-full rounded-xl border border-border/60 bg-background px-4 text-sm font-bold font-mono outline-none transition-all focus:border-violet-500/40 focus:ring-4 focus:ring-violet-500/10 shadow-sm"
                      />
                    </div>
                  </div>
                </div>
              )}

              {activePanel === "endpoint" && (
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
                          开启后，CCH
                          中已标记为禁用的端点也会显示在控制台列表中，便于统一排查。
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
                          开启后，每次刷新前端页面会自动清理 CCH
                          无对应的端点与孤立服务商，也可在右侧手动清理。
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
                          onCheckedChange={
                            setAutoCleanupAfterRefreshEnabledDraft
                          }
                          ariaLabel="页面刷新后自动执行数据维护"
                        />
                      </div>{" "}
                    </div>
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
                          {vendorOrderLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            "刷新"
                          )}
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
                              <span className="truncate text-sm font-bold text-muted-foreground">
                                未分组（固定置顶）
                              </span>
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
                                const isDraggingSelf =
                                  draggingVendorId === vendor.id;
                                const isDragTarget =
                                  dragOverVendorId === vendor.id &&
                                  !isDraggingSelf;
                                const hasBeforeGap =
                                  isDragTarget && dragOverPosition === "before";
                                const hasAfterGap =
                                  isDragTarget && dragOverPosition === "after";

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
                                      event.dataTransfer.effectAllowed = "move";
                                      event.dataTransfer.setData(
                                        "text/plain",
                                        String(vendor.id),
                                      );
                                    }}
                                    onDragEnd={resetDragState}
                                    className={cn(
                                      "group relative flex cursor-grab items-center justify-between gap-3 rounded-lg border px-3 py-2.5 shadow-sm transition-all duration-200 active:cursor-grabbing",
                                      hasBeforeGap && "mt-3",
                                      hasAfterGap && "mb-3",
                                      isDraggingSelf
                                        ? "border-dashed border-primary/50 bg-primary/5 opacity-40 scale-[0.98] z-0"
                                        : isDragTarget
                                          ? "border-border/40 bg-muted/40 z-10 scale-[1.01]"
                                          : "border-border/40 bg-background hover:border-border/80 hover:bg-muted/30 hover:shadow-md z-0",
                                    )}
                                  >
                                    {dragOverVendorId === vendor.id &&
                                      dragOverPosition === "before" && (
                                        <div className="absolute -top-[4px] left-0 right-0 z-50 h-[3px] rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.8)] pointer-events-none" />
                                      )}
                                    {dragOverVendorId === vendor.id &&
                                      dragOverPosition === "after" && (
                                        <div className="absolute -bottom-[4px] left-0 right-0 z-50 h-[3px] rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.8)] pointer-events-none" />
                                      )}
                                    <div className="relative z-0 flex min-w-0 items-center gap-3 pointer-events-none">
                                      <div className="flex items-center gap-1.5">
                                        <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground/70" />
                                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-bold text-muted-foreground">
                                          {index + 1}
                                        </span>
                                      </div>
                                      <span className="truncate text-sm font-semibold text-foreground">
                                        {vendor.name}
                                      </span>
                                    </div>
                                    <div className="relative z-0 flex shrink-0 items-center gap-2 pointer-events-none">
                                      {vendor.displayOrder === null ? (
                                        <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600">
                                          未排序
                                        </span>
                                      ) : null}
                                      <span className="rounded-md border border-border/60 bg-muted/50 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                                        {normalizeVendorTypeLabel(
                                          vendor.vendorType,
                                        )}
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
                                  event.dataTransfer.dropEffect = "move";
                                  clearDragPreview();
                                }}
                                onDrop={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  const movingId =
                                    getDraggingVendorIdFromEvent(event);
                                  if (movingId !== null) {
                                    moveVendorToEnd(movingId);
                                  }
                                  resetDragState();
                                }}
                                className={cn(
                                  "flex items-center justify-center rounded-lg border border-dashed px-3 py-2 text-[11px] font-medium text-muted-foreground transition-colors",
                                  draggingVendorId !== null
                                    ? "border-primary/40 bg-primary/5 text-primary"
                                    : "border-border/60 bg-background/30",
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

              {activePanel === "schedule" && (
                <div className="grid gap-10">
                  <div className="space-y-6">
                    <div className="flex items-center justify-between bg-muted/10 p-4 rounded-2xl border border-border/40">
                      <div className="flex items-center gap-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 shadow-sm">
                          <Plus className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-foreground">
                            定时自动刷新
                          </h3>
                          <p className="text-xs font-medium text-muted-foreground">
                            全量检测端点状态，后台强制最小间隔 30 分钟。
                          </p>
                        </div>
                      </div>
                      <ToggleSwitch
                        checked={autoRefreshEnabledDraft}
                        onCheckedChange={setAutoRefreshEnabledDraft}
                        ariaLabel="启用定时自动刷新"
                      />
                    </div>

                    <div className="grid gap-4 md:grid-cols-[200px,1fr] items-start px-2">
                      <span className="text-sm font-bold text-foreground/70 tracking-tight pt-1">
                        自动执行周期
                      </span>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-muted-foreground">
                            已设定的检测间隔
                          </span>
                          <div className="flex items-center gap-2 rounded-lg bg-emerald-500/5 px-3 py-1.5 text-[10px] font-bold text-emerald-600 border border-emerald-500/10">
                            <Clock3 className="h-3 w-3" />
                            最近执行:{" "}
                            {formatDateTime(settings.autoRefreshLastRunAt)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 bg-muted/20 p-1 rounded-xl border border-border/40 w-fit">
                          <input
                            id="auto-refresh-interval-value"
                            type="number"
                            min={1}
                            value={autoRefreshIntervalValueDraft}
                            onChange={(event) =>
                              setAutoRefreshIntervalValueDraft(
                                event.target.value,
                              )
                            }
                            className="h-9 w-20 rounded-lg border border-border/60 bg-background px-3 text-sm font-bold outline-none focus:border-primary"
                          />
                          <Select
                            value={autoRefreshIntervalUnitDraft}
                            onValueChange={(value) =>
                              setAutoRefreshIntervalUnitDraft(
                                value as IntervalUnit,
                              )
                            }
                          >
                            <SelectTrigger className="h-9 w-28 rounded-lg border-none bg-transparent shadow-none focus:ring-0">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl shadow-xl">
                              <SelectItem
                                value="minutes"
                                className="rounded-lg"
                              >
                                分钟
                              </SelectItem>
                              <SelectItem value="hours" className="rounded-lg">
                                小时
                              </SelectItem>
                              <SelectItem value="days" className="rounded-lg">
                                天 (Days)
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4 rounded-3xl border border-amber-500/15 bg-gradient-to-br from-amber-500/8 via-background to-background p-5">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4 text-amber-600" />
                            <h3 className="text-sm font-bold text-foreground">
                              服务商消耗异常告警
                            </h3>
                          </div>
                          <p className="max-w-2xl text-xs font-medium leading-6 text-muted-foreground">
                            定时自动刷新结束后，仅检测选中服务商；已用高于对应
                            CCH 成本且超过阈值时告警。
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => switchPanel("push")}
                          className="rounded-xl"
                        >
                          <Bell className="h-4 w-4" />
                          去推送管理
                        </Button>
                      </div>

                      <div className="grid gap-4 xl:grid-cols-2">
                        <div className="rounded-2xl border border-border/50 bg-background/70 p-4 shadow-sm">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="text-sm font-bold text-foreground">
                                异常告警阈值控制
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                控制异常告警任务的启停和定义阈值
                              </p>
                              {balanceRefreshAnomalyPushTask.targetIds.length >
                              0 ? (
                                <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-border/50 bg-muted/20 px-2.5 py-1 text-[11px] font-bold text-foreground/80">
                                  <Bell className="h-3 w-3 text-muted-foreground/70" />
                                  已绑定{" "}
                                  {
                                    balanceRefreshAnomalyPushTask.targetIds
                                      .length
                                  }{" "}
                                  个目标
                                </span>
                              ) : (
                                <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-dashed border-amber-500/30 bg-amber-500/5 px-2.5 py-1 text-[11px] font-bold text-amber-600">
                                  <Bell className="h-3 w-3" />
                                  未绑定目标
                                </span>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <span
                                className={cn(
                                  "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold",
                                  balanceRefreshAnomalyPushEnabledDraft
                                    ? "bg-emerald-500/10 text-emerald-600"
                                    : "bg-muted text-muted-foreground",
                                )}
                              >
                                {balanceRefreshAnomalyPushEnabledDraft
                                  ? "告警已启用"
                                  : "告警已停用"}
                              </span>
                              <ToggleSwitch
                                checked={balanceRefreshAnomalyPushEnabledDraft}
                                onCheckedChange={
                                  setBalanceRefreshAnomalyPushEnabledDraft
                                }
                                ariaLabel="启用服务商消耗异常提醒推送"
                              />
                            </div>
                          </div>
                          <div className="mt-4">
                            <div className="flex items-center gap-3 rounded-2xl border border-border/50 bg-muted/20 p-3">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-background/80 shadow-sm">
                                <Activity className="h-5 w-5 text-muted-foreground" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                                  异常判定阈值 (相对增量)
                                </p>
                                <p className="text-[10px] text-muted-foreground/70">
                                  当消耗涨幅超过此比例时触发告警
                                </p>
                              </div>
                              <div className="flex items-center gap-1 rounded-xl border border-border/40 bg-background/80 p-1.5 shadow-sm">
                                <input
                                  type="number"
                                  min={0}
                                  step="1"
                                  value={balanceRefreshAnomalyThresholdDraft}
                                  onChange={(event) =>
                                    setBalanceRefreshAnomalyThresholdDraft(
                                      event.target.value,
                                    )
                                  }
                                  className="h-7 w-14 border-0 bg-transparent px-1 text-right text-sm font-bold tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                />
                                <span className="text-xs font-bold text-muted-foreground/60 mr-1">
                                  %
                                </span>
                              </div>
                            </div>
                          </div>{" "}
                        </div>

                        <div className="rounded-2xl border border-border/50 bg-background/70 p-4 shadow-sm">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="text-sm font-bold text-foreground">
                                异常检测服务商范围
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                设置异常检测服务商，未选中则不检测。
                              </p>
                              {balanceRefreshAnomalyVendorIdsDraft.length >
                              0 ? (
                                <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-border/50 bg-muted/20 px-2.5 py-1 text-[11px] font-bold text-foreground/80">
                                  <Server className="h-3 w-3 text-muted-foreground/70" />
                                  已绑定{" "}
                                  {balanceRefreshAnomalyVendorIdsDraft.length}{" "}
                                  个服务商
                                </span>
                              ) : (
                                <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-dashed border-amber-500/30 bg-amber-500/5 px-2.5 py-1 text-[11px] font-bold text-amber-600">
                                  <Server className="h-3 w-3" />
                                  未绑定服务商
                                </span>
                              )}
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={openBalanceRefreshAnomalyDialog}
                              className="rounded-xl border-border/60 bg-background/80 shadow-sm hover:bg-background"
                            >
                              选择服务商
                            </Button>
                          </div>
                          <div className="mt-3 rounded-xl border border-border/40 bg-muted/15 p-3">
                            <SelectedVendorPreview
                              vendors={selectedAnomalyVendors}
                            />
                          </div>
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
                          <h3 className="text-sm font-bold text-foreground">
                            定时每日签到
                          </h3>
                          <p className="text-xs font-medium text-muted-foreground">
                            在指定的时间点自动触发全量服务商的一键签到功能。
                          </p>
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
                          <span className="text-xs font-medium text-muted-foreground">
                            已设定的执行时间点
                          </span>
                          <div className="flex items-center gap-2 rounded-lg bg-blue-500/5 px-3 py-1.5 text-[10px] font-bold text-blue-600 border border-blue-500/10">
                            <Clock3 className="h-3 w-3" />
                            最近执行:{" "}
                            {formatDateTime(settings.dailyCheckinLastRunAt)}
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
                              <Select
                                value={dailyCheckinHourDraft}
                                onValueChange={setDailyCheckinHourDraft}
                              >
                                <SelectTrigger className="h-9 w-[70px] border-none bg-transparent font-bold shadow-none focus:ring-0">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="rounded-xl shadow-xl">
                                  {HOUR_OPTIONS.map((hour) => (
                                    <SelectItem
                                      key={hour}
                                      value={hour}
                                      className="rounded-lg"
                                    >
                                      {hour}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <span className="text-muted-foreground font-bold -mx-1">
                                :
                              </span>
                              <Select
                                value={dailyCheckinMinuteDraft}
                                onValueChange={setDailyCheckinMinuteDraft}
                              >
                                <SelectTrigger className="h-9 w-[70px] border-none bg-transparent font-bold shadow-none focus:ring-0">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="rounded-xl shadow-xl">
                                  {MINUTE_OPTIONS.map((minute) => (
                                    <SelectItem
                                      key={minute}
                                      value={minute}
                                      className="rounded-lg"
                                    >
                                      {minute}
                                    </SelectItem>
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

                    <div className="h-px bg-border/40" />

                    <div className="space-y-4 rounded-3xl border border-indigo-500/15 bg-gradient-to-br from-indigo-500/6 via-background to-background p-5">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <Bell className="h-4 w-4 text-indigo-500" />
                            <h3 className="text-sm font-bold text-foreground">
                              签到后推送联动
                            </h3>
                          </div>
                          <p className="mt-1 text-xs font-medium text-muted-foreground">
                            仅对定时每日签到生效，完整的推送目标管理，请在“推送管理”面板中配置。
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => switchPanel("push")}
                          className="rounded-xl"
                        >
                          <Bell className="h-4 w-4" />
                          去推送管理
                        </Button>
                      </div>

                      <div className="grid gap-4 xl:grid-cols-2">
                        <div className="rounded-2xl border border-border/50 bg-background/70 p-4 shadow-sm">
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <p className="text-sm font-bold text-foreground">
                                签到成功后推送签到简报
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {summaryPushTask.targetIds.length > 0
                                  ? `已绑定 ${summaryPushTask.targetIds.length} 个目标`
                                  : "当前未绑定任何推送目标"}
                              </p>
                            </div>
                            <ToggleSwitch
                              checked={dailyCheckinSummaryPushEnabledDraft}
                              onCheckedChange={
                                setDailyCheckinSummaryPushEnabledDraft
                              }
                              ariaLabel="启用签到简报推送"
                            />
                          </div>
                          <div className="mt-3 flex min-h-7 flex-wrap items-center gap-2">
                            {pushTargets.filter((target) =>
                              summaryPushTask.targetIds.includes(target.id),
                            ).length > 0 ? (
                              pushTargets
                                .filter((target) =>
                                  summaryPushTask.targetIds.includes(target.id),
                                )
                                .map((target) => (
                                  <span
                                    key={target.id}
                                    className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-muted/20 px-2.5 py-1 text-[11px] font-bold text-foreground/80"
                                  >
                                    {getPushProviderLabel(target.providerType)}
                                    <span className="text-muted-foreground">
                                      ·
                                    </span>
                                    {target.name}
                                    {!target.isEnabled ? (
                                      <span className="ml-1 inline-flex items-center rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 ring-1 ring-rose-200/80">
                                        已禁用
                                      </span>
                                    ) : null}
                                  </span>
                                ))
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-amber-500/30 bg-amber-500/5 px-2.5 py-1 text-[11px] font-bold text-amber-600">
                                <Bell className="h-3 w-3" />
                                未绑定目标
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-border/50 bg-background/70 p-4 shadow-sm">
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <p className="text-sm font-bold text-foreground">
                                签到成功后强制刷新并推送余额
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {balanceRefreshPushTask.targetIds.length > 0
                                  ? `已绑定 ${balanceRefreshPushTask.targetIds.length} 个目标`
                                  : "当前未绑定任何推送目标"}
                              </p>
                            </div>
                            <ToggleSwitch
                              checked={
                                dailyCheckinBalanceRefreshPushEnabledDraft
                              }
                              onCheckedChange={
                                setDailyCheckinBalanceRefreshPushEnabledDraft
                              }
                              ariaLabel="启用签到后余额刷新推送"
                            />
                          </div>
                          <div className="mt-3 flex min-h-7 flex-wrap items-center gap-2">
                            {pushTargets.filter((target) =>
                              balanceRefreshPushTask.targetIds.includes(
                                target.id,
                              ),
                            ).length > 0 ? (
                              pushTargets
                                .filter((target) =>
                                  balanceRefreshPushTask.targetIds.includes(
                                    target.id,
                                  ),
                                )
                                .map((target) => (
                                  <span
                                    key={target.id}
                                    className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-muted/20 px-2.5 py-1 text-[11px] font-bold text-foreground/80"
                                  >
                                    {getPushProviderLabel(target.providerType)}
                                    <span className="text-muted-foreground">
                                      ·
                                    </span>
                                    {target.name}
                                    {!target.isEnabled ? (
                                      <span className="ml-1 inline-flex items-center rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 ring-1 ring-rose-200/80">
                                        已禁用
                                      </span>
                                    ) : null}
                                  </span>
                                ))
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-amber-500/30 bg-amber-500/5 px-2.5 py-1 text-[11px] font-bold text-amber-600">
                                <Bell className="h-3 w-3" />
                                未绑定目标
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activePanel === "push" && (
                <PushManagementPanel
                  records={pushRecords}
                  targets={pushTargets}
                  tasks={pushTasksPreview}
                  onCreateTarget={handleCreatePushTarget}
                  onUpdateTarget={handleUpdatePushTarget}
                  onDeleteTarget={handleDeletePushTarget}
                  onTestTarget={handleTestPushTarget}
                  onSaveTask={handleSavePushTask}
                  onRefreshRecords={handleRefreshPushRecords}
                />
              )}

              {balanceRefreshAnomalyDialogOpen && (
                <div
                  className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm transition-all duration-300"
                  onClick={() => setBalanceRefreshAnomalyDialogOpen(false)}
                >
                  <div
                    className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-border/40 bg-background shadow-2xl animate-in fade-in zoom-in-95 duration-200"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="flex items-center justify-between border-b border-border/40 bg-muted/20 px-6 py-5">
                      <div className="space-y-1">
                        <h3 className="text-xl font-bold tracking-tight text-foreground">
                          选择异常检测服务商
                        </h3>
                        <div className="text-xs font-medium text-muted-foreground">
                          仅检测这里选中的服务商，判断口径为“当天服务商已用增量”单向高于“当天
                          CCH 成本增量”。
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setBalanceRefreshAnomalyDialogOpen(false)
                        }
                        className="rounded-xl p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    </div>
                    <div className="flex min-h-0 flex-1 flex-col gap-5 px-6 py-6">
                      <div className="rounded-2xl border border-border/50 bg-background/70 p-3 shadow-sm">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold text-foreground">
                              服务商范围
                            </p>
                            <p className="mt-1 truncate text-xs text-muted-foreground">
                              勾选后加入异常检测范围，不勾选则完全跳过。
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                if (
                                  balanceRefreshAnomalyVendorIdsDraft.length ===
                                  vendorsForOrder.length
                                ) {
                                  setBalanceRefreshAnomalyVendorIdsDraft([]);
                                } else {
                                  setBalanceRefreshAnomalyVendorIdsDraft(
                                    vendorsForOrder.map((v) => v.id),
                                  );
                                }
                              }}
                              className="inline-flex w-[68px] items-center justify-center rounded-full border border-border/50 bg-background px-2.5 py-1 text-[11px] font-bold text-foreground/70 transition-colors hover:bg-muted"
                            >
                              {balanceRefreshAnomalyVendorIdsDraft.length ===
                              vendorsForOrder.length
                                ? "取消全选"
                                : "全选"}
                            </button>
                            <span className="inline-flex min-w-[56px] items-center justify-center rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold text-amber-700 tabular-nums">
                              已选 {balanceRefreshAnomalyVendorIdsDraft.length}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="min-h-0 flex-1 overflow-y-auto pr-2 [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-2">
                        {vendorOrderLoading ? (
                          <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-border/60 bg-muted/10 p-8 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            加载服务商列表...
                          </div>
                        ) : vendorsForOrder.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-border/60 bg-muted/10 p-8 text-sm text-muted-foreground">
                            当前没有可选服务商。
                          </div>
                        ) : (
                          <div className="grid gap-3">
                            {vendorsForOrder.map((vendor) => {
                              const checked =
                                balanceRefreshAnomalyVendorIdsDraft.includes(
                                  vendor.id,
                                );
                              return (
                                <button
                                  key={vendor.id}
                                  type="button"
                                  onClick={() =>
                                    setBalanceRefreshAnomalyVendorIdsDraft(
                                      (current) =>
                                        checked
                                          ? current.filter(
                                              (item) => item !== vendor.id,
                                            )
                                          : [...current, vendor.id],
                                    )
                                  }
                                  className={cn(
                                    "flex items-center justify-between rounded-2xl border px-4 py-3 text-left shadow-sm transition-colors",
                                    checked
                                      ? "border-amber-500/35 bg-amber-500/10"
                                      : "border-border/50 bg-background/70 hover:bg-muted/20",
                                  )}
                                >
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <p className="truncate text-sm font-bold text-foreground">
                                        {vendor.name}
                                      </p>
                                      <span className="inline-flex items-center rounded-full border border-border/50 bg-muted/20 px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
                                        {normalizeVendorTypeLabel(
                                          vendor.vendorType,
                                        )}
                                      </span>
                                    </div>
                                  </div>
                                  <span
                                    className={cn(
                                      "inline-flex h-6 min-w-6 items-center justify-center rounded-full border px-2 text-[11px] font-bold",
                                      checked
                                        ? "border-amber-500/30 bg-amber-500/10 text-amber-700"
                                        : "border-border/60 bg-background/60 text-muted-foreground",
                                    )}
                                  >
                                    {checked ? "已选" : "未选"}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-3 border-t border-border/40 bg-muted/20 px-6 py-5">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          setBalanceRefreshAnomalyVendorIdsDraft([])
                        }
                        className="rounded-xl shadow-sm"
                      >
                        清空选择
                      </Button>
                      <Button
                        type="button"
                        onClick={() =>
                          setBalanceRefreshAnomalyDialogOpen(false)
                        }
                        className="rounded-xl font-bold shadow-sm"
                      >
                        完成
                      </Button>
                    </div>{" "}
                  </div>
                </div>
              )}

              {activePanel === "status" && (
                <div className="grid gap-6">
                  <div className="flex flex-col gap-4 rounded-2xl border border-border/40 bg-muted/10 p-5 shadow-sm md:flex-row md:items-center md:justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <div className="h-4 w-1 rounded-full bg-emerald-500" />
                        <span className="text-sm font-bold text-foreground tracking-tight">
                          运行状态快照
                        </span>
                      </div>
                      <p className="text-[11px] font-medium leading-relaxed text-muted-foreground">
                        手动刷新后会重新读取 PostgreSQL、SQLite 和 Redis
                        当前状态。
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-[11px] font-bold text-muted-foreground">
                        最近采样: {formatDateTime(statusGeneratedAt)}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void loadSystemStatus(true)}
                        disabled={systemStatusLoading}
                        className="h-10 rounded-xl px-4 font-bold"
                      >
                        {systemStatusLoading ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            刷新中
                          </>
                        ) : (
                          <>
                            <RefreshCw className="mr-2 h-4 w-4" />
                            刷新状态
                          </>
                        )}
                      </Button>
                    </div>
                  </div>

                  {systemStatusError ? (
                    <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-5 text-sm text-rose-600 shadow-sm">
                      <div className="font-bold">读取系统状态失败</div>
                      <div className="mt-1 text-xs font-medium text-rose-500/90">
                        {systemStatusError}
                      </div>
                    </div>
                  ) : null}

                  {!hasAnySystemStatusData && systemStatusLoading ? (
                    <div className="flex items-center gap-3 rounded-2xl border border-border/40 bg-background/50 px-5 py-6 text-sm text-muted-foreground shadow-sm">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      正在读取系统状态...
                    </div>
                  ) : null}

                  {hasAnySystemStatusData ? (
                    <>
                      <div className="grid gap-6 xl:grid-cols-2">
                        <div className="rounded-2xl border border-border/40 bg-background/60 p-5 shadow-sm">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                                <Server className="h-4 w-4 text-blue-500" />
                                Claude Code Hub源库
                              </div>
                            </div>
                            <div className="group/tooltip relative flex shrink-0 items-center gap-2">
                              <span
                                className={cn(
                                  SYSTEM_STATUS_BADGE_BASE_CLASS,
                                  "border-blue-500/20 bg-blue-500/10 uppercase text-blue-600",
                                )}
                              >
                                PostgreSQL
                              </span>
                              <span
                                className={cn(
                                  SYSTEM_STATUS_BADGE_BASE_CLASS,
                                  "border-blue-500/20 bg-blue-500/10 text-blue-600",
                                )}
                              >
                                {hubSourceStatus
                                  ? `${formatRecordCount(hubSourceStatus.tableCount)} 张表`
                                  : "读取中"}
                              </span>
                              {hubSourceStatus ? (
                                <div className="pointer-events-none absolute right-0 top-full z-20 mt-2 w-[320px] max-w-[min(320px,calc(100vw-3rem))] rounded-2xl border border-border/40 bg-background/95 p-4 text-xs opacity-0 shadow-2xl backdrop-blur-md transition-all duration-200 group-hover/tooltip:opacity-100 group-hover/tooltip:translate-y-1">
                                  <div className="font-bold text-foreground">
                                    PostgreSQL 连接配置
                                  </div>
                                  <div className="mt-2 break-all font-mono text-muted-foreground">
                                    {hubSourceStatus.connectionDisplay}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                          <div className="mt-5 overflow-hidden rounded-xl border border-border/40">
                            <div className="grid grid-cols-[minmax(0,1fr)_120px] bg-muted/20 px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                              <span>表名</span>
                              <span className="text-right">记录数</span>
                            </div>
                            <div className="divide-y divide-border/40">
                              {!hubSourceStatus && hubSourceLoading ? (
                                <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  正在读取 PostgreSQL 源表...
                                </div>
                              ) : hubSourceStatus ? (
                                hubSourceStatus.tables.map((table) => (
                                  <div
                                    key={table.name}
                                    className="grid grid-cols-[minmax(0,1fr)_120px] items-center px-4 py-3 text-sm"
                                  >
                                    <span className="truncate font-mono text-foreground">
                                      {table.name}
                                    </span>
                                    <span className="text-right font-bold text-foreground">
                                      {formatRecordCount(table.rowCount)}
                                    </span>
                                  </div>
                                ))
                              ) : (
                                <div className="px-4 py-6 text-sm text-muted-foreground">
                                  PostgreSQL 源表暂不可用。
                                </div>
                              )}
                            </div>
                          </div>
                          {hubSourceError ? (
                            <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-xs font-medium text-rose-600">
                              PostgreSQL 错误: {hubSourceError}
                            </div>
                          ) : null}
                        </div>

                        <div className="rounded-2xl border border-border/40 bg-background/60 p-5 shadow-sm">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                                <Database className="h-4 w-4 text-amber-500" />
                                <span className="truncate whitespace-nowrap">
                                  Claude Code Hub Quota Monitor数据库
                                </span>
                              </div>
                            </div>
                            <div className="group/tooltip relative flex shrink-0 items-center gap-2">
                              <span
                                className={cn(
                                  SYSTEM_STATUS_BADGE_BASE_CLASS,
                                  "border-amber-500/20 bg-amber-500/10 uppercase text-amber-600",
                                )}
                              >
                                SQLite
                              </span>
                              <span
                                className={cn(
                                  SYSTEM_STATUS_BADGE_BASE_CLASS,
                                  "border-amber-500/20 bg-amber-500/10 text-amber-600",
                                )}
                              >
                                {monitorDatabaseStatus
                                  ? `${formatRecordCount(monitorDatabaseStatus.tableCount)} 张表`
                                  : "读取中"}
                              </span>
                              {monitorDatabaseStatus ? (
                                <div className="pointer-events-none absolute right-0 top-full z-20 mt-2 w-[320px] max-w-[min(320px,calc(100vw-3rem))] rounded-2xl border border-border/40 bg-background/95 p-4 text-xs opacity-0 shadow-2xl backdrop-blur-md transition-all duration-200 group-hover/tooltip:opacity-100 group-hover/tooltip:translate-y-1">
                                  <div className="font-bold text-foreground">
                                    SQLite 文件位置
                                  </div>
                                  <div className="mt-2 break-all font-mono text-muted-foreground">
                                    {monitorDatabaseStatus.path}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                          <div className="mt-5 overflow-hidden rounded-xl border border-border/40">
                            <div className="grid grid-cols-[minmax(0,1fr)_120px] bg-muted/20 px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                              <span>表名</span>
                              <span className="text-right">记录数</span>
                            </div>
                            <div className="divide-y divide-border/40">
                              {!monitorDatabaseStatus &&
                              monitorDatabaseLoading ? (
                                <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  正在读取 SQLite 表...
                                </div>
                              ) : monitorDatabaseStatus?.tables.length === 0 ? (
                                <div className="px-4 py-6 text-sm text-muted-foreground">
                                  当前 SQLite 中还没有业务表。
                                </div>
                              ) : monitorDatabaseStatus ? (
                                monitorDatabaseStatus.tables.map((table) => (
                                  <div
                                    key={table.name}
                                    className="grid grid-cols-[minmax(0,1fr)_120px] items-center px-4 py-3 text-sm"
                                  >
                                    <span className="truncate font-mono text-foreground">
                                      {table.name}
                                    </span>
                                    <span className="text-right font-bold text-foreground">
                                      {formatRecordCount(table.rowCount)}
                                    </span>
                                  </div>
                                ))
                              ) : (
                                <div className="px-4 py-6 text-sm text-muted-foreground">
                                  SQLite 状态暂不可用。
                                </div>
                              )}
                            </div>
                          </div>
                          {monitorDatabaseError ? (
                            <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-xs font-medium text-rose-600">
                              SQLite 错误: {monitorDatabaseError}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-border/40 bg-background/60 p-5 shadow-sm">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                              <Activity className="h-4 w-4 text-emerald-500" />
                              Redis 缓存状态
                            </div>
                          </div>
                          <div className="group/tooltip relative">
                            <span
                              className={cn(
                                SYSTEM_STATUS_BADGE_BASE_CLASS,
                                !redisStatus?.enabled
                                  ? "border border-muted-foreground/20 bg-muted/30 text-muted-foreground"
                                  : redisStatus.connected
                                    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600"
                                    : "border-rose-500/20 bg-rose-500/10 text-rose-600",
                              )}
                            >
                              {!redisStatus
                                ? "读取中"
                                : !redisStatus.enabled
                                  ? "未启用"
                                  : redisStatus.connected
                                    ? "已连接"
                                    : "连接失败"}
                            </span>
                            {redisStatus?.enabled &&
                            redisStatus.connected &&
                            redisStatus.connectionDisplay ? (
                              <div className="pointer-events-none absolute right-0 top-full z-20 mt-2 w-[320px] max-w-[min(320px,calc(100vw-3rem))] rounded-2xl border border-border/40 bg-background/95 p-4 text-xs opacity-0 shadow-2xl backdrop-blur-md transition-all duration-200 group-hover/tooltip:opacity-100 group-hover/tooltip:translate-y-1">
                                <div className="font-bold text-foreground">
                                  Redis 配置
                                </div>
                                <div className="mt-2 break-all font-mono text-muted-foreground">
                                  {redisStatus.connectionDisplay}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <div className="mt-5 grid gap-3 md:grid-cols-3">
                          <div className="rounded-xl border border-border/40 bg-muted/20 p-4">
                            <div className="text-[11px] font-medium text-muted-foreground">
                              Redis 启用状态
                            </div>
                            <div className="mt-2 text-lg font-extrabold tracking-tight text-foreground">
                              {!redisStatus && redisLoading
                                ? "读取中"
                                : redisStatus?.enabled
                                  ? "已配置"
                                  : "未配置"}
                            </div>
                          </div>
                          <div className="rounded-xl border border-border/40 bg-muted/20 p-4">
                            <div className="text-[11px] font-medium text-muted-foreground">
                              连接状态
                            </div>
                            <div className="mt-2 text-lg font-extrabold tracking-tight text-foreground">
                              {!redisStatus && redisLoading
                                ? "读取中"
                                : redisStatus?.enabled
                                  ? redisStatus.connected
                                    ? "正常"
                                    : "失败"
                                  : "未启用"}
                            </div>
                          </div>
                          <div className="rounded-xl border border-border/40 bg-muted/20 p-4">
                            <div className="text-[11px] font-medium text-muted-foreground">
                              最后更新时间
                            </div>
                            <div className="mt-2 text-sm font-bold text-foreground">
                              {formatDateTime(
                                redisStatus?.lastUpdatedAt ?? null,
                              )}
                            </div>
                          </div>
                        </div>
                        {redisLoading && !redisStatus ? (
                          <div className="mt-4 flex items-center gap-2 rounded-xl border border-border/40 bg-muted/20 px-4 py-3 text-xs font-medium text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            正在读取 Redis 状态...
                          </div>
                        ) : null}
                        {redisStatus?.errorMessage ? (
                          <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-xs font-medium text-rose-600">
                            Redis 错误: {redisStatus.errorMessage}
                          </div>
                        ) : null}
                        {redisError ? (
                          <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-xs font-medium text-rose-600">
                            Redis 读取失败: {redisError}
                          </div>
                        ) : null}
                      </div>
                    </>
                  ) : null}
                </div>
              )}
            </CardContent>

            {activePanel !== "status" && (
              <div className="flex items-center justify-end gap-3 border-t border-border/40 bg-muted/20 px-8 py-6">
                <Button
                  variant="outline"
                  disabled={saving}
                  onClick={() => {
                    setSystemDisplayNameDraft(settings.systemDisplayName);
                    setProxyUrlDraft(settings.proxyUrl ?? "");
                    setIncludeDisabledDraft(settings.includeDisabled);
                    setRequestTimeoutMsDraft(String(settings.requestTimeoutMs));
                    setConcurrencyDraft(String(settings.concurrency));
                    setAutoRefreshEnabledDraft(settings.autoRefreshEnabled);
                    setAutoCleanupAfterRefreshEnabledDraft(
                      settings.autoCleanupAfterRefreshEnabled,
                    );
                    {
                      const nextIntervalDisplay = intervalDisplayFromMinutes(
                        settings.autoRefreshIntervalMinutes,
                      );
                      setAutoRefreshIntervalValueDraft(
                        nextIntervalDisplay.value,
                      );
                      setAutoRefreshIntervalUnitDraft(nextIntervalDisplay.unit);
                    }
                    setDailyCheckinEnabledDraft(
                      settings.dailyCheckinScheduleEnabled,
                    );
                    setDailyCheckinTimesDraft(
                      settings.dailyCheckinScheduleTimes,
                    );
                    setBalanceRefreshAnomalyThresholdDraft(
                      String(settings.balanceRefreshAnomalyThresholdPercent),
                    );
                    setBalanceRefreshAnomalyVendorIdsDraft(
                      settings.balanceRefreshAnomalyVendorIds,
                    );
                    setDailyCheckinSummaryPushEnabledDraft(
                      pushTasks.find(
                        (task) => task.taskType === "daily_checkin_summary",
                      )?.enabled ?? false,
                    );
                    setDailyCheckinBalanceRefreshPushEnabledDraft(
                      pushTasks.find(
                        (task) =>
                          task.taskType === "daily_checkin_balance_refresh",
                      )?.enabled ?? false,
                    );
                    setBalanceRefreshAnomalyPushEnabledDraft(
                      pushTasks.find(
                        (task) =>
                          task.taskType ===
                          "daily_checkin_balance_refresh_anomaly",
                      )?.enabled ?? false,
                    );
                    setDailyCheckinHourDraft("09");
                    setDailyCheckinMinuteDraft("00");
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
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
