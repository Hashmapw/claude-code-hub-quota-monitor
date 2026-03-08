'use client';

import { Loader2, LogOut } from 'lucide-react';
import { useState } from 'react';
import { withBasePath } from '@/lib/client/base-path';

export function LogoutButton() {
  const [isPending, setIsPending] = useState(false);

  async function handleLogout() {
    if (isPending) {
      return;
    }

    setIsPending(true);
    try {
      await fetch(withBasePath('/api/auth/logout'), { method: 'POST' });
    } catch {
      // Ignore logout request failures and return to login page.
    } finally {
      window.location.assign(withBasePath('/login'));
    }
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={isPending}
      title="退出登录"
      aria-label="退出登录"
      className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full text-sm font-medium outline-none transition-all duration-200 hover:bg-destructive/10 hover:text-destructive focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
    >
      {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
    </button>
  );
}
