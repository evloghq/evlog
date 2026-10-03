import type { CollectConfig, CollectFields, CollectFlags, FlagDefinitions } from './types'

/** Allowlisted system-injected custom keys (e.g. GitHub Actions metadata). */
const SYSTEM_CUSTOM_KEYS = new Set(['ghaAction', 'ghaEvent'])
const MAX_SYSTEM_STRING_LEN = 128

/**
 * Value recorded for a string flag whose content is not allowlisted.
 *
 * A distinct sentinel rather than `true`: `--baseline main` and a genuine
 * boolean flag are different facts about a run, and reporting both as `true`
 * makes a value-carrying option indistinguishable from a switch in aggregate.
 * The angle brackets keep it from ever colliding with a real CLI value.
 */
export const FLAG_VALUE_SET = '<set>'

/**
 * Sanitize framework-injected custom fields before they enter the event envelope.
 * Only allowlisted keys pass through; values are truncated to a bounded length.
 */
export function sanitizeSystemCustom(
  input: Record<string, string> | undefined,
): Record<string, string> {
  if (!input) return {}

  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(input)) {
    if (!SYSTEM_CUSTOM_KEYS.has(key) || typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed) continue
    out[key] = trimmed.slice(0, MAX_SYSTEM_STRING_LEN)
  }
  return out
}

/** `min-score` → `minScore`. Parsers hand back both spellings of the same flag. */
export function toCamelCase(key: string): string {
  return key.replace(/-([a-z0-9])/gi, (_, char: string) => char.toUpperCase())
}

/** Options for {@link sanitizeFlags}. */
export interface SanitizeFlagsOptions {
  /** Allowlists declared by the tool author. */
  collect?: CollectConfig<CollectFlags, CollectFields>
  /**
   * The command's declared arguments.
   *
   * Used to drop flags still sitting at their declared default, so the payload
   * says what the user asked for rather than what the parser filled in.
   */
  args?: FlagDefinitions
}

/**
 * Sanitize parsed flags by shape — never reads raw argv.
 *
 * Booleans and numbers: value captured. Strings: {@link FLAG_VALUE_SET} unless
 * allowlisted in `collect.flags`. Argv artifacts are dropped: the positional
 * bucket (`_`), the kebab-case twin of every camelCase flag, and anything left
 * at its declared default.
 */
export function sanitizeFlags(
  raw: Record<string, unknown> | undefined,
  options: SanitizeFlagsOptions = {},
): Record<string, boolean | number | string> {
  if (!raw) return {}

  const out: Record<string, boolean | number | string> = {}
  const allowlists = options.collect?.flags ?? {}
  const defs = options.args ?? {}

  for (const [rawKey, value] of Object.entries(raw)) {
    if (value === undefined || value === null) continue
    /* citty's positional bucket. It holds argument values, not flag names, and
       a count of them says nothing that `command` does not already say. */
    if (rawKey === '_') continue

    const key = toCamelCase(rawKey)
    const declaredDefault = defs[key]?.default ?? defs[rawKey]?.default
    if (declaredDefault !== undefined && value === declaredDefault) continue

    if (typeof value === 'boolean' || typeof value === 'number') {
      out[key] = value
      continue
    }

    if (typeof value === 'string') {
      const allowed = allowlists[key]
      out[key] = allowed?.includes(value) ? value : FLAG_VALUE_SET
      continue
    }

    // Arrays / objects: presence only
    out[key] = true
  }

  return out
}

/**
 * Validate and merge custom fields from {@link telemetry.set}.
 * Undeclared strings are dropped (never thrown).
 */
export function sanitizeCustom(
  input: Record<string, unknown>,
  existing: Record<string, boolean | number | string>,
  collect?: CollectConfig<CollectFlags, CollectFields>,
): Record<string, boolean | number | string> {
  const out = { ...existing }
  const fieldAllowlists = collect?.fields ?? {}

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue

    if (typeof value === 'boolean' || typeof value === 'number') {
      out[key] = value
      continue
    }

    if (typeof value === 'string') {
      const allowed = fieldAllowlists[key]
      if (allowed?.includes(value)) {
        out[key] = value
      }
      // undeclared strings: dropped silently
    }
  }

  return out
}
