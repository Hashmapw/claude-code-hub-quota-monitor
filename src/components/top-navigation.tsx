'use client';

import { BellOff, CheckCheck, CircleAlert, Loader2, RotateCw } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LogoutButton } from '@/components/logout-button';
import { deriveBasePathFromPathname, getBasePath } from '@/lib/client/base-path';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn, formatDateTime } from '@/lib/utils';

type EndpointAlertType = 'credential' | 'parse_error' | 'network_error';

type EndpointAlertItem = {
  endpointId: number;
  endpointName: string;
  alertType: EndpointAlertType;
  alertLabel: string;
  severity: 'critical' | 'warning';
  title: string;
  detail: string;
  fingerprint: string;
  checkedAt: string | null;
  consecutiveNetworkErrorCount: number | null;
};

type EndpointAlertMuteRule = {
  endpointId: number;
  endpointName: string | null;
  alertType: EndpointAlertType;
  scope: 'today' | 'permanent';
  expiresAt: string | null;
};

type EndpointAlertApiResponse = {
  ok: boolean;
  message?: string;
  alerts?: EndpointAlertItem[];
  muteRules?: EndpointAlertMuteRule[];
};

type NavItem = {
  href: string;
  label: string;
};

const NAV_ITEMS: NavItem[] = [
  {
    href: '/',
    label: '控制台',
  },
  {
    href: '/daily-checkin',
    label: '一键签到',
  },
  {
    href: '/vendor-balance-history',
    label: '余额历史',
  },
  {
    href: '/vendor-definitions',
    label: '类型管理',
  },
  {
    href: '/settings',
    label: '系统设置',
  },
];

function normalizePath(path: string): string {
  if (!path) {
    return '/';
  }

  const trimmed = path.trim();
  if (!trimmed || trimmed === '/') {
    return '/';
  }

  return trimmed.replace(/\/+$/, '') || '/';
}

function withBasePathFrom(basePath: string, path: string): string {
  if (!path.startsWith('/')) {
    return path;
  }

  const normalizedBasePath = normalizePath(basePath);
  if (normalizedBasePath === '/') {
    return path;
  }

  if (path === normalizedBasePath || path.startsWith(`${normalizedBasePath}/`)) {
    return path;
  }

  return `${normalizedBasePath}${path}`;
}

function pathnameWithoutBase(pathname: string, basePath: string): string {
  const normalizedPathname = normalizePath(pathname);
  const normalizedBasePath = normalizePath(basePath);

  if (normalizedBasePath === '/') {
    return normalizedPathname;
  }

  if (normalizedPathname === normalizedBasePath) {
    return '/';
  }

  if (normalizedPathname.startsWith(`${normalizedBasePath}/`)) {
    return normalizePath(normalizedPathname.slice(normalizedBasePath.length));
  }

  return normalizedPathname;
}

function isItemActive(pathname: string, href: string, basePath: string): boolean {
  const current = pathnameWithoutBase(pathname, basePath);
  const itemPath = normalizePath(href);

  if (itemPath === '/') {
    return current === '/';
  }

  return current === itemPath || current.startsWith(`${itemPath}/`);
}

function alertBadgeClass(alert: EndpointAlertItem): string {
  if (alert.alertType === 'credential') {
    return 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300';
  }
  if (alert.alertType === 'parse_error') {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300';
  }
  return 'border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-300';
}

function EndpointAlertIndicator({ basePath }: { basePath: string }) {
  const [alerts, setAlerts] = useState<EndpointAlertItem[]>([]);
  const [muteRules, setMuteRules] = useState<EndpointAlertMuteRule[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [actionKey, setActionKey] = useState<string | null>(null);

  const loadAlerts = useCallback(
    async (options?: { showLoading?: boolean }) => {
      if (options?.showLoading) {
        setLoading(true);
      }
      try {
        const response = await fetch(withBasePathFrom(basePath, '/api/endpoint-alerts'), {
          cache: 'no-store',
        });
        const body = (await response.json()) as EndpointAlertApiResponse;
        if (!response.ok || !body.ok) {
          throw new Error(body.message || '读取端点异常失败');
        }
        setAlerts(body.alerts ?? []);
        setMuteRules(body.muteRules ?? []);
      } catch {
        if (options?.showLoading) {
          setAlerts([]);
        }
      } finally {
        if (options?.showLoading) {
          setLoading(false);
        }
      }
    },
    [basePath],
  );

  useEffect(() => {
    void loadAlerts({ showLoading: true });
  }, [loadAlerts]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      void loadAlerts();
    }, 60_000);

    return () => {
      clearInterval(timer);
    };
  }, [loadAlerts]);

  const handleAction = useCallback(
    async (
      payload:
        | {
            action: 'ack';
            endpointId: number;
            endpointName: string;
            alertType: EndpointAlertType;
            fingerprint: string;
          }
        | {
            action: 'mute';
            endpointId: number;
            endpointName: string;
            alertType: EndpointAlertType;
            scope: 'today' | 'permanent';
          },
    ) => {
      const currentActionKey = `${payload.action}:${payload.endpointId}:${payload.alertType}:${'scope' in payload ? payload.scope : payload.fingerprint}`;
      setActionKey(currentActionKey);
      try {
        const response = await fetch(withBasePathFrom(basePath, '/api/endpoint-alerts'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        const body = (await response.json()) as EndpointAlertApiResponse;
        if (!response.ok || !body.ok) {
          throw new Error(body.message || '更新端点异常状态失败');
        }
        setAlerts(body.alerts ?? []);
        setMuteRules(body.muteRules ?? []);
      } catch {
        // Keep current list and allow next polling cycle to recover.
      } finally {
        setActionKey(null);
      }
    },
    [basePath],
  );

  if (alerts.length === 0 && !loading) return null;

  return (
    <div
      className="relative flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-orange-500/25 bg-orange-500/10 px-2.5 text-xs font-medium text-orange-700 transition-colors hover:bg-orange-500/15 dark:text-orange-300"
        aria-label="端点异常提醒"
      >
        {loading && alerts.length === 0 ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <CircleAlert className="h-4 w-4" />
        )}
        <span>{alerts.length}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[26rem] rounded-xl border border-border bg-background shadow-xl">
          <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
            <div>
              <div className="text-xs font-semibold text-foreground">端点异常 ({alerts.length})</div>
              <div className="text-[11px] text-muted-foreground">
                已静音 {muteRules.length} 条，可在系统设置里取消静音
              </div>
            </div>
            <button
              type="button"
              onClick={() => void loadAlerts({ showLoading: true })}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <RotateCw className={cn('h-3.5 w-3.5', loading ? 'animate-spin' : '')} />
              刷新
            </button>
          </div>
          <div className="max-h-[28rem] space-y-2 overflow-y-auto p-3">
            {alerts.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
                当前没有需要处理的端点异常
              </div>
            ) : (
              alerts.map((alert) => {
                const ackKey = `ack:${alert.endpointId}:${alert.alertType}:${alert.fingerprint}`;
                const muteTodayKey = `mute:${alert.endpointId}:${alert.alertType}:today`;
                const mutePermanentKey = `mute:${alert.endpointId}:${alert.alertType}:permanent`;
                return (
                  <div
                    key={`${alert.endpointId}:${alert.alertType}:${alert.fingerprint}`}
                    className="rounded-xl border border-border/60 bg-muted/10 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold', alertBadgeClass(alert))}>
                            {alert.alertLabel}
                          </span>
                          <span className="text-xs font-semibold text-foreground">
                            #{alert.endpointId} {alert.endpointName}
                          </span>
                        </div>
                        <div className="text-sm font-bold text-foreground">{alert.title}</div>
                        <div className="text-xs leading-5 text-muted-foreground">{alert.detail}</div>
                        <div className="text-[11px] text-muted-foreground">
                          最近检测：{formatDateTime(alert.checkedAt)}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={actionKey === ackKey}
                        onClick={() =>
                          void handleAction({
                            action: 'ack',
                            endpointId: alert.endpointId,
                            endpointName: alert.endpointName,
                            alertType: alert.alertType,
                            fingerprint: alert.fingerprint,
                          })
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {actionKey === ackKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
                        确认本次
                      </button>
                      <button
                        type="button"
                        disabled={actionKey === muteTodayKey}
                        onClick={() =>
                          void handleAction({
                            action: 'mute',
                            endpointId: alert.endpointId,
                            endpointName: alert.endpointName,
                            alertType: alert.alertType,
                            scope: 'today',
                          })
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {actionKey === muteTodayKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BellOff className="h-3.5 w-3.5" />}
                        今日静音
                      </button>
                      <button
                        type="button"
                        disabled={actionKey === mutePermanentKey}
                        onClick={() =>
                          void handleAction({
                            action: 'mute',
                            endpointId: alert.endpointId,
                            endpointName: alert.endpointName,
                            alertType: alert.alertType,
                            scope: 'permanent',
                          })
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {actionKey === mutePermanentKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BellOff className="h-3.5 w-3.5" />}
                        永久静音
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function TopNavigation() {
  const pathname = usePathname() || '/';
  const basePath = useMemo(
    () => deriveBasePathFromPathname(pathname) || getBasePath(),
    [pathname],
  );

  return (
    <div className="flex items-center gap-3">
      <nav className="hidden items-center gap-1.5 rounded-2xl border border-border/60 bg-background/50 p-1.5 backdrop-blur-md shadow-sm md:flex">
        {NAV_ITEMS.map((item) => {
          const active = isItemActive(pathname, item.href, basePath);
          return (
            <Link
              key={item.href}
              href={withBasePathFrom(basePath, item.href)}
              className={cn(
                'relative whitespace-nowrap rounded-xl px-4 py-2 text-sm font-bold tracking-tight transition-all duration-300',
                active
                  ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20 scale-[1.02]'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {item.label}
              {active && (
                <div className="absolute -bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-primary-foreground/40" />
              )}
            </Link>
          );
        })}
      </nav>
      <EndpointAlertIndicator basePath={basePath} />
      <div className="hidden h-5 w-px bg-border/60 md:block" />
      <ThemeToggle />
      <LogoutButton />
    </div>
  );
}
