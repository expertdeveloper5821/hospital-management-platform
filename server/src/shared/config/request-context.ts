import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  correlationId: string;
  userId?:       string;
  tenantId?:     string;
}

// AsyncLocalStorage propagates request-scoped data through the entire async
// call stack without threading correlationId through every method signature.
export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getCorrelationId(): string {
  return requestContext.getStore()?.correlationId ?? 'no-context';
}

export function getRequestContext(): RequestContext | undefined {
  return requestContext.getStore();
}
