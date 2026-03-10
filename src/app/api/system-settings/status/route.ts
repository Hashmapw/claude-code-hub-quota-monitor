import { NextResponse } from 'next/server';
import { getSystemStatusSnapshot } from '@/lib/system-status';

export async function GET(): Promise<Response> {
  try {
    const status = await getSystemStatusSnapshot();
    return NextResponse.json({
      ok: true,
      status,
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
