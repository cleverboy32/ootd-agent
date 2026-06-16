function is429Error(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const err = error as Record<string, unknown>;
  const nested = err.error as Record<string, unknown> | undefined;
  const status = err.status ?? err.code ?? nested?.code;
  const message = String(err.message ?? '');

  return (
    status === 429 ||
    message.includes('429') ||
    message.includes('RESOURCE_EXHAUSTED') ||
    message.includes('Resource exhausted')
  );
}

export async function withRetryOn429<T>(
  fn: () => Promise<T>,
  options?: { maxRetries?: number; label?: string }
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 2;
  const label = options?.label ?? 'API call';

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!is429Error(error) || attempt === maxRetries) throw error;

      const delayMs = 1000 * 2 ** attempt;
      console.warn(
        `[RETRY_429] ${label} hit 429, retrying in ${delayMs}ms (${attempt + 1}/${maxRetries})`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(`${label}: unreachable`);
}
