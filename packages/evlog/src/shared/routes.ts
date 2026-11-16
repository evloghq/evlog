import type { RouteConfig } from '../types'
import { matchesPattern } from '../utils'

export function shouldLog(path: string, include?: string[], exclude?: string[]): boolean {
  if (exclude && exclude.length > 0) {
    if (exclude.some(pattern => matchesPattern(path, pattern))) {
      return false
    }
  }

  if (!include || include.length === 0) {
    return true
  }

  return include.some(pattern => matchesPattern(path, pattern))
}

/**
 * Find the service name for a given path based on route patterns.
 *
 * When multiple patterns match the same path, the first matching pattern wins
 * based on object iteration order. To ensure predictable behavior, order your
 * route patterns from most specific to most general.
 *
 * @example
 * ```ts
 * // Good: specific patterns first, general patterns last
 * routes: {
 *   '/api/auth/admin/**': { service: 'admin-service' },
 *   '/api/auth/**': { service: 'auth-service' },
 *   '/api/**': { service: 'api-service' },
 * }
 * ```
 */
export function getServiceForPath(path: string, routes?: Record<string, RouteConfig>): string | undefined {
  if (!routes) return undefined

  for (const [pattern, config] of Object.entries(routes)) {
    if (matchesPattern(path, pattern)) {
      return config.service
    }
  }

  return undefined
}
