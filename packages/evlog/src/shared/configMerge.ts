import { isPlainObject } from './event'
import type { EvlogPlugin } from './plugin'

/** Lists that grow across layers instead of being replaced: dropping a base entry would loosen redaction or lose kept events. */
const APPENDED_LISTS = new Set(['redact.paths', 'redact.patterns', 'sampling.keep'])

function mergePlugins(base: EvlogPlugin[], override: EvlogPlugin[]): EvlogPlugin[] {
  const byName = new Map(base.map(plugin => [plugin.name, plugin]))
  for (const plugin of override) byName.set(plugin.name, plugin)
  return [...byName.values()]
}

function mergeValue(base: unknown, override: unknown, path: string): unknown {
  if (override === undefined) return base
  if (path === 'plugins' && Array.isArray(base) && Array.isArray(override)) return mergePlugins(base, override)
  /* `redact: true` is the built-in patterns with nothing else, which a base
     object already includes; letting it replace the object would drop the
     base's paths. `false` is the only way to turn redaction off. */
  if (path === 'redact' && override === true && isPlainObject(base)) return base
  if (Array.isArray(base) && Array.isArray(override)) return APPENDED_LISTS.has(path) ? [...base, ...override] : override
  if (isPlainObject(base) && isPlainObject(override)) return mergeRecords(base, override, path)
  return override
}

function mergeRecords(base: Record<string, unknown>, override: Record<string, unknown>, prefix: string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    out[key] = mergeValue(base[key], value, prefix ? `${prefix}.${key}` : key)
  }
  return out
}

/**
 * Lay `override` over `base` with the `extends` rules: scalars and functions
 * are replaced, plain objects merge key by key, `redact.paths`,
 * `redact.patterns` and `sampling.keep` are concatenated, `plugins` merge by
 * `name`.
 */
export function layerEvlogConfig<T extends object>(base: T, override: object): T {
  return mergeRecords(base as Record<string, unknown>, override as Record<string, unknown>, '') as T
}
