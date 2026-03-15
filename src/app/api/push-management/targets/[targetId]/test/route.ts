import { NextResponse } from 'next/server';
import { testPushTarget } from '@/lib/push-management';
import { isManagedPushTaskType } from '@/lib/push/templates';
import type { PushTestTemplateType } from '@/lib/push/types';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{
    targetId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { targetId } = await context.params;
    const body = await request.json().catch(() => ({})) as { templateType?: unknown };
    const templateTypeRaw = typeof body.templateType === 'string' ? body.templateType.trim() : 'push_test';
    const templateType: PushTestTemplateType = isManagedPushTaskType(templateTypeRaw)
      ? templateTypeRaw
      : 'push_test';
    const { target, result } = await testPushTarget(targetId, templateType);
    return NextResponse.json({
      ok: true,
      target,
      result,
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
