import { NextResponse } from 'next/server';
import { getHubSourceConnectionStatus } from '@/lib/system-status';

export async function GET(): Promise<Response> {
  try {
    const hubSource = await getHubSourceConnectionStatus();
    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      hubSource,
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
