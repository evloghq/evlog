import type { EnvironmentContext, LoggerConfig, LogLevel, SamplingConfig } from '../types'
import type { BaseEvlogOptions } from '../shared/middleware'

export interface NextEvlogOptions extends BaseEvlogOptions {
  /**
   * Service name for all logged events.
   * @default auto-detected from SERVICE_NAME env or 'app'
   */
  service?: string

  /**
   * Environment context overrides.
   */
  env?: Partial<EnvironmentContext>

  /**
   * Enable pretty printing.
   * @default true in development, false in production
   */
  pretty?: boolean

  /**
   * Enable or disable all logging globally.
   * @default true
   */
  enabled?: boolean

  /**
   * Sampling configuration for filtering logs.
   */
  sampling?: SamplingConfig

  /**
   * Minimum severity for the global `log` API (not request wide events).
   * @default 'debug'
   */
  minLevel?: LogLevel

  /**
   * Minimum severity for request wide events, applied before sampling and
   * `keep`. `error` and `fatal` events are never dropped by this floor.
   * Ignored when `createInstrumentation()` has already locked the logger; pass
   * it to `createInstrumentation()` in that setup.
   */
  requestMinLevel?: LoggerConfig['requestMinLevel']

  /**
   * When pretty is disabled, emit JSON strings (default) or raw objects.
   * @default true
   */
  stringify?: boolean

  /**
   * Suppress built-in console output.
   * Events are still built, sampled, and passed to drains.
   * @default false
   */
  silent?: boolean
}

export interface EvlogMiddlewareConfig {
  /**
   * Route patterns to include in middleware processing.
   * Supports glob patterns like '/api/**'.
   */
  include?: string[]

  /**
   * Route patterns to exclude from middleware processing.
   * Supports glob patterns like '/_next/**'.
   */
  exclude?: string[]
}
