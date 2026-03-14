import { NextResponse } from 'next/server';
import { getPushManagementState } from '@/lib/push-management';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  try {
    return NextResponse.json({
      ok: true,
      ...getPushManagementState(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
