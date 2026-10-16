import { getNitroRuntimeConfigRecord } from './nitroConfigBridge'
import { warnDeprecated } from './deprecate'

/** Read the full Nitro `useRuntimeConfig()` record (or `undefined` outside Nitro). */
export function getRuntimeConfig(): Promise<Record<string, any> | undefined> {
  return getNitroRuntimeConfigRecord()
}

/**
 * Description of a single adapter config field. `env` is the ordered list of
 * environment variables to fall back to, e.g. `['NUXT_AXIOM_API_KEY', 'AXIOM_API_KEY']`.
 */
export interface ConfigField<T> {
  key: keyof T & string
  env?: string[]
}

/**
 * Resolve adapter configuration with the standard priority chain:
 *
 * 1. `overrides` passed to the drain factory
 * 2. `runtimeConfig.evlog.{namespace}.{key}` (Nitro)
 * 3. `runtimeConfig.{namespace}.{key}` (Nitro)
 * 4. `process.env[envKey]` for each env in `field.env`
 */
export async function resolveAdapterConfig<T>(
  namespace: string,
  fields: ConfigField<T>[],
  overrides?: Partial<T>,
): Promise<Partial<T>> {
  const runtimeConfig = shouldProbeRuntimeConfig(fields, overrides)
    ? await getRuntimeConfig()
    : undefined
  const evlogNs = runtimeConfig?.evlog?.[namespace]
  const rootNs = runtimeConfig?.[namespace]

  const config: Record<string, unknown> = {}

  for (const { key, env } of fields) {
    config[key] =
      overrides?.[key]
      ?? evlogNs?.[key]
      ?? rootNs?.[key]
      ?? resolveEnv(env)
  }

  return config as Partial<T>
}

/**
 * Format environment variable names for user-facing messages.
 * Drops internal `NUXT_*` aliases; joins alternatives with `, ` and fields with `/`.
 */
export function formatPublicEnvKeys(...envLists: (string[] | undefined)[]): string {
  return envLists
    .map((list) => {
      const all = (list ?? []).filter((k): k is string => !!k)
      const publicKeys = all.filter(k => !k.startsWith('NUXT_'))
      const keys = [...new Set(publicKeys.length > 0 ? publicKeys : all)]
      return keys.join(', ')
    })
    .filter(part => part.length > 0)
    .join('/')
}

/**
 * Copy a deprecated config field onto its replacement when the replacement is
 * unset, warning once per adapter/field pair.
 */
export function applyDeprecatedAlias<T extends object>(
  config: T,
  opts: {
    adapter: string
    from: keyof T & string
    to: keyof T & string
  },
): T {
  const record = config as Record<string, unknown>
  if (record[opts.to] === undefined || record[opts.to] === null) {
    const fromValue = record[opts.from]
    if (fromValue !== undefined && fromValue !== null) {
      warnDeprecated(
        `${opts.adapter}:${opts.from}`,
        `[evlog/${opts.adapter}] '${opts.from}' is deprecated and removed in v3, use '${opts.to}' instead.`,
      )
      record[opts.to] = fromValue
    }
  }
  return config
}

// Avoid the Nitro virtual-module import when env/overrides already resolve
// every env-backed field — optional tuning fields (timeout, retries) should
// not trigger a runtime probe in non-Nitro runtimes.
function shouldProbeRuntimeConfig<T>(
  fields: ConfigField<T>[],
  overrides?: Partial<T>,
): boolean {
  return fields.some(({ key, env }) => {
    if (overrides?.[key] !== undefined) return false
    if (!env) return false
    return resolveEnv(env) === undefined
  })
}

function resolveEnv(envKeys?: string[]): string | undefined {
  if (!envKeys) return undefined
  for (const key of envKeys) {
    const val = process.env[key]
    if (val) return val
  }
  return undefined
}
