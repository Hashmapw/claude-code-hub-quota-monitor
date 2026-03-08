import { NextResponse } from 'next/server';
import { clearMonitorSessionCookie } from '@/lib/monitor-auth';

function withNoStoreHeaders(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  response.headers.set('Pragma', 'no-cache');
  return response;
}

export async function POST(): Promise<Response> {
  const response = NextResponse.json({ ok: true });
  return withNoStoreHeaders(clearMonitorSessionCookie(response));
}
