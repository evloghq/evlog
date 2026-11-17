import type { HTTPEvent } from 'nitro/h3'
import type { NitroRequestLogger } from '../nitro'
import { resolveNitroRequestLogger } from '../shared/globalRegistry'
import type { FieldContext } from '../types'

/**
 * Returns the request logger of the current Nitro v3 request.
 *
 * Without `event`, it reads the request from Nitro's async context, which needs
 * `experimental: { asyncContext: true }` in `nitro.config.ts` and runs on Node and
 * runtimes with `AsyncLocalStorage`. Passing `event` works everywhere.
 *
 * @param service - Optional service name to override the default service.
 * @throws Error if no logger is attached to the request, or if `event` is omitted
 *   and Nitro's async context holds no request.
 *
 * @example
 * import { useLogger } from 'evlog/nitro'
 *
 * export default defineHandler((event) => {
 *   const log = useLogger(event)
 *   log.set({ foo: 'bar' })
 * })
 */
export function useLogger<T extends object = Record<string, unknown>>(event?: HTTPEvent, service?: string): NitroRequestLogger<T> {
  const log = (event ? event.req.context?.log : resolveNitroRequestLogger()) as NitroRequestLogger<T> | undefined

  if (!log) {
    throw new Error(event
      ? '[evlog] Logger not initialized. Make sure the evlog Nitro module is registered in nitro.config.ts. '
      + 'Example: modules: [evlog({ env: { service: \'my-app\' } })]'
      : '[evlog] useLogger() without an event needs Nitro\'s request context: set `experimental: { asyncContext: true }` '
      + 'in nitro.config.ts, or pass the event: useLogger(event).')
  }

  if (service) {
    log.set({ service } as FieldContext<T>)
  }

  return log
}
