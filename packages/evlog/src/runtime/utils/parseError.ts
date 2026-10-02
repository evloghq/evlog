import type { FetchError } from 'ofetch'
import type { ParsedError } from '../../types'
import { extractErrorStatus } from '../../shared/errors'
import { isEvlogError } from '../../shared/error-brand'

export type { ParsedError }

function pickCode(value: unknown): string | undefined {
  if (value && typeof value === 'object' && 'code' in value) {
    const { code } = value as { code?: unknown }
    if (typeof code === 'string') return code
  }
  return undefined
}

function pickRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** What a serialized error says about itself. Never part of the client payload. */
const responseMetadataKeys = new Set(['name', 'url', 'message', 'status', 'statusCode', 'statusText', 'statusMessage', 'error', 'cause', 'stack', 'data'])

/**
 * The payload of a body that carries no nested `data`: its own fields, minus the
 * metadata every serializer wraps them in. Subtracting beats guessing whether a
 * body is an envelope, which misreads a payload keyed `statusCode`.
 */
function payloadFromBody(body: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!body) return undefined
  const entries = Object.entries(body).filter(([key]) => !responseMetadataKeys.has(key))
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function pickString(value: Record<string, unknown> | undefined, key: string): string | undefined {
  const found = value?.[key]
  return typeof found === 'string' ? found : undefined
}

/**
 * An EvlogError holds the payload on `data` itself and its own message and
 * status on the error. Reading it through the envelope path below would let a
 * payload keyed `statusCode` or `statusMessage` pass itself off as the response
 * metadata.
 */
function parseEvlogError(error: { message: string, data?: unknown }): ParsedError {
  const data = pickRecord(error.data)
  return {
    message: error.message,
    status: extractErrorStatus(error),
    code: pickCode(data) ?? pickCode(error),
    why: pickString(data, 'why'),
    fix: pickString(data, 'fix'),
    link: pickString(data, 'link'),
    data,
    raw: error,
  }
}

/**
 * Read any error into the flat shape a UI branches on: `message`, `status`,
 * `code`, the `why` / `fix` / `link` guidance, and the client `data` payload.
 *
 * Accepts what each layer actually hands you: an {@link EvlogError} thrown
 * server-side, an ofetch `FetchError` whose `data` is the parsed response body,
 * that body on its own, an h3 error holding its payload on `data`, or any other
 * `Error`. `raw` always carries the input back for debugging.
 *
 * `data` is the payload the server chose to expose, from `createError({ data })`
 * merged with the guidance fields. It is read from the body's nested `data` when
 * there is one, otherwise from the body's own fields with the response metadata
 * (`status`, `message`, `url`, …) removed, so it never echoes the envelope. It is
 * `undefined` when the error carries no payload. `internal` never appears here.
 *
 * @example
 * ```ts
 * const { message, why, fix, data } = parseError(error)
 * if (typeof data?.retryAfter === 'number') scheduleRetry(data.retryAfter)
 * ```
 */
export function parseError(error: unknown): ParsedError {
  if (isEvlogError(error)) {
    return parseEvlogError(error as { message: string, data?: unknown })
  }

  if (error && typeof error === 'object' && 'data' in error) {
    const { data, message: fetchMessage, statusCode: fetchStatusCode, status: fetchStatus } = error as FetchError & { status?: number }

    // A response body nests the payload under its own `data`. A flat body, or an
    // h3 error holding the payload directly, carries it among its own fields.
    const payload = pickRecord(data?.data) ?? payloadFromBody(pickRecord(data))

    return {
      message: data?.statusText || data?.statusMessage || data?.message || fetchMessage || 'An error occurred',
      status: data?.status || data?.statusCode || fetchStatus || fetchStatusCode || 500,
      code: pickCode(payload) ?? pickCode(data) ?? pickCode(error),
      why: pickString(payload, 'why'),
      fix: pickString(payload, 'fix'),
      link: pickString(payload, 'link'),
      data: payload,
      raw: error,
    }
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      status: extractErrorStatus(error),
      code: pickCode(error),
      raw: error,
    }
  }

  return {
    message: String(error),
    status: 500,
    raw: error,
  }
}
