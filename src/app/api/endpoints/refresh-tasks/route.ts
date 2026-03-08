import { NextResponse } from 'next/server';
import { logInfo } from '@/lib/logger';
import { listEndpoints } from '@/lib/db';
import { refreshAllEndpointsWithProgress } from '@/lib/quota/service';
import { getEndpointSettingsMap } from '@/lib/vendor-settings';
import {
  createRefreshAllTask,
  markRefreshAllTaskCompleted,
  markRefreshAllTaskFailed,
  updateRefreshAllTask,
} from '@/lib/quota/refresh-task';

export const runtime = 'nodejs';

export async function POST(): Promise<Response> {
  try {
    const providers = await listEndpoints();
    const settingsMap = getEndpointSettingsMap();
    const visibleProviders = providers.filter((provider) => !(settingsMap.get(provider.id)?.isHidden ?? false));
    const task = createRefreshAllTask(visibleProviders.length);
    logInfo('refresh.all', {
      event: 'task_created',
      trigger: 'manual',
      taskId: task.id,
      total: visibleProviders.length,
    });

    if (visibleProviders.length === 0) {
      const completed = markRefreshAllTaskCompleted(task.id) ?? task;
      logInfo('refresh.all', {
        event: 'done',
        trigger: 'manual',
        taskId: task.id,
        total: 0,
        success: 0,
        failed: 0,
        withValue: 0,
        durationMs: 0,
      });
      return NextResponse.json({ ok: true, task: completed });
    }

    void (async () => {
      const startedAt = Date.now();
      try {
        await refreshAllEndpointsWithProgress(async (event) => {
          updateRefreshAllTask(task.id, (current) => ({
            ...current,
            completed: Math.min(current.total, current.completed + 1),
            withValue: current.withValue + (event.withValue ? 1 : 0),
            failed: current.failed + (event.failed ? 1 : 0),
            currentEndpointName: event.endpointName,
          }));
        });
        const completed = markRefreshAllTaskCompleted(task.id);
        if (completed) {
          logInfo('refresh.all', {
            event: 'done',
            trigger: 'manual',
            taskId: completed.id,
            total: completed.total,
            success: completed.completed - completed.failed,
            failed: completed.failed,
            withValue: completed.withValue,
            durationMs: Date.now() - startedAt,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failedTask = markRefreshAllTaskFailed(task.id, message || '刷新任务执行失败');
        logInfo('refresh.all', {
          event: 'failed',
          trigger: 'manual',
          taskId: task.id,
          total: failedTask?.total ?? task.total,
          success: Math.max(0, (failedTask?.completed ?? task.completed) - (failedTask?.failed ?? task.failed)),
          failed: failedTask?.failed ?? task.failed,
          withValue: failedTask?.withValue ?? task.withValue,
          durationMs: Date.now() - startedAt,
          message,
        });
      }
    })();

    return NextResponse.json({ ok: true, task });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logInfo('refresh.all', {
      event: 'failed',
      trigger: 'manual',
      stage: 'task_create',
      message,
    });
    return NextResponse.json(
      {
        ok: false,
        message,
      },
      { status: 500 },
    );
  }
}
