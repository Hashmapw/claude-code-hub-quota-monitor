import { NextResponse } from 'next/server';

export async function GET(): Promise<Response> {
  return NextResponse.json({
    ok: true,
    service: 'claude-code-quota-monitor',
    now: new Date().toISOString(),
  });
}

