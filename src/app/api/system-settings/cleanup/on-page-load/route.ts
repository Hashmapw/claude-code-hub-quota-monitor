import { NextResponse } from 'next/server';
import { runSystemCleanupFromHub } from '@/lib/system-cleanup';
import { getSystemSettings } from '@/lib/system-settings';

export const runtime = 'nodejs';

export async function POST(): Promise<Response> {
  try {
    const settings = getSystemSettings();
    if (!settings.autoCleanupAfterRefreshEnabled) {
      return NextResponse.json({
        ok: true,
        attempted: false,
        deletedEndpoints: 0,
        deletedVendors: 0,
      });
    }

    const { deletedEndpoints, deletedVendors } = await runSystemCleanupFromHub();
    return NextResponse.json({
      ok: true,
      attempted: true,
      deletedEndpoints,
      deletedVendors,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        attempted: true,
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
