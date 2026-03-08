import 'server-only';

import { randomUUID } from 'node:crypto';

export type CheckinAllTaskStatus = 'running' | 'completed' | 'failed';

export type CheckinAllTaskState = {
  id: string;
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  totalAwardedUsd: number;
  currentVendorName: string | null;
  status: CheckinAllTaskStatus;
  message: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

const TASK_TTL_MS = 15 * 60 * 1000;

const globalKey = Symbol.for('__checkin_all_tasks__');
type TaskMap = Map<string, CheckinAllTaskState>;

function getTaskMap(): TaskMap {
  const g = globalThis as unknown as Record<symbol, TaskMap | undefined>;
  if (!g[globalKey]) {
    g[globalKey] = new Map();
  }
  return g[globalKey]!;
}

function nowIso(): string {
  return new Date().toISOString();
}

function roundUsd(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function pruneExpiredTasks(): void {
  const tasks = getTaskMap();
  const now = Date.now();
  for (const [taskId, task] of tasks.entries()) {
    const timestamp = task.finishedAt ? Date.parse(task.finishedAt) : Date.parse(task.updatedAt);
    if (!Number.isFinite(timestamp)) continue;
    if (now - timestamp > TASK_TTL_MS) {
      tasks.delete(taskId);
    }
  }
}

export function createCheckinAllTask(total: number): CheckinAllTaskState {
  pruneExpiredTasks();
  const tasks = getTaskMap();
  const startedAt = nowIso();
  const task: CheckinAllTaskState = {
    id: randomUUID(),
    total: Number.isFinite(total) && total >= 0 ? Math.trunc(total) : 0,
    completed: 0,
    succeeded: 0,
    failed: 0,
    totalAwardedUsd: 0,
    currentVendorName: null,
    status: 'running',
    message: null,
    startedAt,
    updatedAt: startedAt,
    finishedAt: null,
  };
  tasks.set(task.id, task);
  return task;
}

export function getCheckinAllTask(taskId: string): CheckinAllTaskState | null {
  pruneExpiredTasks();
  return getTaskMap().get(taskId) ?? null;
}

export function updateCheckinAllTask(
  taskId: string,
  updater: (current: CheckinAllTaskState) => CheckinAllTaskState,
): CheckinAllTaskState | null {
  const tasks = getTaskMap();
  const current = tasks.get(taskId);
  if (!current) return null;
  const next = updater(current);
  const normalized: CheckinAllTaskState = {
    ...next,
    totalAwardedUsd: roundUsd(next.totalAwardedUsd),
    updatedAt: nowIso(),
  };
  tasks.set(taskId, normalized);
  return tasks.get(taskId) ?? null;
}

export function markCheckinAllTaskCompleted(taskId: string): CheckinAllTaskState | null {
  return updateCheckinAllTask(taskId, (current) => ({
    ...current,
    status: 'completed',
    currentVendorName: null,
    message: null,
    finishedAt: nowIso(),
  }));
}

export function markCheckinAllTaskFailed(taskId: string, message: string): CheckinAllTaskState | null {
  return updateCheckinAllTask(taskId, (current) => ({
    ...current,
    status: 'failed',
    currentVendorName: null,
    message,
    finishedAt: nowIso(),
  }));
}
