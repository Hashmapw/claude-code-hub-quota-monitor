import { NextResponse } from 'next/server';
import { createPushTarget } from '@/lib/push-management';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({}));
    const target = createPushTarget(body);
    return NextResponse.json({
      ok: true,
      target,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }
}
