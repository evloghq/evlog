import { AsyncLocalStorage } from 'node:async_hooks'
import type { AuditableLogger } from '../audit'
import { getSharedStorage } from './globalRegistry'

/**
 * Create a request-scoped `AsyncLocalStorage` and matching `useLogger`
 * accessor. Every framework that exposes `useLogger()` (Express, Fastify,
 * NestJS, SvelteKit) calls this once at module level.
 *
 * Prefer `import { createLoggerStorage } from 'evlog/toolkit/storage'` on
 * Cloudflare Workers / edge so `node:async_hooks` is not pulled through the
 * main `evlog/toolkit` barrel. The barrel still re-exports this helper for
 * compatibility — remove that re-export at the next major (#403).
 *
 * @param contextHint - Appended to the error message when `useLogger()` is
 *   called outside of a request, e.g. `"middleware context. Make sure
 *   app.use(evlog()) is registered before your routes."`.
 * @param id - Stable identifier for the shared storage slot. Copies of evlog
 *   duplicated by the package manager resolve the same instance for a given
 *   `id`, so a request opened by one copy is visible to the other. Defaults to
 *   `contextHint`; third-party callers should pass a namespaced id.
 */
export function createLoggerStorage(contextHint: string, id: string = contextHint) {
  /** @internal Every registered instance is a real ALS; the registry only widens the type. */
  const storage = getSharedStorage(id, () => new AsyncLocalStorage<AuditableLogger>()) as AsyncLocalStorage<AuditableLogger>

  function useLogger<T extends object = Record<string, unknown>>(): AuditableLogger<T>
  // eslint-disable-next-line no-redeclare -- TypeScript overload implementation.
  function useLogger(): AuditableLogger {
    const logger = storage.getStore()
    if (!logger) {
      throw new Error(
        `[evlog] useLogger() was called outside of an evlog ${contextHint}`,
      )
    }
    return logger
  }

  return { storage, useLogger }
}
