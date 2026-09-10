import { getSharedStorage } from './globalRegistry'

/**
 * Structural stand-in for `AsyncLocalStorage` so this module does not import
 * `node:async_hooks`. Callers that construct storage (Elysia, eve) keep their
 * own value imports.
 */
export interface AsyncLocalStorageLike<T> {
  enterWith: (store: T) => void
  getStore: () => T | undefined
  run: <TReturn>(
    store: T,
    callback: (...args: unknown[]) => TReturn,
    ...args: unknown[]
  ) => TReturn
}

/**
 * Whether this runtime provides a working native `AsyncLocalStorage.enterWith()`.
 *
 * Cloudflare Workers expose `enterWith` on the prototype but throw when it is
 * called, so a `typeof` check alone is not enough. Probe inside a temporary
 * scope so importing an integration preserves the caller's async context.
 */
export function supportsAsyncLocalStorageEnterWith<T>(
  storage: AsyncLocalStorageLike<T>,
): boolean {
  if (typeof storage.enterWith !== 'function') return false
  try {
    const probe = storage as AsyncLocalStorageLike<unknown>
    // A distinct store forces a new scope; run(undefined) can reuse the caller's.
    probe.run({}, () => probe.enterWith(undefined))
    return true
  } catch {
    return false
  }
}

/**
 * Bind `value` to `storage` for the current async execution context.
 * Uses native `enterWith()` when available; otherwise relies on
 * {@link patchAsyncLocalStorageEnterWith}.
 */
export function bindAsyncLocalStorage<T>(
  storage: AsyncLocalStorageLike<T>,
  value: T,
): void {
  storage.enterWith(value)
}

/** Clear a value previously bound with {@link bindAsyncLocalStorage}. */
export function clearAsyncLocalStorage<T>(storage: AsyncLocalStorageLike<T>): void {
  storage.enterWith(undefined as unknown as T)
}

/**
 * Registry-shared storage for integrations that bind with `enterWith()` rather
 * than `run()` (Elysia, eve). The `enterWith` polyfill is applied once, by
 * whichever copy of evlog wins the race to register `id`.
 *
 * @param create - Passed in so this module stays free of `node:async_hooks`.
 */
export function createSharedEnterWithStorage<T>(
  id: string,
  create: () => AsyncLocalStorageLike<T>,
): AsyncLocalStorageLike<T> {
  return getSharedStorage(id, () => {
    const storage = create()
    patchAsyncLocalStorageEnterWith(storage)
    return storage
  })
}

/**
 * Polyfill `enterWith()` on a single `AsyncLocalStorage` instance.
 *
 * Elysia's lifecycle is split across hooks (`onRequest` → handler → `onAfterResponse`).
 * Unlike Express or Fastify, there is no single `next()` boundary to wrap in
 * `storage.run()`, so the integration binds the logger with `enterWith()`.
 *
 * The polyfill stores the value on the ALS instance when no native `run()` frame
 * is active. That matches single-request `wrangler dev` flows and async work
 * spawned from a handler, but it does **not** replicate native per-async-context
 * isolation when multiple requests interleave in the same isolate. Prefer `{ log }`
 * from derive for concurrent Workers handlers.
 */
export function patchAsyncLocalStorageEnterWith<T>(
  storage: AsyncLocalStorageLike<T>,
): void {
  if (supportsAsyncLocalStorageEnterWith(storage)) return

  let fallbackStore: T | undefined
  let runDepth = 0
  const originalGetStore = storage.getStore.bind(storage)
  const originalRun = storage.run.bind(storage)

  Object.defineProperty(storage, 'enterWith', {
    configurable: true,
    writable: true,
    value(store: T): void {
      fallbackStore = store
    },
  })

  Object.defineProperty(storage, 'run', {
    configurable: true,
    writable: true,
    value<TReturn>(
      store: T,
      callback: (...args: unknown[]) => TReturn,
      ...args: unknown[]
    ): TReturn {
      runDepth++
      try {
        return originalRun(store, callback, ...args)
      } finally {
        runDepth--
      }
    },
  })

  Object.defineProperty(storage, 'getStore', {
    configurable: true,
    writable: true,
    value(): T | undefined {
      if (runDepth > 0) return originalGetStore()
      const active = originalGetStore()
      return active !== undefined ? active : fallbackStore
    },
  })
}
