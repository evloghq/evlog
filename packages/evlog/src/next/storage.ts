import { AsyncLocalStorage } from 'node:async_hooks'
import type { AuditableLogger } from '../audit'
import { getSharedStorage } from '../shared/globalRegistry'

/** @internal Every registered instance is a real ALS; the registry only widens the type. */
export const evlogStorage = getSharedStorage(
  'evlog:next',
  () => new AsyncLocalStorage<AuditableLogger>(),
) as AsyncLocalStorage<AuditableLogger>

/**
 * Get the current request-scoped logger.
 * Must be called inside a `withEvlog()` wrapper.
 *
 * @throws {Error} if called outside of `withEvlog()` context
 *
 * @example
 * ```ts
 * export const POST = withEvlog(async (request) => {
 *   const log = useLogger()
 *   log.set({ user: { id: '123' } })
 *   return Response.json({ ok: true })
 * })
 * ```
 */
export function useLogger<T extends object = Record<string, unknown>>(): AuditableLogger<T>
// eslint-disable-next-line no-redeclare -- TypeScript overload implementation.
export function useLogger(): AuditableLogger {
  const logger = evlogStorage.getStore()
  if (!logger) {
    throw new Error(
      '[evlog] useLogger() was called outside of a withEvlog() context. '
      + 'Wrap your route handler or server action with withEvlog().',
    )
  }
  return logger
}
