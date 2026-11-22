import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { auditOnly } from '../../src/audit'
import { createRequestLogger, initLogger } from '../../src/logger'
import { buildAuditFields } from '../../src/shared/audit-fields'
import type { AuditFields, DrainContext } from '../../src/types'
import {
  AUDIT_WEBHOOK_TYPE,
  WebhookVerificationError,
  createWebhookDrain,
  generateWebhookSecret,
  sendAuditWebhook,
  signWebhook,
  verifyWebhook,
} from '../../src/adapters/webhook'
import { defined } from '../helpers/defined'
import { getFetchCall, getFetchHeaders, mockFetch } from '../helpers/fetch'
import { makeWideEvent } from '../helpers/events'

const URL = 'https://siem.example.com/evlog'

function auditEvent(record: AuditFields): DrainContext {
  return { event: makeWideEvent({ audit: record }) }
}

function record(action: string): AuditFields {
  return buildAuditFields({ action, actor: { type: 'user', id: 'usr_alice', email: 'alice@acme.com' }, tenantId: 'team_7' })
}

/** The body and headers of the n-th POST, as a receiver gets them. */
function delivery(spy: ReturnType<typeof mockFetch>, index = 0): { body: string, headers: Record<string, string> } {
  const { init } = getFetchCall(spy, index)
  return { body: String(init.body), headers: getFetchHeaders(spy, index) }
}

describe('webhook adapter', () => {
  let secret: string
  let fetchSpy: ReturnType<typeof mockFetch>

  beforeEach(() => {
    secret = generateWebhookSecret()
    fetchSpy = mockFetch(new Response(null, { status: 204 }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  describe('signWebhook', () => {
    it('matches the Standard Webhooks reference vector', async () => {
      const headers = await signWebhook(
        'msg_p5jXN8AQM9LWM0D4loKWxJek',
        '{"test": 2432232314}',
        'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
        new Date(1614265330 * 1000),
      )
      expect(headers).toEqual({
        'webhook-id': 'msg_p5jXN8AQM9LWM0D4loKWxJek',
        'webhook-timestamp': '1614265330',
        'webhook-signature': 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
      })
    })

    it('signs once per secret during a rotation', async () => {
      const previous = generateWebhookSecret()
      const both = await signWebhook('msg_1', '{}', [secret, previous])
      const [current, old] = both['webhook-signature'].split(' ')
      expect(current).toBe((await signWebhook('msg_1', '{}', secret, new Date(Number(both['webhook-timestamp']) * 1000)))['webhook-signature'])
      expect(old).toMatch(/^v1,[A-Za-z0-9+/]{43}=$/)
      expect(old).not.toBe(current)
    })

    it('refuses a secret without the whsec_ prefix', async () => {
      await expect(signWebhook('msg_1', '{}', 'MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw')).rejects.toThrow('must start with `whsec_`')
    })
  })

  describe('generateWebhookSecret', () => {
    it('returns 32 random bytes in base64 after whsec_', () => {
      const a = generateWebhookSecret()
      expect(a).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/)
      expect(atob(a.slice('whsec_'.length))).toHaveLength(32)
      expect(generateWebhookSecret()).not.toBe(a)
    })
  })

  describe('createWebhookDrain', () => {
    it('posts one signed message per audit record and skips other events', async () => {
      const first = record('member.add')
      const second = record('team.rename')
      const drain = createWebhookDrain({ url: URL, secret })

      await drain([auditEvent(first), { event: makeWideEvent({ path: '/api/users' }) }, auditEvent(second)])

      expect(fetchSpy).toHaveBeenCalledTimes(2)
      const sent = [delivery(fetchSpy, 0), delivery(fetchSpy, 1)]
      expect(sent.map(({ headers }) => headers['webhook-id'])).toEqual([first.id, second.id])
      expect(getFetchCall(fetchSpy).url).toBe(URL)
      expect(sent[0]?.headers['Content-Type']).toBe('application/json')
      expect(JSON.parse(defined(sent[0]).body)).toEqual({ type: AUDIT_WEBHOOK_TYPE, timestamp: first.timestamp, data: first })
      for (const [i, { body, headers }] of sent.entries()) {
        expect(await verifyWebhook(body, headers, secret)).toEqual([first, second][i])
      }
    })

    it('stops at the first message the endpoint refuses, so later records are not sent out of order', async () => {
      let calls = 0
      fetchSpy.mockImplementation(() => Promise.resolve(new Response('down', { status: ++calls === 2 ? 503 : 200 })))
      const records = ['a', 'b', 'c'].map(record)

      await expect(sendAuditWebhook(records, { url: URL, secret, retries: 0 })).rejects.toThrow('503')

      expect(fetchSpy).toHaveBeenCalledTimes(2)
      expect(delivery(fetchSpy, 1).headers['webhook-id']).toBe(records[1]?.id)
    })

    it('raw rejects on a refused message without retrying; the drain logs it and resolves', async () => {
      fetchSpy.mockImplementation(() => Promise.resolve(new Response('unavailable', { status: 503 })))

      await expect(createWebhookDrain({ url: URL, secret }).raw(auditEvent(record('a')))).rejects.toThrow('503')
      expect(fetchSpy).toHaveBeenCalledTimes(1)

      await expect(createWebhookDrain({ url: URL, secret, retries: 0 })(auditEvent(record('a')))).resolves.toBeUndefined()
      expect(console.error).toHaveBeenCalledWith('[evlog/webhook] Failed to send events:', expect.objectContaining({ status: 503 }))
    })

    it('reads the url and secret from the environment', async () => {
      vi.stubEnv('EVLOG_WEBHOOK_URL', URL)
      vi.stubEnv('EVLOG_WEBHOOK_SECRET', secret)

      await createWebhookDrain()(auditEvent(record('a')))

      expect(getFetchCall(fetchSpy).url).toBe(URL)
    })

    it('reports a missing url or secret and sends nothing', async () => {
      await createWebhookDrain({ url: URL })(auditEvent(record('a')))

      expect(fetchSpy).not.toHaveBeenCalled()
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[evlog/webhook] Missing url or secret'))
    })

    it('sends the identities the audit store keeps when wrapped in auditOnly', async () => {
      initLogger({ pretty: false, silent: true, redact: true, drain: auditOnly(createWebhookDrain({ url: URL, secret })) })

      await createRequestLogger({ requestId: 'req_1' }).audit({
        action: 'member.invite',
        actor: { type: 'user', id: 'usr_alice', email: 'alice@acme.com' },
        metadata: { password: 'hunter2' },
      })

      const { body, headers } = delivery(fetchSpy)
      const received = await verifyWebhook(body, headers, secret)
      expect(received.actor.email).toBe('alice@acme.com')
      expect(received.metadata?.password).not.toBe('hunter2')
    })
  })

  describe('verifyWebhook', () => {
    async function signed(data = record('a'), at = new Date()) {
      const body = JSON.stringify({ type: AUDIT_WEBHOOK_TYPE, timestamp: data.timestamp, data })
      return { data, body, headers: await signWebhook(data.id, body, secret, at) }
    }

    it('accepts headers as a Headers instance or a record with any key case', async () => {
      const { data, body, headers } = await signed()
      expect(await verifyWebhook(body, new Headers(headers), secret)).toEqual(data)
      const upper = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toUpperCase(), v]))
      expect(await verifyWebhook(body, upper, secret)).toEqual(data)
    })

    it('accepts either secret during a rotation', async () => {
      const { data, body, headers } = await signed()
      expect(await verifyWebhook(body, headers, [generateWebhookSecret(), secret])).toEqual(data)
    })

    type Message = Awaited<ReturnType<typeof signed>> & { secret?: string }

    const refusals: Array<[string, (m: Message) => Message | Promise<Message>, string]> = [
      ['a tampered body', m => ({ ...m, body: m.body.replace('"a"', '"b"') }), 'No signature matches'],
      ['a wrong secret', m => ({ ...m, secret: generateWebhookSecret() }), 'No signature matches'],
      ['a timestamp older than the tolerance', () => signed(record('a'), new Date(Date.now() - 301_000)), 'outside the tolerance'],
      ['a timestamp too far ahead', () => signed(record('a'), new Date(Date.now() + 301_000)), 'outside the tolerance'],
      ['a missing signature', m => ({ ...m, headers: { ...m.headers, 'webhook-signature': '' } }), 'Missing'],
      ['a signature of another scheme', m => ({ ...m, headers: { ...m.headers, 'webhook-signature': m.headers['webhook-signature'].replace('v1,', 'v2,') } }), 'No signature matches'],
    ]

    it.each(refusals)('refuses %s', async (_name, tamper, message) => {
      const { body, headers, secret: used = secret } = await tamper(await signed())
      const error = await verifyWebhook(body, headers, used).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(WebhookVerificationError)
      expect((error as Error).message).toContain(message)
    })

    it('honors a custom tolerance', async () => {
      const { data, body, headers } = await signed(record('a'), new Date(Date.now() - 600_000))
      expect(await verifyWebhook(body, headers, secret, { tolerance: 900 })).toEqual(data)
    })

    it('refuses a signed message whose webhook-id is not the record id', async () => {
      const data = record('a')
      const body = JSON.stringify({ type: AUDIT_WEBHOOK_TYPE, timestamp: data.timestamp, data })
      const headers = await signWebhook('msg_other', body, secret)
      await expect(verifyWebhook(body, headers, secret)).rejects.toThrow('webhook-id does not match')
    })
  })
})

