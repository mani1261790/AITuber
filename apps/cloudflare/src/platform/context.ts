import { AsyncLocalStorage } from 'node:async_hooks';
export interface RuntimeContext { storage: DurableObjectStorage; bucket: R2Bucket; assets: Fetcher }
export const runtimeContext = new AsyncLocalStorage<RuntimeContext>();
export function runtime(): RuntimeContext { const current = runtimeContext.getStore(); if (!current) throw new Error('Durable Object storage context is unavailable'); return current; }
