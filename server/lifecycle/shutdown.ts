import { createShutdownAbortError } from '@/server/utils/abort';

const SHUTDOWN_ABORT_TIMEOUT_MS = Number(process.env.SHUTDOWN_ABORT_TIMEOUT_MS ?? 12000);

interface InFlightEntry {
  abortController: AbortController;
  done: Promise<void>;
}

let shuttingDown = false;
let shutdownStarted = false;

const inFlight = new Map<string, InFlightEntry>();

export function isShuttingDown(): boolean {
  return shuttingDown;
}

export function registerInFlight(
  id: string,
  abortController: AbortController,
  done: Promise<void>
): void {
  inFlight.set(id, { abortController, done });
}

export function unregisterInFlight(id: string): void {
  inFlight.delete(id);
}

export function getInFlightCount(): number {
  return inFlight.size;
}

export async function beginShutdown(signal: NodeJS.Signals): Promise<void> {
  if (shutdownStarted) {
    console.warn('[SHUTDOWN] duplicate signal, forcing exit');
    process.exit(1);
    return;
  }
  shutdownStarted = true;
  shuttingDown = true;

  const count = inFlight.size;
  console.log(`[SHUTDOWN] ${signal} received, aborting ${count} in-flight request(s)...`);

  for (const entry of inFlight.values()) {
    if (!entry.abortController.signal.aborted) {
      entry.abortController.abort(createShutdownAbortError(signal));
    }
  }

  const waitForDone = Promise.allSettled([...inFlight.values()].map((entry) => entry.done));
  const timeout = new Promise<void>((resolve) => {
    setTimeout(resolve, SHUTDOWN_ABORT_TIMEOUT_MS);
  });
  await Promise.race([waitForDone, timeout]);

  if (inFlight.size > 0) {
    console.warn(
      `[SHUTDOWN] ${inFlight.size} request(s) still in-flight after ${SHUTDOWN_ABORT_TIMEOUT_MS}ms timeout`
    );
  }

  try {
    const { default: prismadb } = await import('@/server/db');
    await prismadb.$disconnect();
  } catch (error) {
    console.warn('[SHUTDOWN] prisma disconnect failed:', error);
  }

  console.log('[SHUTDOWN] exit 0');
  process.exit(0);
}

export function registerShutdownSignals(): void {
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sig, () => {
      void beginShutdown(sig);
    });
  }
}
