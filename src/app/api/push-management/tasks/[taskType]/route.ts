import { NextResponse } from 'next/server';
import { updatePushTask } from '@/lib/push-management';
import { isManagedPushTaskType } from '@/lib/push/templates';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{
    taskType: string;
  }>;
};

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { taskType } = await context.params;
    if (!isManagedPushTaskType(taskType)) {
      return NextResponse.json(
        {
          ok: false,
          message: '未知的推送任务类型',
        },
        { status: 404 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const task = updatePushTask(taskType, body);
    return NextResponse.json({
      ok: true,
      task,
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
