import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The id of the request being handled, available anywhere down its call
 * chain. It is logged with every line and forwarded to apkh-storage and
 * apkh-search as X-Request-Id, so one request can be followed across services.
 */
export const REQUEST_ID_HEADER = 'x-request-id';

const storage = new AsyncLocalStorage<{ requestId: string }>();

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId }, fn);
}

export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/** Headers to send with calls to the other services. */
export function correlationHeaders(): Record<string, string> {
  const requestId = currentRequestId();
  return requestId ? { [REQUEST_ID_HEADER]: requestId } : {};
}
