import { NextResponse } from 'next/server';
import { deletePushTarget, updatePushTarget } from '@/lib/push-management';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{
    targetId: string;
  }>;
};

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { targetId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const result = updatePushTarget(targetId, body);
    return NextResponse.json({
      ok: true,
      target: result.target,
      tasks: result.tasks,
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

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { targetId } = await context.params;
    deletePushTarget(targetId);
    return NextResponse.json({
      ok: true,
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
