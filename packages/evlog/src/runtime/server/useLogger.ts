import type { AuditableLogger } from '../../audit'
import type { FieldContext, ServerEvent } from '../../types'

/**
 * Returns the request logger attached to the given server event.
 *
 * @param event - The current server event containing the context with the logger.
 * @param service - Optional service name to override the default service.
 * @returns The request-scoped logger.
 * @throws Error if the logger is not initialized on the event context.
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
export function useLogger<T extends object = Record<string, unknown>>(event: ServerEvent, service?: string): AuditableLogger<T> {
  const log = event.context.log as AuditableLogger<T> | undefined

  if (!log) {
    throw new Error(
      '[evlog] Logger not initialized. Make sure the evlog Nitro plugin is registered. '
      + 'If using Nuxt, add "evlog" to your modules.',
    )
  }

  if (service) {
    log.set({ service } as FieldContext<T>)
  }

  return log
}
