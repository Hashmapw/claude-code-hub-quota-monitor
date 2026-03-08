import { NextResponse } from 'next/server';
import { runSystemCleanupFromHub } from '@/lib/system-cleanup';

export const runtime = 'nodejs';

export async function POST(): Promise<Response> {
  try {
    const { deletedEndpoints, deletedVendors } = await runSystemCleanupFromHub();

    return NextResponse.json({
      ok: true,
      deletedEndpoints,
      deletedVendors,
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
