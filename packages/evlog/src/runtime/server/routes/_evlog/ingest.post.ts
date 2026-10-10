import { createError, defineEventHandler, getHeader, getHeaders, getRequestHost, readRawBody, setResponseStatus } from 'h3'
import { useNitroApp } from 'nitropack/runtime'
import type { IngestPayload, WideEvent } from '../../../../types'
import { getEnvironment, getGlobalPluginRunner, shouldSample } from '../../../../logger'
import { filterSafeHeaders } from '../../../../utils'

type IngestEvent = Parameters<typeof defineEventHandler>[0] extends (e: infer E) => unknown ? E : never

const VALID_LEVELS = ['info', 'error', 'warn', 'debug', 'fatal', 'trace'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isLogLevel(value: string): value is IngestPayload['level'] {
  return (VALID_LEVELS as readonly string[]).includes(value)
}

function validateOrigin(event: IngestEvent): void {
  const origin = getHeader(event, 'origin')
  const referer = getHeader(event, 'referer')
  const host = getRequestHost(event)

  const requestOrigin = origin || (referer ? new URL(referer).origin : null)

  if (!requestOrigin) {
    throw createError({ statusCode: 403, message: 'Missing origin header' })
  }

  const originHost = new URL(requestOrigin).host

  if (originHost !== host) {
    throw createError({ statusCode: 403, message: 'Invalid origin' })
  }
}

/**
 * Maximum accepted ingest body size in bytes. Client wide events are small;
 * anything larger is rejected before it reaches the enrich/drain pipeline.
 */
const MAX_BODY_BYTES = 32 * 1024

async function readJsonBody(event: IngestEvent): Promise<unknown> {
  const contentLength = Number(getHeader(event, 'content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw createError({ statusCode: 413, message: 'Payload too large' })
  }

  const raw = await readRawBody(event, 'utf8')
  if (!raw) {
    throw createError({ statusCode: 400, message: 'Invalid request body' })
  }
  // Measure actual UTF-8 bytes so multi-byte payloads can't slip past the cap.
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw createError({ statusCode: 413, message: 'Payload too large' })
  }

  try {
    return JSON.parse(raw)
  } catch {
    throw createError({ statusCode: 400, message: 'Invalid request body' })
  }
}

// ISO 8601 datetime pattern (e.g., 2024-01-31T14:00:00.000Z)
const ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/

function isValidISOTimestamp(value: string): boolean {
  if (!ISO_8601_REGEX.test(value)) return false
  const date = new Date(value)
  return !Number.isNaN(date.getTime())
}

function validatePayload(body: unknown): IngestPayload {
  if (!isRecord(body)) {
    throw createError({ statusCode: 400, message: 'Invalid request body' })
  }

  if (body.timestamp === undefined || body.timestamp === null) {
    throw createError({ statusCode: 400, message: 'Missing required field: timestamp' })
  }

  const { timestamp: rawTimestamp } = body
  let timestamp: string
  if (typeof rawTimestamp === 'number') {
    const minTimestamp = new Date('2000-01-01').getTime()
    const maxTimestamp = Date.now() + 24 * 60 * 60 * 1000 // 1 day in the future
    if (rawTimestamp < minTimestamp || rawTimestamp > maxTimestamp) {
      throw createError({ statusCode: 400, message: 'Invalid timestamp: value out of reasonable range' })
    }
    timestamp = new Date(rawTimestamp).toISOString()
  } else if (typeof rawTimestamp === 'string') {
    if (!isValidISOTimestamp(rawTimestamp)) {
      throw createError({ statusCode: 400, message: 'Invalid timestamp: must be a valid ISO 8601 datetime string' })
    }
    timestamp = rawTimestamp
  } else {
    throw createError({ statusCode: 400, message: 'Invalid timestamp: must be string or number' })
  }

  if (!body.level || typeof body.level !== 'string') {
    throw createError({ statusCode: 400, message: 'Missing required field: level' })
  }

  if (!isLogLevel(body.level)) {
    throw createError({ statusCode: 400, message: `Invalid level: must be one of ${VALID_LEVELS.join(', ')}` })
  }

  return {
    ...body,
    timestamp,
    level: body.level,
  }
}

function getSafeHeaders(event: IngestEvent): Record<string, string> {
  const allHeaders = getHeaders(event as Parameters<typeof getHeaders>[0])
  return filterSafeHeaders(allHeaders)
}

interface WaitUntilHost {
  waitUntil?: (promise: Promise<unknown>) => void
}

/** Resolve platform waitUntil from Nitro event context (Cloudflare Workers, Vercel Edge). */
function resolveWaitUntilContext(event: unknown): WaitUntilHost | undefined {
  if (!isRecord(event)) return undefined
  const { context } = event
  if (!isRecord(context)) return undefined
  const { cloudflare } = context
  if (isRecord(cloudflare) && isRecord(cloudflare.context)) {
    return cloudflare.context
  }
  return context
}

/**
 * Client log ingestion endpoint.
 *
 * The origin check is CSRF-level protection only: it blocks cross-site browser
 * requests but is trivially satisfied by non-browser clients. Treat ingested
 * events as untrusted input — this endpoint is intentionally unauthenticated.
 */
export default defineEventHandler(async (event) => {
  validateOrigin(event)

  const body = await readJsonBody(event)
  const payload = validatePayload(body)
  const nitroApp = useNitroApp()
  const env = getEnvironment()

  const { service: _clientService, ...sanitizedPayload } = payload

  const wideEvent: WideEvent = {
    ...sanitizedPayload,
    ...env,
    source: 'client',
  }

  const headers = getSafeHeaders(event)
  const request = { method: 'POST' as const, path: event.path }
  const runner = getGlobalPluginRunner()

  if (runner.hasClientLog) {
    runner.runOnClientLog({
      payload,
      request,
      headers,
    })
  }

  if (!shouldSample(payload.level)) {
    setResponseStatus(event, 204)
    return null
  }

  const enrichCtx = {
    event: wideEvent,
    request,
    headers,
    response: { status: 204 },
  }
  try {
    await nitroApp.hooks.callHook('evlog:enrich', enrichCtx)
  } catch (err) {
    console.error('[evlog] enrich failed:', err)
  }
  if (runner.hasEnrich) {
    await runner.runEnrich(enrichCtx)
  }

  const drainCtx = {
    event: wideEvent,
    request,
    headers,
  }
  const drainTasks: Array<Promise<unknown>> = [
    nitroApp.hooks.callHook('evlog:drain', drainCtx).catch((err) => {
      console.error('[evlog] drain failed:', err)
    }),
  ]
  if (runner.hasDrain) {
    drainTasks.push(runner.runDrain(drainCtx))
  }
  const drainPromise = Promise.all(drainTasks)

  // Use waitUntil if available (Cloudflare Workers, Vercel Edge)
  // Otherwise, await the drain to prevent lost logs in serverless environments
  const waitUntilCtx = resolveWaitUntilContext(event)
  if (typeof waitUntilCtx?.waitUntil === 'function') {
    waitUntilCtx.waitUntil(drainPromise)
  } else {
    await drainPromise
  }

  setResponseStatus(event, 204)
  return null
})
