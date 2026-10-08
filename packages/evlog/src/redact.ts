import type { RedactConfig, RedactReplacement, RedactReplacementContext, WideEvent } from './types'
import { globToRegExp } from './utils'

const DEFAULT_REPLACEMENT = '[REDACTED]'

export type Masker = [RegExp, (match: string) => string]

/** Compiled matchers for {@link RedactConfig.paths} glob patterns. */
export interface RedactPathMatchers {
  exactPaths: Set<string>
  pathGlobs: RegExp[]
  keyGlobs: RegExp[]
  /** Single-segment shorthands (`password` → `**.password`), stored lowercased, matched case-insensitively on leaf keys. */
  caseInsensitiveLeaves: Set<string>
}

/**
 * Normalize a redact path pattern.
 * Single segments without wildcards are shorthand for `**.<segment>`.
 */
export function normalizeRedactPathPattern(pattern: string): string {
  if (!pattern.includes('*') && !pattern.includes('.')) {
    return `**.${pattern}`
  }
  return pattern
}

/**
 * Compile `RedactConfig.paths` into exact paths, path globs, and key globs.
 * Returns `undefined` when `patterns` is empty.
 */
export function compileRedactPathMatchers(patterns?: string[]): RedactPathMatchers | undefined {
  if (!patterns?.length) return undefined

  const exactPaths = new Set<string>()
  const pathGlobs: RegExp[] = []
  const keyGlobs: RegExp[] = []
  const caseInsensitiveLeaves = new Set<string>()

  for (const raw of patterns) {
    if (!raw.includes('*')) {
      if (raw.includes('.')) {
        exactPaths.add(raw)
      } else {
        addPathGlobPattern(normalizeRedactPathPattern(raw), exactPaths, pathGlobs, caseInsensitiveLeaves)
      }
      continue
    }

    if (!raw.includes('.')) {
      keyGlobs.push(globToRegExp(raw, '.'))
    } else {
      addPathGlobPattern(raw, exactPaths, pathGlobs, caseInsensitiveLeaves)
    }
  }

  if (exactPaths.size === 0 && pathGlobs.length === 0 && keyGlobs.length === 0 && caseInsensitiveLeaves.size === 0) {
    return undefined
  }

  return { exactPaths, pathGlobs, keyGlobs, caseInsensitiveLeaves }
}

/** `**.segment` also matches a top-level `segment` field. */
function addPathGlobPattern(
  pattern: string,
  exactPaths: Set<string>,
  pathGlobs: RegExp[],
  caseInsensitiveLeaves: Set<string>,
): void {
  pathGlobs.push(globToRegExp(pattern, '.'))
  const leaf = pattern.match(/^\*\*\.([^.?*]+)$/)
  if (leaf) {
    exactPaths.add(leaf[1]!)
    caseInsensitiveLeaves.add(leaf[1]!.toLowerCase())
  }
}

/**
 * Whether a field at `fullPath` (dot-notation from root) with leaf key `leafKey`
 * should be fully redacted.
 */
export function matchesRedactPath(fullPath: string, leafKey: string, matchers: RedactPathMatchers): boolean {
  if (matchers.exactPaths.has(fullPath)) return true

  if (matchers.caseInsensitiveLeaves.has(leafKey.toLowerCase())) return true

  for (const glob of matchers.pathGlobs) {
    glob.lastIndex = 0
    if (glob.test(fullPath)) return true
  }

  for (const glob of matchers.keyGlobs) {
    glob.lastIndex = 0
    if (glob.test(leafKey)) return true
  }

  return false
}

/**
 * Resolve a {@link RedactReplacement} for one matched value.
 *
 * A throwing or non-string-returning function falls back to the default
 * replacement: a broken policy must degrade to over-redaction, never to
 * emitting the raw value it was meant to scrub.
 */
function resolveReplacement(
  replacement: RedactReplacement,
  matched: unknown,
  ctx: RedactReplacementContext,
): string {
  if (typeof replacement === 'string') return replacement

  try {
    const result = replacement(matched, ctx)
    if (typeof result !== 'string') {
      console.error(
        `[evlog] redact replacement returned ${typeof result} for "${ctx.path}", expected string — using ${DEFAULT_REPLACEMENT}`,
      )
      return DEFAULT_REPLACEMENT
    }
    return result
  } catch (err) {
    console.error(`[evlog] redact replacement failed for "${ctx.path}":`, err)
    return DEFAULT_REPLACEMENT
  }
}

/**
 * Redact fields matching path globs recursively. Mutates `obj` in place (use on a clone).
 */
export function redactPathsInTree(
  obj: unknown,
  matchers: RedactPathMatchers,
  replacement: RedactReplacement,
  prefix = '',
): void {
  if (obj === null || obj === undefined) return

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const segment = String(i)
      const fullPath = prefix ? `${prefix}.${segment}` : segment
      redactPathsInTree(obj[i], matchers, replacement, fullPath)
    }
    return
  }

  if (typeof obj === 'object') {
    const record = obj as Record<string, unknown>
    for (const key of redactableKeys(record)) {
      const fullPath = prefix ? `${prefix}.${key}` : key
      if (matchesRedactPath(fullPath, key, matchers)) {
        setRedacted(record, key, resolveReplacement(replacement, record[key], { path: fullPath, key }), fullPath)
      } else {
        redactPathsInTree(record[key], matchers, replacement, fullPath)
      }
    }
  }
}

/**
 * Own enumerable keys only.
 *
 * `for…in` walks the prototype chain, which on platform objects hands back
 * getter-only accessors — a `DOMException` cause yields `code`, `name` and 25
 * legacy constants, none of them assignable. Own keys keep the walk on data the
 * caller actually set, on plain records and class instances alike.
 */
function redactableKeys(record: Record<string, unknown>): string[] {
  return Object.keys(record)
}

/**
 * Write a redacted value onto a record evlog does not own. `Reflect.set` reports
 * failure instead of throwing, so a field that cannot be scrubbed degrades to a
 * warning rather than taking down the request that produced the event.
 */
function setRedacted(record: Record<string, unknown>, key: string, value: unknown, path: string): void {
  if (Reflect.set(record, key, value)) return

  const desc = Object.getOwnPropertyDescriptor(record, key)
  if (desc && 'value' in desc && desc.configurable) {
    Object.defineProperty(record, key, { ...desc, value })
    return
  }

  console.warn(`[evlog] redact could not rewrite read-only field "${path}" — value left as-is`)
}

/**
 * Return a copy of `value` with path-pattern matches replaced by `replacement`.
 * Used by audit diffs; does not mutate the input.
 *
 * `pointerPath` is a JSON Pointer (e.g. `/user/password`).
 */
export function redactValueByPaths(
  value: unknown,
  matchers: RedactPathMatchers,
  replacement: RedactReplacement,
  pointerPath = '',
): unknown {
  const segments = pointerPath.split('/').filter(Boolean)
  const dotPath = segments.join('.')
  const leafKey = segments.at(-1) ?? ''

  if (value === null || typeof value !== 'object') {
    if (dotPath && matchesRedactPath(dotPath, leafKey, matchers)) {
      return resolveReplacement(replacement, value, { path: dotPath, key: leafKey })
    }
    return value
  }

  if (Array.isArray(value)) {
    return value.map((v, i) => redactValueByPaths(v, matchers, replacement, `${pointerPath}/${i}`))
  }

  if (!isPlainRecord(value)) return value

  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    const childPointer = pointerPath ? `${pointerPath}/${k}` : `/${k}`
    const childDot = dotPath ? `${dotPath}.${k}` : k
    out[k] = matchesRedactPath(childDot, k, matchers)
      ? resolveReplacement(replacement, v, { path: childDot, key: k })
      : redactValueByPaths(v, matchers, replacement, childPointer)
  }
  return out
}

/**
 * Built-in PII detection patterns with smart masking.
 * Each builtin preserves just enough signal for debugging while scrubbing PII.
 */
export const builtinPatterns = {
  /** Credit card numbers → ****1111 (PCI DSS: last 4 allowed) */
  creditCard: {
    pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
    mask: (m: string) => `****${m.replace(/[\s-]/g, '').slice(-4)}`,
  },
  /** Email addresses → a***@***.com */
  email: {
    pattern: /[\w.+-]+@[\w-]+\.[\w.]+/g,
    mask: (m: string) => {
      const at = m.indexOf('@')
      if (at < 1) return '***@***'
      const tld = m.slice(m.lastIndexOf('.'))
      return `${m[0]}***@***${tld}`
    },
  },
  /** IPv4 addresses → ***.***.***.100 (last octet only) */
  ipv4: {
    pattern: /\b(?!0\.0\.0\.0\b)(?!127\.0\.0\.1\b)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    mask: (m: string) => `***.***.***.${m.split('.').pop()}`,
  },
  /**
   * International phone numbers → `+33******78` (country code + last 2 digits).
   *
   * Requires an explicit phone signal (`+countryCode` prefix or `(areaCode)`
   * parens) to avoid false positives on digit-rich identifiers (UUIDs,
   * idempotency keys, order ids, hex hashes). Bare digit runs like `12345678`
   * are intentionally not matched — opt in via custom `patterns` if your app
   * stores phones in unformatted form.
   */
  phone: {
    pattern: /(?:\+\d{1,3}[\s.-]?\(?\d{1,4}\)?|\(\d{1,4}\))(?:[\s.-]?\d{2,4}){2,4}\b/g,
    mask: (m: string) => {
      const digits = m.replace(/[^\d]/g, '')
      const hasPlus = m.startsWith('+')
      if (hasPlus && digits.length > 4) {
        const ccMatch = m.match(/^\+\d{1,3}/)
        const cc = ccMatch ? ccMatch[0] : '+'
        return `${cc}******${digits.slice(-2)}`
      }
      if (digits.length > 2) {
        return `${'*'.repeat(digits.length - 2)}${digits.slice(-2)}`
      }
      return '***'
    },
  },
  /** JWT tokens → eyJ***.*** */
  jwt: {
    pattern: /\beyJ[\w-]*\.[\w-]*\.[\w-]*\b/g,
    mask: () => 'eyJ***.***',
  },
  /** Bearer tokens → Bearer *** */
  bearer: {
    pattern: /\bBearer\s+[\w\-.~+/]{8,}=*/gi,
    mask: () => 'Bearer ***',
  },
  /** IBAN → FR76****189 (country + check digits + last 3) */
  iban: {
    pattern: /\b[A-Z]{2}\d{2}[\s-]?[\dA-Z]{4}[\s-]?[\dA-Z]{4}[\s-]?[\dA-Z]{4}[\s-]?[\dA-Z]{0,4}[\s-]?[\dA-Z]{0,4}[\s-]?[\dA-Z]{0,4}\b/g,
    mask: (m: string) => {
      const clean = m.replace(/[\s-]/g, '')
      return `${clean.slice(0, 4)}****${clean.slice(-3)}`
    },
  },
} as const

export type BuiltinPatternName = keyof typeof builtinPatterns

/**
 * Resolve a `redact` option (boolean or object) into a concrete `RedactConfig`.
 *
 * - `true` → all built-in patterns with smart masking, no custom paths
 * - `{ ... }` → built-in maskers merged with user config (opt-out: `builtins: false`)
 * - `false` / `undefined` → `undefined` (no redaction)
 */
export function resolveRedactConfig(input: boolean | RedactConfig | undefined): RedactConfig | undefined {
  if (input === undefined || input === false) return undefined

  if (input === true) {
    return { _maskers: allBuiltinMaskers() }
  }

  if (input.builtins === false) {
    return {
      ...input,
      _pathMatchers: compileRedactPathMatchers(input.paths),
    }
  }

  const maskers = Array.isArray(input.builtins)
    ? input.builtins
      .map(name => builtinPatterns[name])
      .filter(Boolean)
      .map(b => [cloneRegex(b.pattern), b.mask] as Masker)
    : allBuiltinMaskers()

  return {
    ...input,
    _maskers: maskers,
    _pathMatchers: compileRedactPathMatchers(input.paths),
  }
}

function allBuiltinMaskers(): Masker[] {
  return Object.values(builtinPatterns).map(b => [cloneRegex(b.pattern), b.mask] as Masker)
}

function cloneRegex(re: RegExp): RegExp {
  return new RegExp(re.source, re.flags)
}

/** @internal Set on wide events after initLogger redaction so middleware skips a second pass. */
export const globallyRedacted = Symbol.for('evlog.globallyRedacted')

/** @internal Mark a wide event as already redacted by {@link initLogger}. */
export function markGloballyRedacted(event: Record<string, unknown>): void {
  Object.defineProperty(event, globallyRedacted, { value: true, enumerable: false, configurable: true })
}

/** @internal Whether global redaction already ran on this wide event. */
export function isGloballyRedacted(event: Record<string, unknown>): boolean {
  return Reflect.has(event, globallyRedacted)
}

/**
 * Clone before redaction. Wide events are JSON-shaped; fall back when
 * `structuredClone` rejects non-cloneable values (functions, symbols, etc.).
 */
function cloneForRedaction(event: Record<string, unknown>): Record<string, unknown> {
  try {
    return structuredClone(event)
  } catch {
    try {
      return JSON.parse(JSON.stringify(event)) as Record<string, unknown>
    } catch {
      console.warn('[cloneForRedaction] Shallow clone used — nested objects may be mutated by redactPath, redactPatterns, and applyMaskersToTree')
      return { ...event }
    }
  }
}

/**
 * Redact sensitive data from a wide event without mutating the input.
 *
 * Returns a deep clone with redaction applied. Strategies run in order:
 * 0. **Transform**: user hook, sees raw values so it can derive replacements; the stages below still run after it.
 * 1. **Path-based**: dot-notation paths with optional globs (`password`, `**.password`, `*_token`, `user.*`) — full value replacement.
 * 2. **Masker-based**: built-in patterns with smart partial masking (e.g. `****1111`).
 * 3. **Pattern-based**: custom RegExp patterns on string values replaced with `replacement`.
 *
 * @param event - The wide event object (not mutated).
 * @param config - Redaction configuration.
 * @returns A redacted deep clone of `event`.
 */
export function redactEvent(event: Record<string, unknown>, config: RedactConfig): Record<string, unknown> {
  const clone = cloneForRedaction(event)
  const replacement = config.replacement ?? DEFAULT_REPLACEMENT

  // Runs first so the hook sees raw values; declarative stages then still apply
  // to whatever it leaves behind, so a hook that misses a field is not the last
  // line of defence. Failures are reported and swallowed like drain failures.
  if (config.transform) {
    try {
      config.transform(clone as WideEvent)
    } catch (err) {
      console.error('[evlog] redact transform failed:', err)
    }
  }

  // Configs resolved via resolveRedactConfig carry precompiled matchers; compile lazily for ad-hoc configs.
  const pathMatchers = config._pathMatchers ?? compileRedactPathMatchers(config.paths)
  if (pathMatchers) {
    redactPathsInTree(clone, pathMatchers, replacement)
  }

  if (config._maskers?.length) {
    applyMaskersToTree(clone, config._maskers)
  }

  if (config.patterns?.length) {
    redactPatterns(clone, config.patterns, replacement)
  }

  return clone
}

function redactPatterns(obj: unknown, patterns: RegExp[], replacement: RedactReplacement, prefix = ''): void {
  if (obj === null || obj === undefined) return

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const key = String(i)
      const fullPath = prefix ? `${prefix}.${key}` : key
      if (typeof obj[i] === 'string') {
        obj[i] = applyPatterns(obj[i] as string, patterns, replacement, fullPath, key)
      } else if (typeof obj[i] === 'object') {
        redactPatterns(obj[i], patterns, replacement, fullPath)
      }
    }
    return
  }

  if (typeof obj === 'object') {
    const record = obj as Record<string, unknown>
    for (const key of redactableKeys(record)) {
      const val = record[key]
      const fullPath = prefix ? `${prefix}.${key}` : key
      if (typeof val === 'string') {
        setRedacted(record, key, applyPatterns(val, patterns, replacement, fullPath, key), fullPath)
      } else if (typeof val === 'object') {
        redactPatterns(val, patterns, replacement, fullPath)
      }
    }
  }
}

// eslint-disable-next-line max-params
function applyPatterns(
  value: string,
  patterns: RegExp[],
  replacement: RedactReplacement,
  path: string,
  key: string,
): string {
  let result = value
  for (const pattern of patterns) {
    if (typeof replacement === 'string') {
      result = result.replace(pattern, replacement)
      continue
    }
    result = result.replace(pattern, (...args) => {
      const match = args[0] as string
      return resolveReplacement(replacement, match, { path, key, groups: captureGroups(args) })
    })
  }
  return result
}

/**
 * Extract the capture groups from a `String.prototype.replace` callback's args.
 * Trailing args are `offset, string` — plus a named-groups object when the
 * pattern declares any.
 */
function captureGroups(args: unknown[]): Array<string | undefined> {
  const last = args.at(-1)
  const trailing = typeof last === 'object' && last !== null ? 3 : 2
  return args.slice(1, Math.max(1, args.length - trailing)) as Array<string | undefined>
}

function applyMaskersToTree(obj: unknown, maskers: Masker[]): void {
  if (obj === null || obj === undefined) return

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (typeof obj[i] === 'string') {
        obj[i] = applyMaskers(obj[i] as string, maskers)
      } else if (typeof obj[i] === 'object') {
        applyMaskersToTree(obj[i], maskers)
      }
    }
    return
  }

  if (typeof obj === 'object') {
    const record = obj as Record<string, unknown>
    for (const key of redactableKeys(record)) {
      const val = record[key]
      if (typeof val === 'string') {
        setRedacted(record, key, applyMaskers(val, maskers), key)
      } else if (typeof val === 'object') {
        applyMaskersToTree(val, maskers)
      }
    }
  }
}

function applyMaskers(value: string, maskers: Masker[]): string {
  let result = value
  for (const [pattern, mask] of maskers) {
    result = result.replace(pattern, mask)
  }
  return result
}

/**
 * Whether a `redact` option carries function-valued policy (`replacement` or
 * `transform`).
 *
 * Build-time config bridges (`__EVLOG_CONFIG__`, `process.env.__EVLOG_CONFIG`)
 * go through `JSON.stringify`, which drops functions without a word. Modules
 * that serialize user config call this first so a policy declared in
 * `nuxt.config.ts` fails loudly instead of silently not redacting — the same
 * class of defect as #408 and #441.
 */
export function hasFunctionRedactPolicy(redact: unknown): boolean {
  if (!redact || typeof redact !== 'object') return false
  const config = redact as Record<string, unknown>
  return typeof config.replacement === 'function' || typeof config.transform === 'function'
}

/** Message shared by every config bridge that serializes `redact` through JSON. */
export const FUNCTION_REDACT_POLICY_WARNING
  = '[evlog] redact.replacement / redact.transform is a function and cannot be serialized into the build config. '
    + 'Declare it at runtime instead — initLogger({ redact: { ... } }) from a server plugin — or use a string replacement.'

/**
 * Prepare a `redact` config for the config bridges (`__EVLOG_CONFIG__`,
 * `process.env.__EVLOG_CONFIG`, a framework runtimeConfig). RegExp patterns
 * are rewritten in place to `{ source, flags }` — the shape
 * `deserializeRegexList` reads back — because JSON.stringify reduces a
 * RegExp to `{}` and the pattern is silently dropped. A function-valued
 * policy cannot survive any bridge; warn so the missing redaction is loud.
 * Modules that serialize user config call this before `JSON.stringify`.
 */
export function prepareRedactForBridge(redact: unknown): void {
  if (hasFunctionRedactPolicy(redact)) {
    console.warn(FUNCTION_REDACT_POLICY_WARNING)
  }
  if (!redact || typeof redact !== 'object') return
  const { patterns } = redact as { patterns?: unknown }
  if (!Array.isArray(patterns)) return
  ;(redact as { patterns: unknown[] }).patterns = patterns.map(p =>
    p instanceof RegExp ? { source: p.source, flags: p.flags } : p,
  )
}

/**
 * Normalize a redact config that may have been deserialized from JSON
 * (e.g. via `process.env.__EVLOG_CONFIG`). Converts pattern strings
 * back to RegExp instances, then resolves built-in patterns.
 */
export function normalizeRedactConfig(raw: boolean | Record<string, unknown> | undefined): RedactConfig | undefined {
  if (raw === undefined || raw === false) return undefined
  if (raw === true) return resolveRedactConfig(true)

  const config: RedactConfig = {}

  if (Array.isArray(raw.paths)) {
    config.paths = raw.paths as string[]
  }

  // Function-valued policy survives only when the config object reached us live
  // (e.g. Nitro's in-process runtimeConfig). Through the JSON bridges it is gone
  // before this point — `hasFunctionRedactPolicy` warns at that boundary instead.
  if (typeof raw.replacement === 'string' || typeof raw.replacement === 'function') {
    config.replacement = raw.replacement as RedactReplacement
  }

  if (typeof raw.transform === 'function') {
    config.transform = raw.transform as (event: WideEvent) => void
  }

  if (raw.builtins === false) {
    config.builtins = false
  } else if (Array.isArray(raw.builtins)) {
    config.builtins = raw.builtins as BuiltinPatternName[]
  }

  if (Array.isArray(raw.patterns)) {
    config.patterns = deserializeRegexList(raw.patterns)
  }

  return resolveRedactConfig(config)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function deserializeRegexList(raw: unknown[]): RegExp[] {
  const patterns: RegExp[] = []
  for (const p of raw) {
    try {
      if (p instanceof RegExp) {
        patterns.push(cloneRegex(p))
        continue
      }
      if (typeof p === 'string') {
        patterns.push(new RegExp(p, 'g'))
        continue
      }
      if (typeof p !== 'object' || p === null) continue
      if (typeof (p as { source?: unknown }).source !== 'string') {
        console.warn('[normalizeRedactConfig] Ignoring redact pattern object without a `source` field')
        continue
      }
      const flags = typeof (p as { flags?: unknown }).flags === 'string'
        ? (p as { flags: string }).flags
        : 'g'
      patterns.push(new RegExp((p as { source: string }).source, flags))
    } catch {
      console.warn('[normalizeRedactConfig] Ignoring invalid redact regex entry')
    }
  }
  return patterns
}
