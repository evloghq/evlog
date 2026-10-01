import type { DrainContext, EnvironmentContext, LogLevel, RedactConfig, SamplingConfig } from '../types'
import { isDev } from '../utils'
import type { AsyncLocalStorageLike } from './asyncStorageScope'
import type { ResolvedPrettyError } from './dev-terminal'
import type { PluginRunner } from './plugin'
import { getEmptyPluginRunner } from './plugin'

/**
 * Major version this build belongs to. Bump on every major release — the
 * registry key embeds it so two majors never share mutable state.
 *
 * Kept in sync with `package.json` by `test/toolkit/duplicate-install.test.ts`.
 */
const EVLOG_MAJOR = 2

/**
 * Registry key. Every 2.x copy of evlog in a dependency graph resolves the
 * same slot, so `initLogger()` and `withEvlog()` work across duplicate installs
 * (pnpm/bun hash our 18 optional peers into store paths, so two workspaces
 * resolving `ai` or `zod` differently get physically distinct evlog copies).
 */
const REGISTRY_KEY = Symbol.for(`evlog.registry.v${EVLOG_MAJOR}`)

/** Unversioned slot used only to detect — and warn about — multi-major installs. */
const MAJORS_KEY = Symbol.for('evlog.majors')

/**
 * Process-wide logger configuration, shared by every evlog copy of this major.
 *
 * Fields are read through a stable object reference rather than module-local
 * `let` bindings so that a copy which never ran `initLogger()` still sees the
 * drain and redaction policy the application configured.
 *
 * Adding a field within a major is safe (older copies ignore it). Changing the
 * meaning of an existing field is not — an older copy in the same process will
 * still read it with the old semantics.
 */
export interface EvlogGlobalConfig {
  env: EnvironmentContext
  pretty: boolean
  prettyError: ResolvedPrettyError
  sampling: SamplingConfig
  stringify: boolean
  drain: ((ctx: DrainContext) => void | Promise<void>) | undefined
  redact: RedactConfig | undefined
  enabled: boolean
  silent: boolean
  /** Minimum level for the global `log` API only (`ownsEvent === false`). */
  minLevel: LogLevel
  locked: boolean
  initialized: boolean
  /** Set after the first production emit without `initLogger()` warned about it. */
  warnedUninitialized: boolean
  pluginRunner: PluginRunner
}

interface EvlogRegistry {
  config: EvlogGlobalConfig
  /** Request-scoped `AsyncLocalStorage` instances, keyed by integration id. */
  storages: Map<string, AsyncLocalStorageLike<unknown>>
}

type RegistryHost = typeof globalThis & {
  [REGISTRY_KEY]?: EvlogRegistry
  [MAJORS_KEY]?: Set<number>
}

function createConfig(): EvlogGlobalConfig {
  return {
    env: { service: 'app', environment: 'development' },
    pretty: isDev(),
    prettyError: { snippet: isDev(), stackDepth: 2, compact: isDev(), detail: 'full' },
    sampling: {},
    stringify: true,
    drain: undefined,
    redact: undefined,
    enabled: true,
    silent: false,
    minLevel: 'debug',
    locked: false,
    initialized: false,
    warnedUninitialized: false,
    pluginRunner: getEmptyPluginRunner(),
  }
}

function warnOnMultiMajor(host: RegistryHost): void {
  const majors = (host[MAJORS_KEY] ??= new Set<number>())
  if (majors.has(EVLOG_MAJOR)) return
  majors.add(EVLOG_MAJOR)
  if (majors.size > 1) {
    console.warn(
      `[evlog] Multiple major versions of evlog are loaded in this process (${[...majors].map(m => `${m}.x`).join(', ')}). `
      + 'They cannot share request scope or logger configuration: events emitted through the other copy will be undrained '
      + 'and unredacted, and useLogger() may throw. Deduplicate evlog to a single major.',
    )
  }
}

function getRegistry(): EvlogRegistry {
  const host = globalThis as RegistryHost
  warnOnMultiMajor(host)
  return (host[REGISTRY_KEY] ??= { config: createConfig(), storages: new Map() })
}

/**
 * The shared logger configuration record. The reference is stable for the
 * lifetime of the process, so callers may hold it at module scope.
 */
export const globalConfig: EvlogGlobalConfig = getRegistry().config

/**
 * Get — creating on first use — the `AsyncLocalStorage` backing `useLogger()`
 * for one integration. Every copy of evlog resolves the same instance for a
 * given `id`, so a `withEvlog()` from one copy is visible to a `useLogger()`
 * from another.
 *
 * @param id - Stable, integration-scoped identifier (e.g. `'next'`). Third
 *   parties should namespace theirs to avoid colliding with evlog's own.
 * @param create - Factory invoked only when this copy wins the race to register.
 */
export function getSharedStorage<T>(
  id: string,
  create: () => AsyncLocalStorageLike<T>,
): AsyncLocalStorageLike<T> {
  const { storages } = getRegistry()
  let storage = storages.get(id)
  if (!storage) {
    storage = create() as AsyncLocalStorageLike<unknown>
    storages.set(id, storage)
  }
  return storage as AsyncLocalStorageLike<T>
}

/**
 * @internal Reset shared state between tests. Also drops the recorded majors so
 * the multi-major warning can fire again — `vi.resetModules()` re-evaluates
 * modules but leaves `globalThis` untouched.
 */
export function resetGlobalRegistry(): void {
  const host = globalThis as RegistryHost
  Object.assign(globalConfig, createConfig())
  host[REGISTRY_KEY]?.storages.clear()
  host[MAJORS_KEY]?.clear()
}
