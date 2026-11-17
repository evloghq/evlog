/**
 * Next.js helper that wires the local stream server into the standard
 * `instrumentation.ts` pattern. Strict opt-in: nothing starts unless
 * `stream: true` (or a config object) is passed explicitly.
 *
 * @example
 * ```ts
 * // lib/evlog.ts
 * import { defineStreamedInstrumentation } from 'evlog/next/stream'
 *
 * export const { register, onRequestError } = defineStreamedInstrumentation({
 *   service: 'my-app',
 *   stream: true,            // opt in to the local SSE stream server
 * })
 * ```
 *
 * ```ts
 * // instrumentation.ts
 * import { defineNodeInstrumentation } from 'evlog/next/instrumentation'
 *
 * export const { register, onRequestError } = defineNodeInstrumentation(() =>
 *   import('./lib/evlog')
 * )
 * ```
 *
 * When enabled, the mini server boots on first `register()` call and prints
 * `[evlog] Stream → http://127.0.0.1:<port>`. Without `stream`, this is a
 * straight pass-through to `createInstrumentation()`.
 */

import { startStreamServer, type StreamServerOptions } from '../stream'
import type { DrainContext } from '../types'
import { createInstrumentation, type InstrumentationOptions } from './instrumentation-create'

export interface StreamedInstrumentationOptions extends InstrumentationOptions {
  /**
   * Live stream server.
   *
   * Strict opt-in — nothing starts unless this is set explicitly.
   *
   * - `true` — enable with defaults
   * - `false` — off (same as omitting)
   * - `StreamServerOptions` — full config (port, host, token, ...)
   * - `undefined` (default) — off
   */
  stream?: boolean | StreamServerOptions
}

interface InstrumentationResult {
  register: () => Promise<void>
  onRequestError: ReturnType<typeof createInstrumentation>['onRequestError']
}

/**
 * Drop-in replacement for `createInstrumentation` that adds the local
 * stream server lifecycle.
 */
export function defineStreamedInstrumentation(options: StreamedInstrumentationOptions = {}): InstrumentationResult {
  const { stream: streamOpt, drain: userDrain, ...rest } = options

  const start: boolean = Boolean(streamOpt)
  let serverDrain: ((ctx: DrainContext) => void | Promise<void>) | null = null

  async function register(): Promise<void> {
    if (start) {
      const cfg: StreamServerOptions = typeof streamOpt === 'object' ? streamOpt : {}
      try {
        const server = await startStreamServer(cfg)
        serverDrain = ctx => server.drain(ctx)
      } catch (err) {
        console.error('[evlog/next] failed to start stream server:', err)
      }
    }

    const composedDrain = composeDrains(userDrain, serverDrain)
    const inner = createInstrumentation({ ...rest, drain: composedDrain })
    await inner.register()
  }

  // We intentionally instantiate a "zero-time" inner just for onRequestError —
  // it wires `log.error` which doesn't depend on the drain.
  const errorOnly = createInstrumentation({ ...rest })

  return {
    register,
    onRequestError: errorOnly.onRequestError,
  }
}

function composeDrains(
  user: ((ctx: DrainContext) => void | Promise<void>) | undefined,
  server: ((ctx: DrainContext) => void | Promise<void>) | null,
): ((ctx: DrainContext) => void | Promise<void>) | undefined {
  if (!user && !server) return undefined
  if (!user) return server!
  if (!server) return user
  return async (ctx) => {
    await Promise.all([
      Promise.resolve(user(ctx)),
      Promise.resolve(server(ctx)),
    ])
  }
}
