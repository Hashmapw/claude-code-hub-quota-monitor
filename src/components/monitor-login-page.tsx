'use client';

import { motion } from 'framer-motion';
import { Eye, EyeOff, Loader2, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { withBasePath } from '@/lib/client/base-path';
import { sanitizeAuthRedirectTarget } from '@/lib/monitor-auth-shared';
import { toast } from '@/lib/toast';

type MonitorLoginPageProps = {
  siteTitle: string;
  authConfigured: boolean;
};

type LoginStatus = 'idle' | 'submitting';

const floatAnimation = {
  y: [0, -20, 0],
  transition: {
    duration: 6,
    repeat: Number.POSITIVE_INFINITY,
    ease: 'easeInOut' as const,
  },
};

const floatAnimationSlow = {
  y: [0, -15, 0],
  transition: {
    duration: 8,
    repeat: Number.POSITIVE_INFINITY,
    ease: 'easeInOut' as const,
  },
};

const brandPanelVariants = {
  hidden: { opacity: 0, x: -40 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { type: 'spring' as const, stiffness: 300, damping: 30 },
  },
};

const stagger = {
  hidden: { opacity: 0, y: 20 },
  visible: (delay: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, delay, ease: 'easeOut' as const },
  }),
};

export function MonitorLoginPage({ siteTitle, authConfigured }: MonitorLoginPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasShownMissingPasswordToastRef = useRef(false);
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<LoginStatus>('idle');
  const [showPassword, setShowPassword] = useState(false);

  const from = useMemo(() => sanitizeAuthRedirectTarget(searchParams.get('from')), [searchParams]);

  function showMissingPasswordToast() {
    toast.warning(
      '管理员密码未配置',
      '请先在环境变量中设置 MONITOR_ADMIN_PASSWORD。',
      0,
    );
  }

  function showInvalidPasswordToast(message?: string) {
    toast.error('管理员密码错误', message || '请检查后重新输入管理员密码。');
  }

  function showEmptyPasswordToast() {
    toast.warning('请输入管理员密码');
  }

  function showUnsupportedSecretToast() {
    toast.warning('不支持密钥登录', '这里只支持管理员密码登录，不支持 sk- 开头的密钥。');
  }

  function showLoginFailedToast(message?: string) {
    toast.error('登录失败', message || '请稍后重试。');
  }

  function showNetworkErrorToast() {
    toast.error('网络异常', '请检查连接后重试。');
  }

  useEffect(() => {
    if (authConfigured || hasShownMissingPasswordToastRef.current) {
      return;
    }

    hasShownMissingPasswordToastRef.current = true;
    showMissingPasswordToast();
  }, [authConfigured]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authConfigured) {
      setStatus('idle');
      showMissingPasswordToast();
      return;
    }

    const normalizedPassword = password.trim();
    if (!normalizedPassword) {
      setStatus('idle');
      showEmptyPasswordToast();
      return;
    }

    if (normalizedPassword.startsWith('sk-')) {
      setStatus('idle');
      showUnsupportedSecretToast();
      return;
    }

    setStatus('submitting');

    try {
      const response = await fetch(withBasePath('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: normalizedPassword, from }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        redirectTo?: string;
      };

      if (!response.ok || !body.ok) {
        if (response.status === 503 || body.message?.includes('MONITOR_ADMIN_PASSWORD')) {
          setStatus('idle');
          showMissingPasswordToast();
          return;
        }
        if (response.status === 401) {
          setStatus('idle');
          showInvalidPasswordToast(body.message);
          return;
        }
        setStatus('idle');
        showLoginFailedToast(body.message);
        return;
      }

      const redirectTo = sanitizeAuthRedirectTarget(body.redirectTo || from);
      router.replace(withBasePath(redirectTo));
      router.refresh();
    } catch {
      setStatus('idle');
      showNetworkErrorToast();
    }
  }

  return (
    <div
      className="relative w-full overflow-x-auto overflow-y-hidden bg-gradient-to-br from-background via-background to-blue-500/8 dark:to-blue-500/16"
      style={{ minHeight: 'var(--cch-viewport-height, 100vh)' }}
    >
      {status === 'submitting' && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm transition-all duration-200">
          <Loader2 className="h-12 w-12 animate-spin text-blue-500" />
          <p className="mt-4 text-lg font-medium text-muted-foreground">正在验证登录信息...</p>
        </div>
      )}

      <div className="fixed right-4 top-4 z-50 flex items-center gap-2">
        <ThemeToggle />
      </div>

      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="login-page-bg-orbs absolute inset-0" />
        <motion.div
          animate={floatAnimation}
          className="absolute right-[5%] top-[-6rem] h-[28rem] w-[28rem] rounded-full bg-blue-500/15 blur-[120px] dark:bg-blue-500/10"
        />
        <motion.div
          animate={floatAnimationSlow}
          className="absolute bottom-[-6rem] left-[6%] h-[30rem] w-[30rem] rounded-full bg-sky-400/15 blur-[120px] dark:bg-sky-400/10"
        />
      </div>

      <div
        className="grid w-full min-w-[1100px]"
        style={{
          minHeight: 'var(--cch-viewport-height, 100vh)',
          gridTemplateColumns: '45% 55%',
        }}
      >
        <motion.aside
          variants={brandPanelVariants}
          initial="hidden"
          animate="visible"
          className="login-brand-bg relative flex h-full w-full items-center justify-center overflow-hidden"
        >
          <div className="login-brand-overlay absolute inset-0" />
          <motion.div
            animate={floatAnimationSlow}
            className="absolute left-[10%] top-[18%] h-[22rem] w-[22rem] rounded-full bg-blue-400/10 blur-[120px] dark:bg-blue-400/15"
          />

          <div className="relative z-10 flex max-w-md flex-col items-center gap-6 px-12 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-600 ring-8 ring-blue-500/5 dark:text-blue-400">
              <ShieldCheck className="h-10 w-10" />
            </div>
            <h1 className="space-y-1 text-center">
              <span className="block text-3xl font-bold tracking-tight text-foreground">Claude Code Hub</span>
              <span className="block text-4xl font-black tracking-tight text-blue-600 dark:text-blue-400">Quota Monitor</span>
            </h1>
            <p className="max-w-xs text-base leading-7 text-muted-foreground">
              统一管理服务商配额系统
            </p>
          </div>
        </motion.aside>

        <div className="relative flex h-full w-full items-center justify-center px-14">
          <div className="absolute inset-x-16 top-1/2 h-[26rem] -translate-y-1/2 rounded-full bg-blue-500/6 blur-[110px] dark:bg-blue-500/10" />
          <div className="relative w-full max-w-md space-y-4">
            <motion.div custom={0.08} variants={stagger} initial="hidden" animate="visible">
              <Card className="w-full border-border/50 bg-card/90 shadow-2xl backdrop-blur-2xl dark:border-border/30">
                <CardHeader className="flex flex-col items-center space-y-2 pb-8 pt-10 text-center">
                  <div className="space-y-2">
                    <CardTitle className="text-2xl font-bold tracking-tight">管理员登录</CardTitle>
                    <CardDescription className="text-base text-muted-foreground">
                      使用您的管理员密码访问配额管理系统
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="px-8 pb-10 pt-4">
                  <form onSubmit={handleSubmit} className="space-y-8">
                    <motion.div
                      custom={0.14}
                      variants={stagger}
                      initial="hidden"
                      animate="visible"
                      className="space-y-3 pt-3"
                    >
                      <div className="space-y-3">
                        <label className="block text-sm font-semibold text-foreground" htmlFor="monitor-admin-password">
                          系统密码
                        </label>
                        <div className="relative">
                          <div className="pointer-events-none absolute inset-y-0 left-0 flex w-10 items-center justify-center text-muted-foreground/70">
                            <LockKeyhole className="h-4 w-4" />
                          </div>
                          <input
                            id="monitor-admin-password"
                            type={showPassword ? 'text' : 'password'}
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            placeholder="请输入本系统独立管理员密码"
                            autoComplete="current-password"
                            disabled={status === 'submitting' || !authConfigured}
                            className="h-10 w-full rounded-md border border-border/70 bg-background/85 pl-10 pr-10 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((current) => !current)}
                            disabled={!authConfigured}
                            className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none"
                            aria-label={showPassword ? '隐藏密码' : '显示密码'}
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>

                    </motion.div>

                    <motion.div
                      custom={0.2}
                      variants={stagger}
                      initial="hidden"
                      animate="visible"
                      className="flex flex-col items-center space-y-4"
                    >
                      <button
                        type="submit"
                        disabled={status === 'submitting' || !authConfigured || !password.trim()}
                        className="monitor-login-submit inline-flex h-10 w-full items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold active:scale-[0.99]"
                      >
                        {status === 'submitting' ? (
                          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        ) : (
                          <ShieldCheck className="mr-2 h-5 w-5 text-white" />
                        )}
                        {status === 'submitting' ? '正在登录...' : '进入系统'}
                      </button>
                    </motion.div>
                  </form>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
