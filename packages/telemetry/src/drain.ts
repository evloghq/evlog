import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { RunEvent } from './types'

/**
 * Drain function that attempts delivery for buffered run events.
 * @returns `true` when the batch should be removed from the outbox — either
 * because it was delivered, or because the server permanently rejected it
 * and retrying would never succeed. `false` keeps the batch buffered for a
 * later, transient-failure retry (network error, timeout, 5xx, 429).
 */
export type TelemetryDrain = (events: RunEvent[]) => Promise<boolean>

/** Resolve endpoint: env override → baked-in option → undefined (outbox-only). */
export function resolveEndpoint(option?: string): string | undefined {
  return process.env.EVLOG_TELEMETRY_ENDPOINT ?? option
}

/** No-op drain — outbox-only mode. */
export function createNoopDrain(): TelemetryDrain {
  return () => Promise.resolve(false)
}

/*
 * `node:http` rather than `fetch`: aborting a fetch rejects the promise but
 * leaves a socket that is still connecting open, and the process waits on it
 * for the connect timeout, ten seconds on a host that never answers.
 * Destroying the request closes the socket. A redirect is not followed: it
 * reads as a failed delivery and the batch stays queued.
 */
function post(endpoint: string, body: string, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint)
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: 'POST',
      agent: false,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, (response) => {
      response.resume()
      resolve(response.statusCode!)
    })
    const timer = setTimeout(() => request.destroy(new Error('timeout')), timeoutMs)
    request.on('error', reject)
    request.on('close', () => clearTimeout(timer))
    request.end(body)
  })
}

/** HTTP ingestion drain with timeout. Returns true when the outbox should drop the batch. */
export function createHttpDrain(endpoint: string, timeoutMs = 400): TelemetryDrain {
  return async (events) => {
    if (events.length === 0) return true
    try {
      const status = await post(endpoint, JSON.stringify({ events }), timeoutMs)
      if (status >= 200 && status < 300) return true
      // A 4xx (excluding 429, which is transient rate limiting) means the
      // server permanently rejected this exact payload — an oversized batch,
      // a schema it doesn't recognise, etc. Retrying identical bytes will
      // never succeed, and leaving them in the outbox would silently poison
      // it forever: every future run re-sends the same broken batch first,
      // blocking all telemetry for this tool indefinitely. Drop it instead —
      // losing one batch beats losing all of them.
      if (status >= 400 && status < 500 && status !== 429) return true
      return false
    } catch {
      return false
    }
  }
}
