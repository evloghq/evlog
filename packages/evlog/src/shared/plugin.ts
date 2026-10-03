import type { DrainContext, EnrichContext, EnvironmentContext, RequestLogger, TailSamplingContext, WideEvent } from '../types'

/** Context passed to {@link EvlogPlugin.setup} when the plugin is registered. */
export interface PluginSetupContext {
  env: EnvironmentContext
}

/** Per-request context for `onRequestStart` / `onRequestFinish`. */
export interface RequestLifecycleContext {
  logger: RequestLogger
  request: {
    method: string
    path: string
    requestId?: string
  }
  /** Pre-filtered safe request headers (sensitive headers stripped). */
  headers?: Record<string, string>
}

export interface RequestFinishContext extends RequestLifecycleContext {
  /** `null` when the event was sampled out or disabled. */
  event: WideEvent | null
  status?: number
  durationMs: number
  error?: Error
}

/** Context passed to {@link EvlogPlugin.onClientLog} for client-submitted events. */
export interface ClientLogContext {
  /** Raw client payload, before normalization. */
  payload: Record<string, unknown>
  request?: {
    method?: string
    path?: string
  }
  headers?: Record<string, string>
}

/**
 * Canonical extension point for evlog. A plugin can opt into any subset of
 * hooks; drains and enrichers are special cases (see {@link drainPlugin} and
 * {@link enricherPlugin}).
 *
 * @example
 * ```ts
 * export const tenantPlugin = definePlugin({
 *   name: 'tenant',
 *   onRequestStart({ logger, headers }) {
 *     const tenantId = headers?.['x-tenant-id']
 *     if (tenantId) logger.set({ tenant: { id: tenantId } })
 *   },
 *   enrich({ event }) {
 *     event.region = process.env.REGION
 *   },
 * })
 * ```
 */
export interface EvlogPlugin {
  /** Stable identifier. Used for de-duplication and error messages. */
  name: string
  /** Run-once when the plugin is registered. */
  setup?: (ctx: PluginSetupContext) => void | Promise<void>
  /** Runs after redaction, before console output and drain. */
  enrich?: (ctx: EnrichContext) => void | Promise<void>
  /** Called for every emitted event. */
  drain?: (ctx: DrainContext) => void | Promise<void>
  /** Tail sampling hook. Set `ctx.shouldKeep = true` to force-keep. */
  keep?: (ctx: TailSamplingContext) => void | Promise<void>
  onRequestStart?: (ctx: RequestLifecycleContext) => void
  onRequestFinish?: (ctx: RequestFinishContext) => void
  /** Observe events submitted from browser/edge clients. */
  onClientLog?: (ctx: ClientLogContext) => void
  /**
   * Decorate per-request loggers with extra methods. Augment `RequestLogger`
   * in a `.d.ts` to expose them on `useLogger()`.
   */
  extendLogger?: (logger: RequestLogger) => void
}

/** Identity helper preserving plugin type inference. */
export function definePlugin(plugin: EvlogPlugin): EvlogPlugin {
  return plugin
}

/** Wrap a standalone drain callback as an {@link EvlogPlugin}. */
export function drainPlugin(name: string, drain: NonNullable<EvlogPlugin['drain']>): EvlogPlugin {
  return { name, drain }
}

/** Wrap a standalone enricher callback as an {@link EvlogPlugin}. */
export function enricherPlugin(name: string, enrich: NonNullable<EvlogPlugin['enrich']>): EvlogPlugin {
  return { name, enrich }
}

/**
 * Compiled view of a plugin set. Errors from individual hooks are caught and
 * logged to `console.error` with the plugin name — they never break the request.
 */
export interface PluginRunner {
  readonly plugins: readonly EvlogPlugin[]
  /** `true` when at least one plugin implements the matching hook. */
  readonly hasEnrich: boolean
  readonly hasDrain: boolean
  readonly hasKeep: boolean
  readonly hasRequestLifecycle: boolean
  readonly hasClientLog: boolean
  readonly hasExtendLogger: boolean
  applyExtendLogger: (logger: RequestLogger) => void
  runOnRequestStart: (ctx: RequestLifecycleContext) => void
  runOnRequestFinish: (ctx: RequestFinishContext) => void
  runEnrich: (ctx: EnrichContext) => Promise<void>
  /** Drains run concurrently (`Promise.allSettled`). */
  runDrain: (ctx: DrainContext) => Promise<void>
  runKeep: (ctx: TailSamplingContext) => Promise<void>
  runOnClientLog: (ctx: ClientLogContext) => void
  runSetup: (ctx: PluginSetupContext) => Promise<void>
}

function logPluginError(name: string, hook: string, err: unknown): void {
  console.error(`[evlog/${name}] ${hook} failed:`, err)
}

/** De-duplicates by `name` — last registration wins. */
export function createPluginRunner(plugins: EvlogPlugin[] = []): PluginRunner {
  const byName = new Map<string, EvlogPlugin>()
  for (const plugin of plugins) {
    byName.set(plugin.name, plugin)
  }
  const list = Array.from(byName.values())

  const hasEnrich = list.some(p => typeof p.enrich === 'function')
  const hasDrain = list.some(p => typeof p.drain === 'function')
  const hasKeep = list.some(p => typeof p.keep === 'function')
  const hasRequestLifecycle = list.some(
    p => typeof p.onRequestStart === 'function' || typeof p.onRequestFinish === 'function',
  )
  const hasClientLog = list.some(p => typeof p.onClientLog === 'function')
  const hasExtendLogger = list.some(p => typeof p.extendLogger === 'function')

  return {
    plugins: list,
    hasEnrich,
    hasDrain,
    hasKeep,
    hasRequestLifecycle,
    hasClientLog,
    hasExtendLogger,
    applyExtendLogger(logger) {
      for (const plugin of list) {
        if (!plugin.extendLogger) continue
        try {
          plugin.extendLogger(logger)
        } catch (err) {
          logPluginError(plugin.name, 'extendLogger', err)
        }
      }
    },
    runOnRequestStart(ctx) {
      for (const plugin of list) {
        if (!plugin.onRequestStart) continue
        try {
          plugin.onRequestStart(ctx)
        } catch (err) {
          logPluginError(plugin.name, 'onRequestStart', err)
        }
      }
    },
    runOnRequestFinish(ctx) {
      for (const plugin of list) {
        if (!plugin.onRequestFinish) continue
        try {
          plugin.onRequestFinish(ctx)
        } catch (err) {
          logPluginError(plugin.name, 'onRequestFinish', err)
        }
      }
    },
    async runEnrich(ctx) {
      for (const plugin of list) {
        if (!plugin.enrich) continue
        try {
          await plugin.enrich(ctx)
        } catch (err) {
          logPluginError(plugin.name, 'enrich', err)
        }
      }
    },
    async runDrain(ctx) {
      const drains = list.filter(p => typeof p.drain === 'function')
      if (drains.length === 0) return
      await Promise.allSettled(
        drains.map(async (plugin) => {
          try {
            await plugin.drain!(ctx)
          } catch (err) {
            logPluginError(plugin.name, 'drain', err)
          }
        }),
      )
    },
    async runKeep(ctx) {
      for (const plugin of list) {
        if (!plugin.keep) continue
        try {
          await plugin.keep(ctx)
        } catch (err) {
          logPluginError(plugin.name, 'keep', err)
        }
      }
    },
    runOnClientLog(ctx) {
      for (const plugin of list) {
        if (!plugin.onClientLog) continue
        try {
          plugin.onClientLog(ctx)
        } catch (err) {
          logPluginError(plugin.name, 'onClientLog', err)
        }
      }
    },
    async runSetup(ctx) {
      for (const plugin of list) {
        if (!plugin.setup) continue
        try {
          await plugin.setup(ctx)
        } catch (err) {
          logPluginError(plugin.name, 'setup', err)
        }
      }
    },
  }
}

const emptyRunner = createPluginRunner([])

/** Shared no-op runner used when no plugins are registered. */
export function getEmptyPluginRunner(): PluginRunner {
  return emptyRunner
}
