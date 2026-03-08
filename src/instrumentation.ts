export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }

  const { ensureSystemSchedulerStarted } = await import('@/lib/system-scheduler');
  ensureSystemSchedulerStarted();
}
