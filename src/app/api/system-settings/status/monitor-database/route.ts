import { NextResponse } from 'next/server';
import { getMonitorDatabaseStatus } from '@/lib/system-status';

export async function GET(): Promise<Response> {
  try {
    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      monitorDatabase: getMonitorDatabaseStatus(),
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
