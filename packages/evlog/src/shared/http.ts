/**
 * Minimal HTTP transport for drain adapters: abort-based timeouts, jittered
 * exponential backoff on transient failures, `Retry-After`, response bodies
 * truncated in error messages.
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
  body: string | Uint8Array<ArrayBuffer>
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
   * Retries network errors, timeouts, and `408`, `429`, `502`, `503`, `504`
   * responses (plus {@link HttpPostOptions.retryStatuses}) with jittered
   * exponential backoff, never sooner than the response's `Retry-After`.
   * @default 2
   */
  retries?: number
  /** Extra statuses the provider documents as retryable, e.g. Datadog's `500`. */
  retryStatuses?: readonly number[]
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
  /**
   * Reclassify a non-2xx response before the retry decision, e.g. to stop
   * retrying while a provider-specific rate-limit header is in force.
   */
  onErrorResponse?: (error: DrainDeliveryError) => DrainDeliveryError
  /**
   * Called after the backoff wait, right before each retry. Return an error to
   * throw it instead of retrying, e.g. when a limit announced by a concurrent
   * request is now in force.
   */
  beforeRetry?: () => DrainDeliveryError | undefined
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

/** Statuses retried for every drain: the request may succeed unchanged later. */
const RETRYABLE_STATUSES: readonly number[] = [408, 429, 502, 503, 504]

/**
 * Longest `Retry-After` that `httpPost` waits for between its own attempts.
 * A longer one ends the call, and the error carries the delay so a caller such
 * as `createDrainPipeline` can hold the events until then.
 */
const MAX_INLINE_RETRY_AFTER_MS = 10_000

/**
 * A drain request that failed. `retryable` says whether sending the same
 * request again may succeed; `retryAfterMs` is the provider's `Retry-After`.
 * `createDrainPipeline` reads both, so a custom drain can throw one to stop
 * retries for a request the provider will never accept.
 *
 * @example
 * ```ts
 * if (response.status === 413) {
 *   throw new DrainDeliveryError('Payload too large', { status: 413, retryable: false })
 * }
 * ```
 */
export class DrainDeliveryError extends Error {
  /** HTTP status, when the provider answered. */
  readonly status?: number
  readonly retryable: boolean
  /** Delay the provider asked for in `Retry-After`, in milliseconds. */
  readonly retryAfterMs?: number
  /** Response headers, when the provider answered. */
  readonly headers?: Headers
  /**
   * How many events of the request the provider rejected when it accepted the
   * rest, such as an OTLP `partialSuccess`. `createDrainPipeline` counts only
   * these as dropped. Unset means the whole request failed.
   */
  readonly rejected?: number

  constructor(message: string, options: { status?: number, retryable: boolean, retryAfterMs?: number, headers?: Headers, rejected?: number, cause?: unknown }) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'DrainDeliveryError'
    this.status = options.status
    this.retryable = options.retryable
    this.retryAfterMs = options.retryAfterMs
    this.headers = options.headers
    this.rejected = options.rejected
  }
}

/**
 * Parse a `Retry-After` header (delay in seconds or an HTTP date) into
 * milliseconds from `now`. Returns `undefined` when the header is missing or
 * malformed.
 */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10) * 1000
  const date = Date.parse(trimmed)
  if (Number.isNaN(date)) return undefined
  return Math.max(0, date - now)
}

/** Half the delay plus a random share of the other half, so clients that failed together do not retry together. */
function withJitter(delayMs: number): number {
  return delayMs / 2 + Math.random() * (delayMs / 2)
}

function isRetryable(error: unknown): boolean {
  if (error instanceof DrainDeliveryError) return error.retryable
  return error instanceof TypeError
}

async function gzip(body: string | Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * POST a body with timeout + retry. Throws label-prefixed errors with a
 * truncated response body. Safe to call from any drain `send()`.
 */
export async function httpPost({ url, headers, body, compression, timeout, label, retries = 2, retryStatuses, userAgent, source, onResponse, onErrorResponse, beforeRetry }: HttpPostOptions): Promise<void> {
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
        const error = new DrainDeliveryError(`${label} API error: ${response.status} ${response.statusText} - ${safeText}`, {
          status: response.status,
          retryable: RETRYABLE_STATUSES.includes(response.status) || (retryStatuses?.includes(response.status) ?? false),
          retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
          headers: response.headers,
        })
        throw onErrorResponse ? onErrorResponse(error) : error
      }

      await onResponse?.(response)
      clearTimeout(timeoutId)
      return
    } catch (error) {
      clearTimeout(timeoutId)

      if (error instanceof DOMException && error.name === 'AbortError') {
        lastError = new DrainDeliveryError(`${label} request timed out after ${timeout}ms`, { retryable: true, cause: error })
      } else {
        lastError = error as Error
      }

      const retryAfterMs = lastError instanceof DrainDeliveryError ? lastError.retryAfterMs : undefined
      if (!isRetryable(lastError) || attempt === normalizedRetries || (retryAfterMs ?? 0) > MAX_INLINE_RETRY_AFTER_MS) {
        throw lastError
      }

      await new Promise<void>(r => setTimeout(r, Math.max(withJitter(200 * 2 ** attempt), retryAfterMs ?? 0)))
      const stop = beforeRetry?.()
      if (stop) throw stop
    }
  }

  throw lastError!
}
