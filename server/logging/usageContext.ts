import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestTrace } from './request';

const requestTraceStorage = new AsyncLocalStorage<RequestTrace>();

/** 让这一轮里的模型调用把用量记到同一次请求上。 */
export function runWithRequestTrace<T>(trace: RequestTrace, fn: () => Promise<T>): Promise<T> {
  return requestTraceStorage.run(trace, fn);
}

export function currentRequestTrace(): RequestTrace | undefined {
  return requestTraceStorage.getStore();
}
