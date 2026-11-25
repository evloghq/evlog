/**
 * E2E test for the webhook drain and `relayAudit`.
 *
 * Fully local and needs no credentials, so like the fs suite it runs on every
 * pull request. Records made by `log.audit()` land in an audit store,
 * `relayAudit` forwards each tenant's records to that tenant's endpoint, and a
 * real HTTP server checks every message with `verifyWebhook`, the way a
 * customer's receiver does.
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { auditOnly, relayAudit } from '../../src/audit'
import { createRequestLogger, initLogger } from '../../src/logger'
import type { AuditFields } from '../../src/types'
import { generateWebhookSecret, sendAuditWebhook, verifyWebhook } from '../../src/adapters/webhook'

interface Receiver {
  url: string
  /** Records accepted, each once, in the order they arrived. */
  records: AuditFields[]
  /** Every POST, redeliveries and refusals included. */
  posts: number
  /** Answer 503 to the POST with this 1-based number. */
  refusePost?: number
  close: () => Promise<void>
}

const receivers: Receiver[] = []

async function startReceiver(secret: string | string[]): Promise<Receiver> {
  const seen = new Set<string>()
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    receiver.posts++
    if (receiver.posts === receiver.refusePost) {
      res.writeHead(503).end()
      return
    }
    try {
      const record = await verifyWebhook(Buffer.concat(chunks).toString('utf8'), req.headers, secret)
      if (!seen.has(record.id)) {
        seen.add(record.id)
        receiver.records.push(record)
      }
      res.writeHead(204).end()
    } catch {
      res.writeHead(401).end()
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const receiver: Receiver = {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/audit`,
    records: [],
    posts: 0,
    close: () => new Promise(resolve => server.close(() => resolve())),
  }
  receivers.push(receiver)
  return receiver
}

/** The app's audit store: one row per record, `seq` playing the role of a bigint primary key. */
let rows: Array<{ seq: number, record: AuditFields }>
/** What a vendor drain received, to compare its redaction with the store's. */
let vendor: AuditFields[]

interface Destination {
  tenantId: string
  url: string
  secret: string | string[]
  cursor: number | undefined
}

function relay(destination: Destination) {
  return relayAudit<number>({
    cursor: destination.cursor,
    read: (after, limit) => Promise.resolve(rows
      .filter(row => row.record.tenantId === destination.tenantId && row.seq > (after ?? 0))
      .slice(0, limit)
      .map(row => ({ cursor: row.seq, record: row.record }))),
    send: records => sendAuditWebhook(records, { url: destination.url, secret: destination.secret, retries: 0 }),
    save: (next) => {
      destination.cursor = next
      return Promise.resolve()
    },
    limit: 2,
  })
}

const actor = { type: 'user', id: 'usr_42', email: 'ada@example.com' } as const

beforeEach(() => {
  rows = []
  vendor = []
  initLogger({
    env: { service: 'evlog-e2e', environment: 'test' },
    silent: true,
    redact: true,
    drain: async (ctx) => {
      if (ctx.event.audit) vendor.push(ctx.event.audit)
      await auditOnly(({ event }) => {
        rows.push({ seq: rows.length + 1, record: event.audit! })
      })(ctx)
    },
  })
})

afterEach(async () => {
  await Promise.all(receivers.splice(0).map(receiver => receiver.close()))
})

describe('webhook e2e (store, relay, receiver)', () => {
  it('delivers each tenant only its records, in the order they were stored, with the identities the store keeps', async () => {
    const log = createRequestLogger({ method: 'POST', path: '/api/members', requestId: 'req_e2e' })
    for (const [tenantId, action] of [['team_a', 'member.add'], ['team_b', 'member.add'], ['team_a', 'team.rename'], ['team_a', 'member.remove'], ['team_b', 'token.create']]) {
      await log.audit({ action, actor, target: { type: 'team', id: tenantId }, tenantId })
    }
    log.emit()

    const secretA = generateWebhookSecret()
    const secretB = generateWebhookSecret()
    const a = await startReceiver(secretA)
    const b = await startReceiver(secretB)
    const destinationA: Destination = { tenantId: 'team_a', url: a.url, secret: secretA, cursor: undefined }
    const destinationB: Destination = { tenantId: 'team_b', url: b.url, secret: secretB, cursor: undefined }

    expect(await relay(destinationA)).toEqual({ cursor: 4, delivered: 3 })
    expect(await relay(destinationB)).toEqual({ cursor: 5, delivered: 2 })

    expect(a.records.map(r => r.action)).toEqual(['member.add', 'team.rename', 'member.remove'])
    expect(b.records.map(r => r.action)).toEqual(['member.add', 'token.create'])
    expect(a.records.every(r => r.tenantId === 'team_a' && r.context?.requestId === 'req_e2e')).toBe(true)
    expect(b.records.every(r => r.tenantId === 'team_b')).toBe(true)
    const ids = a.records.map(r => r.id)
    expect(ids).toEqual([...ids].sort())
    expect(a.records[0]!.actor.email).toBe('ada@example.com')
    expect(vendor[0]!.actor.email).not.toBe('ada@example.com')

    expect(await relay(destinationA)).toEqual({ cursor: 4, delivered: 0 })
    expect(a.posts).toBe(3)
  })

  it('resumes from the saved cursor after the endpoint fails, and the receiver drops the record sent twice', async () => {
    for (let index = 1; index <= 5; index++) {
      await createRequestLogger().audit({ action: `step.${index}`, actor, tenantId: 'team_a' })
    }
    const secret = generateWebhookSecret()
    const receiver = await startReceiver(secret)
    receiver.refusePost = 4
    const destination: Destination = { tenantId: 'team_a', url: receiver.url, secret, cursor: undefined }

    const failed = await relay(destination)
    expect(failed).toMatchObject({ cursor: 2, delivered: 2 })
    expect(failed.error).toBeInstanceOf(Error)
    expect(destination.cursor).toBe(2)
    expect(receiver.records.map(r => r.action)).toEqual(['step.1', 'step.2', 'step.3'])

    expect(await relay(destination)).toEqual({ cursor: 5, delivered: 3 })
    expect(receiver.records.map(r => r.action)).toEqual(['step.1', 'step.2', 'step.3', 'step.4', 'step.5'])
    // step.3 was accepted, then sent again with its batch; step.4 was refused once.
    expect(receiver.posts).toBe(7)
  })

  it('reaches a receiver that still knows only the old secret during a rotation, and stops at one that knows neither', async () => {
    await createRequestLogger().audit({ action: 'secret.rotate', actor, tenantId: 'team_a' })
    const previous = generateWebhookSecret()
    const next = generateWebhookSecret()

    const rotating = await startReceiver(previous)
    expect(await relay({ tenantId: 'team_a', url: rotating.url, secret: [next, previous], cursor: undefined })).toEqual({ cursor: 1, delivered: 1 })
    expect(rotating.records.map(r => r.action)).toEqual(['secret.rotate'])

    const stranger = await startReceiver(generateWebhookSecret())
    const destination: Destination = { tenantId: 'team_a', url: stranger.url, secret: [next, previous], cursor: undefined }
    const refused = await relay(destination)
    expect(refused.error).toBeInstanceOf(Error)
    expect(destination.cursor).toBeUndefined()
    expect(stranger.records).toEqual([])
  })
})
