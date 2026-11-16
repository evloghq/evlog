import type { RequestLogger } from '../types'
import { matchesPattern } from '../utils'

/**
 * Minimal type for the Better Auth instance.
 * Only requires `api.getSession` — compatible with any Better Auth configuration.
 *
 * Headers are typed as `Headers` (not a wider union) so a real Better Auth
 * instance is assignable. Record-style headers are normalized internally
 * before being passed to `auth.api.getSession`.
 */
export interface BetterAuthInstance {
  api: {
    getSession: (opts: {
      headers: Headers
    }) => Promise<{
      user: Record<string, unknown>
      session: Record<string, unknown>
    } | null>
  }
}

/**
 * Headers in any shape commonly produced by HTTP frameworks.
 * Normalized internally to a `Headers` instance before calling Better Auth.
 */
export type HeadersInput = Headers | Record<string, string | string[] | undefined>

function toHeaders(input: HeadersInput): Headers {
  if (input instanceof Headers) return input
  const headers = new Headers()
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item)
    } else {
      headers.set(key, value)
    }
  }
  return headers
}

/**
 * User fields extracted from a Better Auth session.
 */
export interface AuthUserData {
  id: string
  name?: string
  email?: string
  image?: string
  emailVerified?: boolean
  createdAt?: string
}

/**
 * Session fields extracted from a Better Auth session.
 */
export interface AuthSessionData {
  id: string
  expiresAt?: string
  ipAddress?: string
  userAgent?: string
  createdAt?: string
}

export interface IdentifyOptions {
  /**
   * Whether to mask the user email (e.g. `h***@domain.com`).
   * @default false
   */
  maskEmail?: boolean
  /**
   * Whether to include session metadata on the wide event.
   * @default true
   */
  session?: boolean
  /**
   * Whitelist of user fields to include.
   * @default ['id', 'name', 'email', 'image', 'emailVerified', 'createdAt']
   */
  fields?: string[]
  /**
   * Extend the wide event with additional fields derived from the session.
   * Useful for Better Auth plugins (organizations, roles, etc.).
   *
   * @example
   * ```ts
   * identifyUser(log, session, {
   *   extend: (session) => ({
   *     organization: session.user.activeOrganization,
   *     role: session.user.role,
   *   }),
   * })
   * ```
   */
  extend?: (session: { user: Record<string, unknown>, session: Record<string, unknown> }) => Record<string, unknown> | undefined
}

export interface AuthMiddlewareOptions extends IdentifyOptions {
  /**
   * Route patterns to skip session resolution (glob).
   * @default ['/api/auth/**']
   */
  exclude?: string[]
  /**
   * Route patterns to apply session resolution (glob).
   * If set, only matching routes are resolved.
   */
  include?: string[]
  /**
   * Called after a user is successfully identified.
   * Use to add conditional logic based on user data (e.g. force-keep logs for premium users).
   */
  onIdentify?: (log: RequestLogger, session: { user: Record<string, unknown>, session: Record<string, unknown> }) => void | Promise<void>
  /**
   * Called when no session is found (anonymous request).
   */
  onAnonymous?: (log: RequestLogger) => void | Promise<void>
}

export type AuthIdentifierOptions = AuthMiddlewareOptions

const DEFAULT_USER_FIELDS = ['id', 'name', 'email', 'image', 'emailVerified', 'createdAt']

const isDev = typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production'

/**
 * Mask an email address for safe logging: `hugo@example.com` -> `h***@example.com`.
 */
export function maskEmail(email: string): string {
  const atIndex = email.indexOf('@')
  if (atIndex <= 0) return '***'
  return `${email[0]}***${email.slice(atIndex)}`
}

function extractUserData(
  user: Record<string, unknown>,
  options?: IdentifyOptions,
): AuthUserData {
  const fields = options?.fields ?? DEFAULT_USER_FIELDS
  const data: Record<string, unknown> = {}

  if (user.id !== undefined && user.id !== null) {
    data.id = user.id
  }

  for (const field of fields) {
    if (field === 'id') continue
    const value = user[field]
    if (value === undefined || value === null) continue

    if (field === 'email' && options?.maskEmail && typeof value === 'string') {
      data[field] = maskEmail(value)
    } else if (field === 'createdAt' && value instanceof Date) {
      data[field] = value.toISOString()
    } else {
      data[field] = value
    }
  }

  return data as unknown as AuthUserData
}

function extractSessionData(
  session: Record<string, unknown>,
): AuthSessionData {
  const data: AuthSessionData = { id: String(session.id) }

  if (session.expiresAt) {
    data.expiresAt = session.expiresAt instanceof Date
      ? session.expiresAt.toISOString()
      : String(session.expiresAt)
  }
  if (typeof session.ipAddress === 'string') data.ipAddress = session.ipAddress
  if (typeof session.userAgent === 'string') data.userAgent = session.userAgent
  if (session.createdAt) {
    data.createdAt = session.createdAt instanceof Date
      ? session.createdAt.toISOString()
      : String(session.createdAt)
  }

  return data
}

/**
 * Identify a user on a wide event from a Better Auth session result.
 *
 * Sets `userId`, `user`, and optionally `session` fields on the logger.
 * Safe by default — only extracts whitelisted fields and never logs passwords or tokens.
 *
 * Returns `true` if the user was identified, `false` if session data was missing.
 *
 * @example
 * ```ts
 * import { identifyUser } from 'evlog/better-auth'
 *
 * const session = await auth.api.getSession({ headers: event.headers })
 * if (session) {
 *   identifyUser(log, session)
 * }
 * ```
 *
 * @example With email masking
 * ```ts
 * identifyUser(log, session, { maskEmail: true })
 * // user.email → "h***@example.com"
 * ```
 *
 * @example With extend for Better Auth plugins
 * ```ts
 * identifyUser(log, session, {
 *   extend: (s) => ({
 *     organization: s.user.activeOrganization,
 *     role: s.user.role,
 *   }),
 * })
 * ```
 */
export function identifyUser(
  log: RequestLogger,
  session: { user: Record<string, unknown>, session: Record<string, unknown> },
  options?: IdentifyOptions,
): boolean {
  const user = extractUserData(session.user, options)
  if (!user.id) return false

  const includeSession = options?.session !== false

  const data: Record<string, unknown> = {
    userId: user.id,
    user,
  }

  if (includeSession) {
    data.session = extractSessionData(session.session)
  }

  if (options?.extend) {
    const extra = options.extend(session)
    if (extra) Object.assign(data, extra)
  }

  log.set(data)
  return true
}

function shouldResolve(path: string, options?: { exclude?: string[], include?: string[] }): boolean {
  const exclude = options?.exclude ?? ['/api/auth/**']
  for (const pattern of exclude) {
    if (matchesPattern(path, pattern)) return false
  }

  if (options?.include) {
    for (const pattern of options.include) {
      if (matchesPattern(path, pattern)) return true
    }
    return false
  }

  return true
}

/**
 * Create an async function that resolves a Better Auth session from headers
 * and identifies the user on the logger.
 *
 * Works with any framework — just pass the auth instance and call the returned
 * function with a logger and headers. Supports `include`/`exclude` route patterns
 * and lifecycle hooks (`onIdentify`, `onAnonymous`).
 *
 * @example Nuxt server middleware
 * ```ts
 * import { createAuthMiddleware } from 'evlog/better-auth'
 *
 * const identify = createAuthMiddleware(auth, {
 *   exclude: ['/api/auth/**', '/api/public/**'],
 * })
 *
 * export default defineEventHandler(async (event) => {
 *   if (!event.context.log) return
 *   await identify(event.context.log, event.headers, event.path)
 * })
 * ```
 *
 * @example Express
 * ```ts
 * const identify = createAuthMiddleware(auth, { maskEmail: true })
 *
 * app.use(async (req, res, next) => {
 *   await identify(req.log, req.headers, req.path)
 *   next()
 * })
 * ```
 */
export function createAuthMiddleware(
  auth: BetterAuthInstance,
  options?: AuthMiddlewareOptions,
): (log: RequestLogger, headers: HeadersInput, path?: string) => Promise<boolean> {
  return async (log, headers, path?) => {
    if (path && !shouldResolve(path, options)) return false

    const start = Date.now()
    try {
      const session = await auth.api.getSession({ headers: toHeaders(headers) })
      const resolvedIn = Date.now() - start

      if (session) {
        const identified = identifyUser(log, session, options)
        if (identified) {
          log.set({ auth: { resolvedIn, identified: true } } as Record<string, unknown>)
          if (options?.onIdentify) await options.onIdentify(log, session)
          return true
        }
      }

      log.set({ auth: { resolvedIn, identified: false } } as Record<string, unknown>)
      if (options?.onAnonymous) await options.onAnonymous(log)
      return false
    } catch (err) {
      const resolvedIn = Date.now() - start
      log.set({ auth: { resolvedIn, identified: false, error: true } } as Record<string, unknown>)
      if (isDev) console.warn('[evlog/better-auth] Session resolution failed:', err)
      if (options?.onAnonymous) await options.onAnonymous(log)
      return false
    }
  }
}

/**
 * Create a Nitro `request` hook that auto-identifies users from Better Auth sessions.
 *
 * Resolves the session from request cookies on every request and sets user/session
 * context on the evlog logger. Skips `/api/auth/**` by default to avoid resolving
 * sessions during auth flows.
 *
 * @example
 * ```ts
 * // server/plugins/evlog-auth.ts
 * import { createAuthIdentifier } from 'evlog/better-auth'
 * import { auth } from '~/lib/auth'
 *
 * export default defineNitroPlugin((nitroApp) => {
 *   nitroApp.hooks.hook('request', createAuthIdentifier(auth))
 * })
 * ```
 *
 * @example With options
 * ```ts
 * nitroApp.hooks.hook('request', createAuthIdentifier(auth, {
 *   maskEmail: true,
 *   exclude: ['/api/auth/**', '/api/public/**'],
 * }))
 * ```
 */
export function createAuthIdentifier(
  auth: BetterAuthInstance,
  options?: AuthIdentifierOptions,
): (event: { path: string, headers: HeadersInput, context: { log?: RequestLogger } }) => Promise<void> {
  const middleware = createAuthMiddleware(auth, options)

  return async (event) => {
    if (!event.context.log) return
    await middleware(event.context.log, event.headers, event.path)
  }
}
