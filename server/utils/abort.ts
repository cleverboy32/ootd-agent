export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  }
}

/** 任一 signal abort 则合并 abort。不依赖 AbortSignal.any（部分 TS lib 未声明）。 */
export function mergeAbortSignals(
  ...signals: Array<AbortSignal | undefined>
): AbortSignal | undefined {
  const active = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];

  const controller = new AbortController();
  const onAbort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) {
      controller.abort(signal.reason);
    }
  };
  for (const signal of active) {
    if (signal.aborted) {
      onAbort(signal);
      return controller.signal;
    }
    signal.addEventListener('abort', () => onAbort(signal), { once: true });
  }
  return controller.signal;
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  return false;
}

export function createShutdownAbortError(signal: NodeJS.Signals): DOMException {
  return new DOMException(`Server shutting down (${signal})`, 'AbortError');
}
