export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'edge') return;

  const { beginShutdown } = await import('@/server/lifecycle/shutdown');

  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sig, () => {
      void beginShutdown(sig);
    });
  }
}
