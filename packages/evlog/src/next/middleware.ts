import { shouldLog } from '../shared/routes'
import type { EvlogMiddlewareConfig } from './types'

type NextRequest = {
  nextUrl: { pathname: string }
  headers: { get(name: string): string | null }
}

type NextResponse = {
  headers: {
    set(name: string, value: string): void
    get(name: string): string | null
  }
}

type NextResponseStatic = {
  next(options?: { request?: { headers: Headers } }): NextResponse
}

/**
 * Create an evlog middleware for Next.js.
 * Sets `x-request-id` and `x-evlog-start` headers so `withEvlog()` can reuse them
 * for timing consistency across the middleware -> handler chain.
 *
 * @example
 * ```ts
 * // middleware.ts
 * import { evlogMiddleware } from 'evlog/next'
 * export const middleware = evlogMiddleware()
 * export const config = { matcher: ['/api/:path*'] }
 * ```
 */
export function evlogMiddleware(config?: EvlogMiddlewareConfig) {
  return async (request: NextRequest) => {
    const path = request.nextUrl.pathname

    if (!shouldLog(path, config?.include, config?.exclude)) {
      const { NextResponse: nextResponse } = await import('next/server') as { NextResponse: NextResponseStatic }
      return nextResponse.next()
    }

    const existingId = request.headers.get('x-request-id')
    const requestId = existingId || crypto.randomUUID()

    const requestHeaders = new Headers(request.headers as HeadersInit)

    requestHeaders.set('x-request-id', requestId)
    requestHeaders.set('x-evlog-start', String(Date.now()))

    const { NextResponse: nextResponse } = await import('next/server') as { NextResponse: NextResponseStatic }
    const response = nextResponse.next({
      request: { headers: requestHeaders },
    })

    // Also set on response for downstream consumers
    response.headers.set('x-request-id', requestId)

    return response
  }
}
