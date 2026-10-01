/**
 * Minimal HTTP transport for drain adapters: abort-based timeouts, exponential
 * backoff on `5xx` / `429` / network errors, response bodies truncated in error
 * messages.
 *
 * Identifies every outgoing request as coming from evlog via:
 * - `User-Agent: evlog/<version>` (Node / server runtimes only — browsers strip this)
 * - `X-Evlog-Source: <source>` when {@link HttpPostOptions.source} is set
 */

import { version as PKG_VERSION } from '../../package.json'

/** Build-time evlog package version, e.g. `2.16.0`. */
export const EVLOG_VERSION: string = PKG_VERSION

/** Default `User-Agent` value injected into outgoing drain requests. */
export const EVLOG_USER_AGENT = `evlog/${EVLOG_VERSION}`

export interface HttpPostOptions {
  url: string
  /** Caller is responsible for `Content-Type`. */
  headers: Record<string, string>
  /** Pre-serialized request body. */
  body: string
  /**
   * Compress the body before sending and set `Content-Encoding` accordingly.
   * The body is compressed once and reused across retries.
   */
  compression?: 'gzip'
  /** Abort the request after this many milliseconds. */
  timeout: number
  /** Prefix used in error messages. */
  label: string
  /**
   * Retries network errors, aborts, and `5xx` / `429` responses with
   * exponential backoff.
   * @default 2
   */
  retries?: number
  /**
   * Override the default `User-Agent: evlog/<version>` header. Pass `false` or
   * an empty string to suppress it entirely (e.g. when the underlying transport
   * forbids overriding `User-Agent`).
   */
  userAgent?: string | false
  /**
   * When set, sends `X-Evlog-Source: <source>` so the receiving system can
   * distinguish evlog traffic from other clients. Typically the adapter name
   * (`axiom`, `datadog`, ...) or `client` for browser-originated drains.
   */
  source?: string
  /**
   * Inspect a successful response before the request resolves. Lets an adapter
   * surface partial failures a 2xx can still carry (e.g. Axiom's `failed` and
   * `messages` fields).
   */
  onResponse?: (response: Response) => void | Promise<void>
}

function hasHeader(headers: Record<string, string>, target: string): boolean {
  const lower = target.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return true
  }
  return false
}

/**
 * Returns a copy of `headers` with evlog identity headers injected when
 * absent. Caller-provided values always win.
 *
 * @internal Exposed for tests. Use {@link httpPost} from drains.
 */
export function withEvlogIdentityHeaders(
  headers: Record<string, string>,
  { userAgent, source }: { userAgent?: string | false; source?: string } = {},
): Record<string, string> {
  const out = { ...headers }
  if (userAgent !== false && !hasHeader(out, 'user-agent')) {
    const ua = typeof userAgent === 'string' && userAgent.length > 0 ? userAgent : EVLOG_USER_AGENT
    out['User-Agent'] = ua
  }
  if (source && !hasHeader(out, 'x-evlog-source')) {
    out['X-Evlog-Source'] = source
  }
  return out
}

function isRetryable(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true
  if (error instanceof TypeError) return true
  if (error instanceof Error) {
    const match = error.message.match(/API error: (\d+)/)
    if (match) {
      const status = Number.parseInt(match[1])
      return status >= 500 || status === 429
    }
  }
  return false
}

async function gzip(body: string): Promise<Uint8Array> {
  const stream = new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * POST a body with timeout + retry. Throws label-prefixed errors with a
 * truncated response body. Safe to call from any drain `send()`.
 */
export async function httpPost({ url, headers, body, compression, timeout, label, retries = 2, userAgent, source, onResponse }: HttpPostOptions): Promise<void> {
  const normalizedRetries = Number.isFinite(retries) && retries >= 0 ? Math.floor(retries) : 2
  const finalHeaders = withEvlogIdentityHeaders(headers, { userAgent, source })
  const payload = compression === 'gzip' ? await gzip(body) : body
  if (compression === 'gzip') finalHeaders['Content-Encoding'] = 'gzip'

  let lastError: Error | undefined

  for (let attempt = 0; attempt <= normalizedRetries; attempt++) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: finalHeaders,
        body: payload,
        signal: controller.signal,
      })

      if (!response.ok) {
        const text = await response.text().catch(() => 'Unknown error')
        const safeText = text.length > 200 ? `${text.slice(0, 200)}...[truncated]` : text
        throw new Error(`${label} API error: ${response.status} ${response.statusText} - ${safeText}`)
      }

      await onResponse?.(response)
      clearTimeout(timeoutId)
      return
    } catch (error) {
      clearTimeout(timeoutId)

      if (error instanceof DOMException && error.name === 'AbortError') {
        lastError = new Error(`${label} request timed out after ${timeout}ms`)
      } else {
        lastError = error as Error
      }

      if (!isRetryable(error) || attempt === normalizedRetries) {
        throw lastError
      }

      await new Promise<void>(r => setTimeout(r, 200 * 2 ** attempt))
    }
  }

  throw lastError!
}
