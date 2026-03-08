import 'server-only';

import { randomUUID } from 'node:crypto';

export type RefreshAllTaskStatus = 'running' | 'completed' | 'failed';

export type RefreshAllTaskState = {
  id: string;
  total: number;
  completed: number;
  withValue: number;
  failed: number;
  currentEndpointName: string | null;
  status: RefreshAllTaskStatus;
  message: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

const TASK_TTL_MS = 15 * 60 * 1000;

const globalKey = Symbol.for('__refresh_all_tasks__');
type TaskMap = Map<string, RefreshAllTaskState>;

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

export function createRefreshAllTask(total: number): RefreshAllTaskState {
  pruneExpiredTasks();
  const tasks = getTaskMap();
  const startedAt = nowIso();
  const task: RefreshAllTaskState = {
    id: randomUUID(),
    total: Number.isFinite(total) && total >= 0 ? Math.trunc(total) : 0,
    completed: 0,
    withValue: 0,
    failed: 0,
    currentEndpointName: null,
    status: 'running',
    message: null,
    startedAt,
    updatedAt: startedAt,
    finishedAt: null,
  };
  tasks.set(task.id, task);
  return task;
}

export function getRefreshAllTask(taskId: string): RefreshAllTaskState | null {
  pruneExpiredTasks();
  return getTaskMap().get(taskId) ?? null;
}

export function updateRefreshAllTask(
  taskId: string,
  updater: (current: RefreshAllTaskState) => RefreshAllTaskState,
): RefreshAllTaskState | null {
  const tasks = getTaskMap();
  const current = tasks.get(taskId);
  if (!current) return null;
  const next = updater(current);
  tasks.set(taskId, {
    ...next,
    updatedAt: nowIso(),
  });
  return tasks.get(taskId) ?? null;
}

export function markRefreshAllTaskCompleted(taskId: string): RefreshAllTaskState | null {
  return updateRefreshAllTask(taskId, (current) => ({
    ...current,
    status: 'completed',
    currentEndpointName: null,
    message: null,
    finishedAt: nowIso(),
  }));
}

export function markRefreshAllTaskFailed(taskId: string, message: string): RefreshAllTaskState | null {
  return updateRefreshAllTask(taskId, (current) => ({
    ...current,
    status: 'failed',
    currentEndpointName: null,
    message,
    finishedAt: nowIso(),
  }));
}
