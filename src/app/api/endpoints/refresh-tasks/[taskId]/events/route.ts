import { getRefreshAllTask } from '@/lib/quota/refresh-task';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ taskId: string }> };

function toSseData(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { taskId } = await context.params;
  const normalizedTaskId = (taskId || '').trim();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let timer: NodeJS.Timeout | null = null;
      let keepAliveTimer: NodeJS.Timeout | null = null;
      let lastUpdatedAt = '';

      const cleanup = () => {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
        if (keepAliveTimer) {
          clearInterval(keepAliveTimer);
          keepAliveTimer = null;
        }
      };

      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
          cleanup();
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          // noop
        }
      };

      const sendTask = () => {
        const task = getRefreshAllTask(normalizedTaskId);
        if (!task) {
          safeEnqueue(toSseData({ ok: false, message: '刷新任务不存在或已过期' }));
          close();
          return;
        }
        safeEnqueue(toSseData({ ok: true, task }));
        lastUpdatedAt = task.updatedAt;
        if (task.status !== 'running') {
          close();
        }
      };

      sendTask();
      if (closed) return;

      timer = setInterval(() => {
        const task = getRefreshAllTask(normalizedTaskId);
        if (!task) {
          safeEnqueue(toSseData({ ok: false, message: '刷新任务不存在或已过期' }));
          close();
          return;
        }
        if (task.updatedAt !== lastUpdatedAt || task.status !== 'running') {
          safeEnqueue(toSseData({ ok: true, task }));
          lastUpdatedAt = task.updatedAt;
        }
        if (task.status !== 'running') {
          close();
        }
      }, 300);

      keepAliveTimer = setInterval(() => {
        safeEnqueue(': keep-alive\n\n');
      }, 10000);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
