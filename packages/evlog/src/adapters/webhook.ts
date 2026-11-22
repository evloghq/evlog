import type { AuditFields, WideEvent } from '../types'
import type { ConfigField } from '../shared/config'
import { formatPublicEnvKeys, resolveAdapterConfig } from '../shared/config'
import { defineDrain } from '../shared/drain'
import { httpPost } from '../shared/http'

/** The `type` of every message the webhook drain sends. */
export const AUDIT_WEBHOOK_TYPE = 'audit.event'

/** How far a `webhook-timestamp` may be from the receiver's clock, as in the Standard Webhooks reference libraries. */
const DEFAULT_TOLERANCE_SECONDS = 5 * 60

const SECRET_PREFIX = 'whsec_'

export interface WebhookConfig {
  /** HTTPS endpoint that receives one POST per audit record. */
  url: string
  /**
   * Standard Webhooks signing secret: `whsec_` followed by base64, as
   * {@link generateWebhookSecret} returns. Pass two during a rotation: every
   * message is signed with each, and the receiver accepts either.
   */
  secret: string | string[]
  /** Extra headers sent with every message, such as a static token the receiver also checks. */
  headers?: Record<string, string>
  /** Request timeout in milliseconds. Default: 5000 */
  timeout?: number
  /** Number of retry attempts on transient failures. Default: 2 */
  retries?: number
}

const WEBHOOK_FIELDS: ConfigField<WebhookConfig>[] = [
  { key: 'url', env: ['NUXT_EVLOG_WEBHOOK_URL', 'EVLOG_WEBHOOK_URL'] },
  { key: 'secret', env: ['NUXT_EVLOG_WEBHOOK_SECRET', 'EVLOG_WEBHOOK_SECRET'] },
  { key: 'headers' },
  { key: 'timeout' },
  { key: 'retries' },
]

/** The JSON body of a message: the Standard Webhooks payload shape with the audit record as `data`. */
export interface AuditWebhookPayload {
  type: typeof AUDIT_WEBHOOK_TYPE
  timestamp: string
  data: AuditFields
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function secretList(secret: string | string[]): string[] {
  return Array.isArray(secret) ? secret : [secret]
}

async function hmac(secret: string, content: string): Promise<string> {
  if (!secret.startsWith(SECRET_PREFIX)) {
    throw new Error(`[evlog/webhook] The secret must start with \`${SECRET_PREFIX}\`; generate one with generateWebhookSecret().`)
  }
  const key = await crypto.subtle.importKey('raw', base64ToBytes(secret.slice(SECRET_PREFIX.length)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return bytesToBase64(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(content))))
}

/**
 * A new signing secret: `whsec_` and 32 random bytes in base64. Show it to the
 * receiver once and store it encrypted; the receiver passes it to
 * {@link verifyWebhook}.
 */
export function generateWebhookSecret(): string {
  return `${SECRET_PREFIX}${bytesToBase64(crypto.getRandomValues(new Uint8Array(32)))}`
}

/**
 * The Standard Webhooks headers for one message: `webhook-id`, `webhook-timestamp`
 * (Unix seconds) and `webhook-signature`, one `v1,<base64 HMAC-SHA256>` per
 * secret, space separated.
 */
export async function signWebhook(id: string, body: string, secret: string | string[], timestamp: Date = new Date()): Promise<Record<string, string>> {
  const seconds = String(Math.floor(timestamp.getTime() / 1000))
  const signatures = await Promise.all(secretList(secret).map(async s => `v1,${await hmac(s, `${id}.${seconds}.${body}`)}`))
  return { 'webhook-id': id, 'webhook-timestamp': seconds, 'webhook-signature': signatures.join(' ') }
}

/**
 * POST each record as its own signed message, in order. `webhook-id` is the
 * record's `id`, so a receiver that stores seen ids drops a redelivery. Stops
 * and throws at the first message the endpoint does not accept with a `2xx`,
 * so the records after it are not sent out of order.
 */
export async function sendAuditWebhook(records: AuditFields[], config: WebhookConfig): Promise<void> {
  for (const record of records) {
    const payload: AuditWebhookPayload = { type: AUDIT_WEBHOOK_TYPE, timestamp: record.timestamp, data: record }
    const body = JSON.stringify(payload)
    await httpPost({
      url: config.url,
      headers: { ...config.headers, 'Content-Type': 'application/json', ...await signWebhook(record.id, body, config.secret) },
      body,
      timeout: config.timeout ?? 5000,
      retries: config.retries,
      label: 'Webhook',
      source: 'webhook',
    })
  }
}

function auditRecords(events: WideEvent[]): AuditFields[] {
  return events.flatMap(event => typeof event.audit?.id === 'string' ? [event.audit] : [])
}

/**
 * Drain that sends each audit record to an endpoint as a signed
 * [Standard Webhooks](https://www.standardwebhooks.com) message. Events
 * without an audit record are skipped.
 *
 * Wrap it in `auditOnly()` to send the record with the identities it keeps,
 * or build one per tenant with overrides for customer destinations.
 *
 * @example
 * ```ts
 * import { auditOnly } from 'evlog'
 * import { createWebhookDrain } from 'evlog/webhook'
 *
 * nitroApp.hooks.hook('evlog:drain', auditOnly(createWebhookDrain({
 *   url: 'https://siem.example.com/evlog',
 *   secret: process.env.AUDIT_WEBHOOK_SECRET,
 * })))
 * ```
 */
export function createWebhookDrain(overrides?: Partial<WebhookConfig>) {
  return defineDrain<WebhookConfig>({
    name: 'webhook',
    resolve: async () => {
      const config = await resolveAdapterConfig<WebhookConfig>('webhook', WEBHOOK_FIELDS, overrides)
      if (!config.url || !config.secret) {
        console.error(`[evlog/webhook] Missing url or secret. Set ${formatPublicEnvKeys(['EVLOG_WEBHOOK_URL'], ['EVLOG_WEBHOOK_SECRET'])}, or pass them to createWebhookDrain()`)
        return null
      }
      return config as WebhookConfig
    },
    send: (events, config) => sendAuditWebhook(auditRecords(events), config),
    // The caller of `raw` (a pipeline, a relay) owns retries.
    rawSend: (events, config) => sendAuditWebhook(auditRecords(events), { ...config, retries: config.retries ?? 0 }),
  })
}

/** Thrown by {@link verifyWebhook} when a message is unsigned, stale or tampered with. */
export class WebhookVerificationError extends Error {

  constructor(message: string) {
    super(message)
    this.name = 'WebhookVerificationError'
  }

}

type HeaderSource = Headers | Record<string, string | string[] | undefined>

function readHeader(headers: HeaderSource, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  const value = headers[name] ?? Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1]
  return Array.isArray(value) ? value[0] : value
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Options for {@link verifyWebhook}. */
export interface VerifyWebhookOptions {
  /** Largest gap between `webhook-timestamp` and now, in seconds. @default 300 */
  tolerance?: number
}

/**
 * Check a message from {@link createWebhookDrain} and return its audit record.
 * Pass the raw body exactly as received: parsing and re-serializing it breaks
 * the signature. Pass every secret still valid during a rotation.
 *
 * Throws {@link WebhookVerificationError} when a header is missing, the
 * timestamp is further than `tolerance` from now, or no signature matches.
 * Dedupe on the returned `id`: delivery is at least once.
 *
 * @example
 * ```ts
 * import { verifyWebhook } from 'evlog/webhook'
 *
 * export default defineEventHandler(async (event) => {
 *   const record = await verifyWebhook(await readRawBody(event) ?? '', getHeaders(event), process.env.AUDIT_WEBHOOK_SECRET!)
 *   await db.insert(auditCopy).values({ id: record.id, data: record }).onConflictDoNothing()
 *   return null
 * })
 * ```
 */
export async function verifyWebhook(body: string, headers: HeaderSource, secret: string | string[], options: VerifyWebhookOptions = {}): Promise<AuditFields> {
  const id = readHeader(headers, 'webhook-id')
  const timestamp = readHeader(headers, 'webhook-timestamp')
  const signature = readHeader(headers, 'webhook-signature')
  if (!id || !timestamp || !signature) throw new WebhookVerificationError('Missing webhook-id, webhook-timestamp or webhook-signature header')

  const seconds = Number(timestamp)
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE_SECONDS
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - seconds) > tolerance) {
    throw new WebhookVerificationError('Timestamp is outside the tolerance window')
  }

  const received = signature.split(' ').flatMap(entry => entry.startsWith('v1,') ? [entry.slice(3)] : [])
  const expected = await Promise.all(secretList(secret).map(s => hmac(s, `${id}.${timestamp}.${body}`)))
  if (!expected.some(e => received.some(r => timingSafeEqual(e, r)))) {
    throw new WebhookVerificationError('No signature matches')
  }

  const payload = JSON.parse(body) as AuditWebhookPayload
  if (payload.data?.id !== id) throw new WebhookVerificationError('webhook-id does not match the record id')
  return payload.data
}
