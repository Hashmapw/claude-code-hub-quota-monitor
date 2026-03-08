import type { Metadata } from 'next';
import { Activity } from 'lucide-react';
import type { ReactNode } from 'react';
import { AuthResponseInterceptor } from '@/components/auth-response-interceptor';
import { TopNavigation } from '@/components/top-navigation';
import { ensureSystemSchedulerStarted } from '@/lib/system-scheduler';
import { DEFAULT_SYSTEM_DISPLAY_NAME } from '@/lib/app-identity';
import { getMonitorSession } from '@/lib/monitor-auth';
import { getSystemSettings } from '@/lib/system-settings';
import { Toaster } from '@/components/ui/toaster';
import { ThemeProvider } from '@/components/theme-provider';
import './globals.css';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const settings = getSystemSettings();
  return {
    title: settings.systemDisplayName || DEFAULT_SYSTEM_DISPLAY_NAME,
    description: '从共享数据库读取中转站并监控剩余额度。',
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  ensureSystemSchedulerStarted();
  const settings = getSystemSettings();
  const systemDisplayName = settings.systemDisplayName || DEFAULT_SYSTEM_DISPLAY_NAME;
  const session = await getMonitorSession();
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {session ? (
            <>
              <AuthResponseInterceptor />
              <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
                <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 md:px-6">
                  <div className="flex min-w-0 items-center gap-4">
                    <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-primary/20 bg-primary/10 shadow-sm transition-transform hover:scale-105 active:scale-95">
                      <Activity className="relative z-10 h-5 w-5 text-primary" />
                      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent opacity-50" />
                    </div>
                    <div className="min-w-0 space-y-0.5">
                      <div className="truncate text-lg font-black tracking-tighter text-foreground md:text-xl uppercase italic">
                        {systemDisplayName}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">System Online</span>
                      </div>
                    </div>
                  </div>
                  <TopNavigation />
                </div>
              </header>
            </>
          ) : null}
          <main>{children}</main>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
