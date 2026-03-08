import { NextResponse } from 'next/server';
import { listDailyCheckinEnabledVendors } from '@/lib/daily-checkin';
import { recordDailyCheckinAttempt } from '@/lib/daily-checkin-history';
import { logInfo } from '@/lib/logger';
import {
  createCheckinAllTask,
  markCheckinAllTaskCompleted,
  markCheckinAllTaskFailed,
  updateCheckinAllTask,
} from '@/lib/quota/checkin-task';
import { runVendorDailyCheckin } from '@/lib/quota/service';
import type { QuotaDebugProbe } from '@/lib/quota/types';

export const runtime = 'nodejs';

function normalizeMessage(value: string | null | undefined): string | null {
  const text = (value || '').trim();
  return text || null;
}

function extractDailyCheckinRawResponse(probes: QuotaDebugProbe[] | null | undefined): string | null {
  if (!Array.isArray(probes) || probes.length === 0) {
    return null;
  }

  const candidate = [...probes]
    .reverse()
    .find((probe) => probe.purpose === 'daily_checkin')
    ?? [...probes].reverse().find((probe) => (probe.strategy || '').includes('daily_checkin'))
    ?? null;

  if (!candidate) {
    return null;
  }

  const preview = (candidate.preview || '').trim();
  return preview || null;
}

export async function POST(): Promise<Response> {
  try {
    const vendors = listDailyCheckinEnabledVendors();
    const task = createCheckinAllTask(vendors.length);
    logInfo('checkin.all', {
      event: 'task_created',
      trigger: 'manual',
      taskId: task.id,
      total: vendors.length,
    });

    if (vendors.length === 0) {
      const completed = markCheckinAllTaskCompleted(task.id) ?? task;
      logInfo('checkin.all', {
        event: 'done',
        trigger: 'manual',
        taskId: task.id,
        total: 0,
        success: 0,
        failed: 0,
        totalAwardedUsd: 0,
        durationMs: 0,
      });
      return NextResponse.json({ ok: true, task: completed });
    }

    void (async () => {
      const startedAt = Date.now();
      try {
        for (const vendor of vendors) {
          updateCheckinAllTask(task.id, (current) => ({
            ...current,
            currentVendorName: vendor.name,
          }));

          try {
            const output = await runVendorDailyCheckin(vendor.id);
            const message = normalizeMessage(output.result.message);
            const recorded = recordDailyCheckinAttempt({
              vendorId: vendor.id,
              vendorName: vendor.name,
              vendorType: vendor.vendorType,
              requestSucceeded: output.result.status === 'ok',
              status: output.result.status,
              message,
              endpointId: output.endpointId,
              checkinDate: output.result.checkinDate,
              source: output.result.source,
              rawResponseText: extractDailyCheckinRawResponse(output.result.debugProbes),
              awardedUsd: output.result.quotaAwarded,
            });

            updateCheckinAllTask(task.id, (current) => ({
              ...current,
              completed: Math.min(current.total, current.completed + 1),
              succeeded: current.succeeded + (recorded.effectiveStatus === 'ok' ? 1 : 0),
              failed: current.failed + (recorded.effectiveStatus === 'ok' ? 0 : 1),
              totalAwardedUsd: current.totalAwardedUsd + recorded.deltaAwardedUsd,
              currentVendorName: vendor.name,
            }));
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const recorded = recordDailyCheckinAttempt({
              vendorId: vendor.id,
              vendorName: vendor.name,
              vendorType: vendor.vendorType,
              requestSucceeded: false,
              status: 'network_error',
              message,
              awardedUsd: null,
            });

            updateCheckinAllTask(task.id, (current) => ({
              ...current,
              completed: Math.min(current.total, current.completed + 1),
              succeeded: current.succeeded + (recorded.effectiveStatus === 'ok' ? 1 : 0),
              failed: current.failed + (recorded.effectiveStatus === 'ok' ? 0 : 1),
              totalAwardedUsd: current.totalAwardedUsd + recorded.deltaAwardedUsd,
              currentVendorName: vendor.name,
            }));
          }
        }
        const completed = markCheckinAllTaskCompleted(task.id);
        if (completed) {
          logInfo('checkin.all', {
            event: 'done',
            trigger: 'manual',
            taskId: completed.id,
            total: completed.total,
            success: completed.succeeded,
            failed: completed.failed,
            totalAwardedUsd: completed.totalAwardedUsd,
            durationMs: Date.now() - startedAt,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failedTask = markCheckinAllTaskFailed(task.id, message || '一键签到执行失败');
        logInfo('checkin.all', {
          event: 'failed',
          trigger: 'manual',
          taskId: task.id,
          total: failedTask?.total ?? task.total,
          success: failedTask?.succeeded ?? task.succeeded,
          failed: failedTask?.failed ?? task.failed,
          totalAwardedUsd: failedTask?.totalAwardedUsd ?? task.totalAwardedUsd,
          durationMs: Date.now() - startedAt,
          message,
        });
      }
    })();

    return NextResponse.json({ ok: true, task });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logInfo('checkin.all', {
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
