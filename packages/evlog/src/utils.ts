import type { EnvironmentContext, LogLevel } from './types'

/**
 * Milliseconds elapsed since `startTime`, never negative.
 *
 * `Date.now()` is wall-clock: an NTP step or a manual clock change during a
 * request can move it backwards. Clamping keeps the duration a valid
 * non-negative measurement rather than leaking a negative number to drains.
 */
export function elapsedMs(startTime: number): number {
  return Math.max(0, Date.now() - startTime)
}

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`
  }
  return `${(ms / 1000).toFixed(2)}s`
}

export function isServer(): boolean {
  return typeof window === 'undefined'
}

export function isClient(): boolean {
  return typeof window !== 'undefined'
}

export function isBrowser(): boolean {
  if (typeof window === 'undefined') return false
  if (typeof document === 'undefined') return false
  if (typeof navigator !== 'undefined' && navigator.product === 'ReactNative') return false
  return true
}

export function isDev(): boolean {
  if (typeof process !== 'undefined') {
    return process.env.NODE_ENV !== 'production'
  }
  if (typeof window !== 'undefined') {
    return true
  }
  return false
}

export function detectEnvironment(): Partial<EnvironmentContext> {
  const env = typeof process !== 'undefined' ? process.env : {}
  const defaultEnvironment = isDev() ? 'development' : 'production'

  return {
    environment: env.NODE_ENV || defaultEnvironment,
    service: env.SERVICE_NAME || 'app',
    version: env.APP_VERSION,
    commitHash: env.COMMIT_SHA
      || env.GITHUB_SHA
      || env.VERCEL_GIT_COMMIT_SHA
      || env.CF_PAGES_COMMIT_SHA,
    region: env.VERCEL_REGION
      || env.AWS_REGION
      || env.FLY_REGION
      || env.CF_REGION,
  }
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 0,
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
}

/**
 * True if `level` is at least as severe as `minLevel`
 * (trace and debug < info < warn < error < fatal).
 * Trace shares debug's rank: visibility is gated like debug, retention is the
 * opt-in via `sampling.rates.trace` (default 0).
 */
export function isLevelEnabled(level: LogLevel, minLevel: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel]
}

/**
 * Console method for a level. `console.fatal` / `console.trace` do not exist:
 * fatal prints as error, trace prints as log (like debug).
 */
export function getConsoleMethod(level: LogLevel): 'log' | 'info' | 'warn' | 'error' {
  if (level === 'fatal') return 'error'
  if (level === 'trace') return 'log'
  return level as 'log' | 'info' | 'warn' | 'error'
}

export const colors = {
  reset: '\x1B[0m',
  bold: '\x1B[1m',
  dim: '\x1B[2m',
  red: '\x1B[31m',
  green: '\x1B[32m',
  yellow: '\x1B[33m',
  blue: '\x1B[34m',
  magenta: '\x1B[35m',
  cyan: '\x1B[36m',
  white: '\x1B[37m',
  gray: '\x1B[90m',
} as const

const levelColorMap: Record<string, string> = { error: colors.red, fatal: colors.red, warn: colors.yellow, info: colors.cyan, debug: colors.gray, trace: colors.gray }

export function getLevelColor(level: string): string {
  return levelColorMap[level] ?? colors.white
}

export const cssColors = {
  dim: 'color: #6b7280',
  red: 'color: #ef4444; font-weight: bold',
  green: 'color: #22c55e',
  yellow: 'color: #f59e0b; font-weight: bold',
  cyan: 'color: #06b6d4; font-weight: bold',
  gray: 'color: #6b7280; font-weight: bold',
  reset: 'color: inherit; font-weight: normal',
} as const

const cssLevelColorMap: Record<string, string> = { error: cssColors.red, fatal: cssColors.red, warn: cssColors.yellow, info: cssColors.cyan, debug: cssColors.gray, trace: cssColors.gray }

export function getCssLevelColor(level: string): string {
  return cssLevelColorMap[level] ?? cssColors.reset
}

/**
 * Escape `%` in strings interpolated into `console.log` format strings
 * to prevent `%c`, `%s`, `%d` etc. in user data from being interpreted
 * as formatting directives.
 */
export function escapeFormatString(str: string): string {
  return str.replace(/%/g, '%%')
}

/**
 * True when a message string contains a `%s`, `%d` or `%j` specifier, so
 * trailing log arguments have something to interpolate into.
 */
export function hasMessageSpecifiers(format: string): boolean {
  return /%[sdj]/.test(format)
}

/**
 * Interpolate trailing log arguments into a message with the printf subset
 * pino and consola call sites rely on: `%s`, `%d`, `%j` and `%%`. Unknown
 * specifiers and specifiers past the last argument stay literal, surplus
 * arguments are appended space-separated, and a message without arguments is
 * returned unchanged. Objects and arrays render as JSON instead of node's
 * `util.inspect` to keep the formatter free of bundle weight.
 *
 * @param format - Message possibly containing format specifiers
 * @param args - Values for the specifiers
 */
export function formatMessage(format: string, args: unknown[]): string {
  if (args.length === 0) return format

  let argIndex = 0
  const interpolated = format.replace(/%(.)/g, (specifier, char: string): string => {
    if (char === '%') return '%'
    if (char !== 's' && char !== 'd' && char !== 'j') return specifier
    if (argIndex >= args.length) return specifier
    return renderMessageValue(char, args[argIndex++])
  })

  if (argIndex >= args.length) return interpolated

  const extras: string[] = []
  while (argIndex < args.length) {
    extras.push(renderMessageValue('s', args[argIndex++]))
  }
  return `${interpolated} ${extras.join(' ')}`
}

function renderMessageValue(specifier: 's' | 'd' | 'j', value: unknown): string {
  if (specifier === 'j') return renderMessageJson(value)
  if (typeof value === 'bigint') return `${value}n`
  if (specifier === 'd') return String(Number(value))
  if (typeof value === 'string') return value
  if (value === null || typeof value !== 'object') return String(value)
  return renderMessageJson(value)
}

function renderMessageJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    // A cyclic or BigInt-containing argument must not crash the log call.
    return String(value)
  }
}

/** Headers that should never be passed to hooks for security */
export const SENSITIVE_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'proxy-authorization',
]

const SENSITIVE_HEADER_SET = new Set(SENSITIVE_HEADERS)

/**
 * Filter out undefined values and sensitive headers from a raw header map.
 *
 * @param headers - Flat header map where values may be `undefined`
 *   (e.g. from `IncomingMessage.headers` or a framework's header accessor).
 * @returns A new object containing only the headers whose values are defined
 *   and whose lowercased key is not in the built-in sensitive-header list
 *   (e.g. `authorization`, `cookie`, `x-api-key`).
 */
export function filterSafeHeaders(headers: Partial<Record<string, string | undefined>>): Record<string, string> {
  const safeHeaders: Record<string, string> = {}

  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined && !SENSITIVE_HEADER_SET.has(key.toLowerCase())) {
      safeHeaders[key] = value
    }
  }

  return safeHeaders
}

const patternCache = new Map<string, RegExp>()

/**
 * Compile a glob pattern to a anchored RegExp.
 *
 * - `*` matches any characters except the separator
 * - `**` matches any characters including the separator
 * - `?` matches one character except the separator
 */
export function globToRegExp(pattern: string, separator: '/' | '.' = '/'): RegExp {
  const cacheKey = `${separator}:${pattern}`
  let regex = patternCache.get(cacheKey)
  if (!regex) {
    const segment = separator === '/' ? '[^/]*' : '[^.]*'
    const char = separator === '/' ? '[^/]' : '[^.]'
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, segment)
      .replace(/{{GLOBSTAR}}/g, '.*')
      .replace(/\?/g, char)
    regex = new RegExp(`^${regexPattern}$`)
    patternCache.set(cacheKey, regex)
  }
  return regex
}

/**
 * Match a path against a glob pattern.
 * Supports * (any chars except /) and ** (any chars including /).
 */
export function matchesPattern(path: string, pattern: string): boolean {
  return globToRegExp(pattern, '/').test(path)
}

/** Reused Date for ISO formatting — avoids allocating on second rollover. */
const _isoDate = new Date()
let _isoCachedSecond = -1
let _isoCachedPrefix = ''

/**
 * Current wall-clock time as an ISO-8601 UTC string (`YYYY-MM-DDTHH:mm:ss.sssZ`).
 *
 * Caches the formatted prefix through the second and only appends milliseconds on
 * each call — same technique as pino / h3's logger, so hot emit paths avoid
 * re-running `toISOString()` thousands of times per second.
 */
export function isoNow(): string {
  const now = Date.now()
  const sec = Math.floor(now / 1000)
  if (sec !== _isoCachedSecond) {
    _isoCachedSecond = sec
    _isoDate.setTime(now)
    _isoCachedPrefix = _isoDate.toISOString().slice(0, 19)
  }
  return `${_isoCachedPrefix}.${String(now % 1000).padStart(3, '0')}Z`
}
