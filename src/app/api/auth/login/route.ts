import { NextResponse } from 'next/server';
import { setMonitorSessionCookie } from '@/lib/monitor-auth';
import {
  isMonitorAdminPasswordValid,
  isMonitorAuthConfigured,
  sanitizeAuthRedirectTarget,
} from '@/lib/monitor-auth-shared';

type LoginPayload = {
  password?: string;
  from?: string;
};

function withNoStoreHeaders(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  response.headers.set('Pragma', 'no-cache');
  return response;
}

export async function POST(request: Request): Promise<Response> {
  if (!isMonitorAuthConfigured()) {
    return withNoStoreHeaders(
      NextResponse.json(
        { ok: false, message: '管理员密码未配置，请先设置 MONITOR_ADMIN_PASSWORD。' },
        { status: 503 },
      ),
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as LoginPayload;
    const password = (body.password || '').trim();
    const redirectTo = sanitizeAuthRedirectTarget(body.from);

    if (!password) {
      return withNoStoreHeaders(
        NextResponse.json({ ok: false, message: '请输入管理员密码。' }, { status: 400 }),
      );
    }

    if (password.startsWith('sk-')) {
      return withNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: '本系统仅支持管理员密码登录，不支持使用 sk- 开头的密钥。' },
          { status: 400 },
        ),
      );
    }

    if (!isMonitorAdminPasswordValid(password)) {
      return withNoStoreHeaders(
        NextResponse.json({ ok: false, message: '管理员密码错误。' }, { status: 401 }),
      );
    }

    const response = NextResponse.json({ ok: true, redirectTo });
    return withNoStoreHeaders(setMonitorSessionCookie(response));
  } catch (error) {
    return withNoStoreHeaders(
      NextResponse.json(
        { ok: false, message: error instanceof Error ? error.message : String(error) },
        { status: 500 },
      ),
    );
  }
}
