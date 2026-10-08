import type { EnvironmentContext, LoggerConfig, SamplingConfig } from '../types'
import type { DevTerminalInput } from './dev-terminal'
import type { BaseEvlogOptions } from './middleware'
import { pickBaseEvlogOptions } from './middleware'

/**
 * Single-config shape accepted everywhere evlog is bootstrapped: at
 * `initLogger` and in framework middleware. Authored
 * with {@link defineEvlog} and split via {@link toLoggerConfig} /
 * {@link toMiddlewareOptions}.
 */
export interface EvlogConfig extends BaseEvlogOptions {
  service?: string
  environment?: string
  /** Full environment context override (advanced). */
  env?: Partial<EnvironmentContext>
  /** Enable or disable all logging globally. */
  enabled?: boolean
  /** Auto-detected from `NODE_ENV` when omitted. */
  pretty?: boolean
  /**
   * Dev terminal output: preset or explicit overlay + pretty-error settings.
   * @default 'evlog' when pretty in development
   */
  dev?: DevTerminalInput
  sampling?: SamplingConfig
  /** Suppress built-in console output (useful when drains own the channel). */
  silent?: boolean
  /** Emit JSON strings (default) or raw objects in non-pretty mode. */
  stringify?: boolean
  /** Minimum severity for the global `log` API. */
  minLevel?: LoggerConfig['minLevel']
}

/**
 * Identity helper for authoring an evlog configuration once and sharing it
 * across `initLogger` and framework middleware.
 *
 * @example
 * ```ts
 * export const config = defineEvlog({
 *   service: 'checkout',
 *   redact: true,
 *   sampling: { rates: { info: 25 } },
 *   enrich: createDefaultEnrichers(),
 *   plugins: [drainPlugin('axiom', createAxiomDrain())],
 * })
 *
 * initLogger(toLoggerConfig(config))
 * app.use(evlogMiddleware(config))
 * ```
 */
export function defineEvlog<T extends EvlogConfig>(config: T): T {
  return config
}

/**
 * Project an {@link EvlogConfig} onto the surface accepted by `initLogger`.
 * Strips middleware-only fields (`include`, `exclude`, `routes`, `enrich`,
 * `keep`); drains and plugins are preserved.
 */
export function toLoggerConfig(config: EvlogConfig): LoggerConfig {
  const env: Partial<EnvironmentContext> | undefined = config.env
    ? { ...config.env }
    : config.service || config.environment
      ? {}
      : undefined
  if (env) {
    if (config.service) env.service = config.service
    if (config.environment) env.environment = config.environment
  }
  const out: LoggerConfig = {}
  if (env) out.env = env
  if (config.enabled !== undefined) out.enabled = config.enabled
  if (config.pretty !== undefined) out.pretty = config.pretty
  if (config.dev !== undefined) out.dev = config.dev
  if (config.sampling !== undefined) out.sampling = config.sampling
  if (config.minLevel !== undefined) out.minLevel = config.minLevel
  if (config.stringify !== undefined) out.stringify = config.stringify
  if (config.silent !== undefined) out.silent = config.silent
  if (config.redact !== undefined) out.redact = config.redact
  if (config.drain) out.drain = config.drain
  if (config.plugins) out.plugins = config.plugins
  return out
}

/** Project an {@link EvlogConfig} onto the surface accepted by framework middleware. */
export function toMiddlewareOptions<T extends BaseEvlogOptions>(config: EvlogConfig): T {
  return pickBaseEvlogOptions(config) as T
}
