import 'server-only';

import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';
import {
  MONITOR_AUTH_COOKIE_NAME,
  MONITOR_AUTH_MAX_AGE_SECONDS,
  createMonitorSessionToken,
  parseMonitorSessionToken,
  type MonitorSession,
} from '@/lib/monitor-auth-shared';

function shouldUseSecureCookie(): boolean {
  return process.env.NODE_ENV === 'production';
}

export async function getMonitorSession(): Promise<MonitorSession | null> {
  const cookieStore = await cookies();
  return parseMonitorSessionToken(cookieStore.get(MONITOR_AUTH_COOKIE_NAME)?.value);
}

export function setMonitorSessionCookie(response: NextResponse): NextResponse {
  const token = createMonitorSessionToken();
  if (!token) {
    throw new Error('MONITOR_ADMIN_PASSWORD 未配置，无法创建管理员会话。');
  }

  response.cookies.set({
    name: MONITOR_AUTH_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookie(),
    path: '/',
    maxAge: MONITOR_AUTH_MAX_AGE_SECONDS,
  });

  return response;
}

export function clearMonitorSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set({
    name: MONITOR_AUTH_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookie(),
    path: '/',
    expires: new Date(0),
  });

  return response;
}
