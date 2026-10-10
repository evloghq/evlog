import type { EnvironmentContext, LoggerConfig, SamplingConfig } from '../types'
import type { DevTerminalInput } from './dev-terminal'
import { isPlainObject } from './event'
import type { BaseEvlogOptions } from './middleware'
import { pickBaseEvlogOptions } from './middleware'
import type { EvlogPlugin } from './plugin'

/**
 * Ids of the checks `evlog map` runs. The CLI asserts at compile time that
 * this union and its rule registry describe the same set.
 */
export type EvlogMapRuleId =
  | 'wide-event'
  | 'context'
  | 'structured-errors'
  | 'audit'
  | 'error-handling'
  | 'page-error-handling'
  | 'error-catalog'
  | 'audit-coverage'
  | 'ai-logging'
  | 'auth-identity'

/**
 * Settings for `evlog map`. The CLI reads them from `evlog.config.ts` without
 * running the file, so every value has to be a literal. A flag passed on the
 * command line wins over the same setting here. Paths are relative to the
 * package being mapped, so one config at the workspace root fits every app.
 */
export interface EvlogMapConfig {
  /**
   * Turn checks on or off for every entry point. `'on'` re-enables a check
   * the config this one extends turned off. `wide-event` and `context` stay
   * on: the map sorts entry points into instrumented, partial and dark by
   * them. Leave entry points out with `ignore` instead.
   */
  rules?: Partial<Record<Exclude<EvlogMapRuleId, 'wide-event' | 'context'>, 'on' | 'off'>>
  /** Entry points left out of the map, as globs matched against their file. */
  ignore?: string[]
  /** Exit 1 when the global score is below this, like `--min-score`. */
  minScore?: number
  /**
   * Compare against a committed map and exit 1 on regression, like
   * `--baseline`: `true` for the committed `evlog.map.json`, a path, or
   * `git:<ref>`.
   */
  baseline?: true | string
}

/** Settings for `evlog logs`, read the same way as {@link EvlogMapConfig}. */
export interface EvlogLogsConfig {
  /** Where the app writes its events, relative to its package, like `--dir`. */
  dir?: string
  /** Most events shown, like `--limit`. */
  limit?: number
}

/**
 * Single-config shape accepted everywhere evlog is bootstrapped: at
 * `initLogger` and in framework middleware. Authored
 * with {@link defineEvlog} and split via {@link toLoggerConfig} /
 * {@link toMiddlewareOptions}.
 */
export interface EvlogConfig extends BaseEvlogOptions {
  /**
   * A config this one builds on, usually a preset shared across repositories.
   * Resolved by {@link defineEvlog} with {@link mergeEvlogConfig}, one level
   * deep: a config that already extends another cannot be extended.
   */
  extends?: EvlogConfig
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
  /** `evlog map` settings. */
  map?: EvlogMapConfig
  /** `evlog logs` settings. */
  logs?: EvlogLogsConfig
}

/** Lists that grow across `extends` instead of being replaced: dropping a parent entry would loosen redaction or lose kept events. */
const APPENDED_LISTS = new Set(['redact.paths', 'redact.patterns', 'sampling.keep'])

const EXTENDED = Symbol.for('evlog.config.extended')

function mergePlugins(parent: EvlogPlugin[], child: EvlogPlugin[]): EvlogPlugin[] {
  const byName = new Map(parent.map(plugin => [plugin.name, plugin]))
  for (const plugin of child) byName.set(plugin.name, plugin)
  return [...byName.values()]
}

function mergeValue(parent: unknown, child: unknown, path: string): unknown {
  if (child === undefined) return parent
  if (path === 'plugins' && Array.isArray(parent) && Array.isArray(child)) return mergePlugins(parent, child)
  /* `redact: true` is the built-in patterns with nothing else, which a parent
     object already includes; letting it replace the object would drop the
     parent's paths. `false` is the only way to turn redaction off. */
  if (path === 'redact' && child === true && isPlainObject(parent)) return parent
  if (Array.isArray(parent) && Array.isArray(child)) return APPENDED_LISTS.has(path) ? [...parent, ...child] : child
  if (isPlainObject(parent) && isPlainObject(child)) return mergeRecords(parent, child, path)
  return child
}

function mergeRecords(parent: Record<string, unknown>, child: Record<string, unknown>, prefix: string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...parent }
  for (const [key, value] of Object.entries(child)) {
    out[key] = mergeValue(parent[key], value, prefix ? `${prefix}.${key}` : key)
  }
  return out
}

/**
 * Merge a config onto the one it extends.
 *
 * The child wins on scalars and functions (`drain`, `enrich`, `keep`); plain
 * objects (`sampling.rates`, `routes`, `env`, `map.rules`) merge key by key;
 * arrays are replaced, except `redact.paths`, `redact.patterns` and
 * `sampling.keep`, which are concatenated. `plugins` merge by `name`.
 * `redact: false` turns redaction off; `redact: true` keeps the parent's
 * redact object.
 *
 * One level only: the result cannot itself be extended, so a setting is never
 * more than one file away from where it applies.
 *
 * @throws when `parent` already extends another config.
 */
export function mergeEvlogConfig(parent: EvlogConfig, child: EvlogConfig): EvlogConfig {
  if (parent.extends !== undefined || EXTENDED in parent) {
    throw new Error(
      '[evlog] A config can extend one level only, and this parent already extends another config. '
      + 'Extend that config directly, or copy the settings you need into one of the two files.',
    )
  }
  const { extends: _parent, ...own } = child
  const merged = mergeRecords(parent as Record<string, unknown>, own, '') as EvlogConfig
  Object.defineProperty(merged, EXTENDED, { value: true })
  return merged
}

/**
 * Author an evlog configuration once and share it across `initLogger`,
 * framework middleware, and the CLI. Returns the config as given, or merged
 * onto `extends` with {@link mergeEvlogConfig} when it has one.
 *
 * @example
 * ```ts
 * // evlog.config.ts
 * import { defineEvlog } from 'evlog'
 * import preset from '@acme/evlog-preset'
 *
 * export default defineEvlog({
 *   extends: preset,
 *   service: 'checkout',
 *   sampling: { rates: { info: 25 } },
 *   map: { rules: { 'error-catalog': 'off' }, minScore: 80 },
 * })
 *
 * // server.ts, with the default export above imported as `config`
 * initLogger(toLoggerConfig(config))
 * app.use(evlog(toMiddlewareOptions(config)))
 * ```
 */
export function defineEvlog<T extends EvlogConfig>(config: T): Omit<T, 'extends'> {
  if (config.extends === undefined) return config
  return mergeEvlogConfig(config.extends, config) as Omit<T, 'extends'>
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
