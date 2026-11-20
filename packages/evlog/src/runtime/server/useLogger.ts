import type { NitroRequestLogger } from '../../nitro'
import { resolveNitroRequestLogger } from '../../shared/globalRegistry'
import type { FieldContext, ServerEvent } from '../../types'

/**
 * Returns the request logger of the current Nitro or Nuxt request.
 *
 * Without `event`, it reads the request from Nitro's async context, which needs
 * `experimental: { asyncContext: true }` in the Nitro config (`nitro.experimental`
 * in `nuxt.config.ts`) and runs on Node and runtimes with `AsyncLocalStorage`.
 * Passing `event` works everywhere.
 *
 * @param service - Optional service name to override the default service.
 * @throws Error if no logger is attached to the request, or if `event` is omitted
 *   and Nitro's async context holds no request.
 *
 * @example
 * export default defineEventHandler((event) => {
 *   const log = useLogger(event)
 *   log.set({ foo: 'bar' })
 *   // ...
 * })
 *
 * @example
 * // Override service name for specific routes
 * export default defineEventHandler((event) => {
 *   const log = useLogger(event, 'payment-service')
 *   log.set({ foo: 'bar' })
 *   // ...
 * })
 *
 * @example
 * // Typed fields — must use explicit import for type checking to work
 * import { useLogger } from 'evlog'
 *
 * interface MyFields { user: { id: string; plan: string } }
 * const log = useLogger<MyFields>(event)
 * log.set({ user: { id: '123', plan: 'pro' } }) // OK
 * log.set({ foo: 'bar' })                        // TS error
 */
export function useLogger<T extends object = Record<string, unknown>>(event?: ServerEvent, service?: string): NitroRequestLogger<T> {
  const log = (event ? event.context.log : resolveNitroRequestLogger()) as NitroRequestLogger<T> | undefined

  if (!log) {
    throw new Error(event
      ? '[evlog] Logger not initialized. Make sure the evlog Nitro plugin is registered. '
      + 'If using Nuxt, add "evlog" to your modules.'
      : '[evlog] useLogger() without an event needs Nitro\'s request context: set `experimental: { asyncContext: true }` '
      + 'in nitro.config.ts (`nitro.experimental` in nuxt.config.ts), or pass the event: useLogger(event).')
  }

  if (service) {
    log.set({ service } as FieldContext<T>)
  }

  return log
}
