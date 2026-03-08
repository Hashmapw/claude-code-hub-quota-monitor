'use client';

import { CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import { LogoutButton } from '@/components/logout-button';
import { deriveBasePathFromPathname, getBasePath } from '@/lib/client/base-path';
import { ThemeToggle } from "@/components/theme-toggle";
import { clearCookieAlerts, useCookieAlerts } from '@/lib/client/cookie-alert-store';
import { cn } from '@/lib/utils';

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

function CookieAlertIndicator() {
  const alerts = useCookieAlerts();
  const [open, setOpen] = useState(false);

  if (alerts.length === 0) return null;

  return (
    <div
      className="relative flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-orange-500/25 bg-orange-500/10 px-2.5 text-xs font-medium text-orange-700 transition-colors hover:bg-orange-500/15 dark:text-orange-300"
        aria-label="凭据失效警告"
      >
        <CircleAlert className="h-4 w-4" />
        <span>{alerts.length}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-border bg-background shadow-xl">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-xs font-semibold text-foreground">凭据失效 ({alerts.length})</span>
            <button
              type="button"
              onClick={() => { clearCookieAlerts(); setOpen(false); }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              全部清除
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {alerts.map((item) => (
              <div key={item.endpointId} className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground">
                <CircleAlert className="h-3.5 w-3.5 shrink-0 text-orange-500" />
                <span className="truncate">
                  <span className="font-medium text-foreground">#{item.endpointId}</span> {item.endpointName}
                </span>
              </div>
            ))}
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
      <CookieAlertIndicator />
      <div className="hidden h-5 w-px bg-border/60 md:block" />
      <ThemeToggle />
      <LogoutButton />
    </div>
  );
}
