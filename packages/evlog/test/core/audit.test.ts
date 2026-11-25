import type { Mock } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import {
  AUDIT_SCHEMA_VERSION,
  AuditDeniedError,
  audit,
  auditDiff,
  auditEnricher,
  auditOnly,
  auditRedactPreset,
  buildAuditFields,
  defineAuditAction,
  mockAudit,
  relayAudit,
  signed,
  withAudit,
  withAuditMethods,
} from '../../src/audit'
import type { RelayAuditEntry } from '../../src/audit'
import type { AuditActor, AuditFields, DrainContext, EnrichContext, WideEvent } from '../../src/types'
import { createLogger, createRequestLogger, initLogger } from '../../src/logger'
import { createDrainPipeline } from '../../src/pipeline'
import { composeDrains } from '../../src/shared/compose'
import { definePlugin } from '../../src/shared/plugin'
import { redactEvent, resolveRedactConfig } from '../../src/redact'
import { defined } from '../helpers/defined'
import { flushMicrotasks } from '../helpers/timers'

type DrainSpy = Mock<(ctx: DrainContext) => Promise<void>>

const UUID_V7 = /^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/

const alice: AuditActor = { type: 'user', id: 'usr_alice', email: 'alice@acme.com' }

function createDrainCtx(event: Partial<WideEvent> = {}): DrainContext {
  const wide: WideEvent = {
    timestamp: new Date('2026-04-24T12:00:00.000Z').toISOString(),
    level: 'info',
    service: 'test',
    environment: 'test',
    ...event,
  }
  return { event: wide }
}

function createEnrichCtx(event: Partial<WideEvent> = {}): EnrichContext {
  return {
    event: {
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'test',
      environment: 'test',
      ...event,
    },
  }
}

/** A record with a fixed `id` and `timestamp`, for wrappers whose output depends on them. */
function record(overrides: Partial<AuditFields> = {}): AuditFields {
  return {
    id: '019a5c2e-0000-7000-8000-000000000000',
    timestamp: '2026-04-24T12:00:00.000Z',
    action: 'a',
    actor: { type: 'user', id: 'u1' },
    outcome: 'success',
    version: AUDIT_SCHEMA_VERSION,
    ...overrides,
  }
}

function captureDrain(): DrainSpy {
  return vi.fn<(ctx: DrainContext) => Promise<void>>(async () => {})
}

/** The events a drain received, in the order it received them. */
function drained(drain: DrainSpy): WideEvent[] {
  return drain.mock.calls.map(([ctx]) => ctx.event)
}

function drainedAudits(drain: DrainSpy): AuditFields[] {
  return drained(drain).flatMap(event => event.audit ? [event.audit] : [])
}

function gate(): { open: () => void, wait: Promise<void> } {
  let open!: () => void
  const wait = new Promise<void>((resolve) => {
    open = resolve
  })
  return { open, wait }
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  initLogger({ pretty: false, redact: false })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('buildAuditFields', () => {
  it('fills id, timestamp, outcome and version, and keeps tenant and metadata', () => {
    const fields = buildAuditFields({
      action: 'invoice.refund',
      actor: { type: 'user', id: 'u1' },
      tenantId: 'org_1',
      metadata: { amount: 100 },
    })
    expect(fields.id).toMatch(UUID_V7)
    expect(Number.isNaN(Date.parse(fields.timestamp))).toBe(false)
    expect(fields).toMatchObject({ outcome: 'success', version: AUDIT_SCHEMA_VERSION, tenantId: 'org_1', metadata: { amount: 100 } })
    expect(AUDIT_SCHEMA_VERSION).toBe(2)
  })

  it('preserves an explicit outcome', () => {
    expect(buildAuditFields({ action: 'x', actor: { type: 'system', id: 'cron' }, outcome: 'failure' }).outcome).toBe('failure')
  })

  it('orders ids by creation within one millisecond, past the per-millisecond counter, and across a clock step back', () => {
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    const input = { action: 'variables.read', actor: alice }
    const ids = Array.from({ length: 5000 }, () => buildAuditFields(input).id)
    clock.mockReturnValue(now - 60_000)
    ids.push(...Array.from({ length: 10 }, () => buildAuditFields(input).id))

    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.toSorted()).toEqual(ids)
    expect(ids.every(id => UUID_V7.test(id))).toBe(true)
    expect(Number.parseInt(defined(ids[0]).replaceAll('-', '').slice(0, 12), 16)).toBe(now)
  })
})

describe('log.audit()', () => {
  it('emits each call as its own event, in call order, tied to the request', async () => {
    const drain = captureDrain()
    initLogger({ pretty: false, redact: false, drain, env: { service: 'teams-api' } })
    const log = createRequestLogger({ method: 'POST', path: '/api/teams/7/members', requestId: 'req_1' })

    await log.audit({
      action: 'member.add',
      actor: alice,
      target: { type: 'user', id: 'usr_bob', email: 'bob@acme.com' },
      tenantId: 'team_7',
    })
    await log.audit({ action: 'team.rename', actor: alice, target: { type: 'team', id: 'team_7' }, tenantId: 'team_7' })
    log.set({ status: 200 })
    log.emit()

    const [first, second, requestEvent] = drained(drain)
    expect(drain).toHaveBeenCalledTimes(3)
    expect(defined(first).audit).toMatchObject({
      action: 'member.add',
      actor: alice,
      target: { type: 'user', id: 'usr_bob', email: 'bob@acme.com' },
      tenantId: 'team_7',
      context: { requestId: 'req_1' },
    })
    expect(defined(defined(second).audit).target).toEqual({ type: 'team', id: 'team_7' })
    expect(defined(defined(first).audit).id < defined(defined(second).audit).id).toBe(true)
    for (const event of [first, second]) {
      expect(event).toMatchObject({ level: 'info', service: 'teams-api', requestId: 'req_1', method: 'POST', path: '/api/teams/7/members' })
    }
    expect(defined(requestEvent)).toMatchObject({ requestId: 'req_1', status: 200 })
    expect(defined(requestEvent).audit).toBeUndefined()
  })

  it('keeps call order in the ids when the drains of concurrent calls finish in reverse', async () => {
    const arrived: AuditFields[] = []
    initLogger({
      pretty: false,
      redact: false,
      drain: async ({ event }) => {
        const audited = defined(event.audit)
        await flushMicrotasks(40 - Number(audited.action.split('.')[1]))
        arrived.push(audited)
      },
    })
    const log = createRequestLogger({ requestId: 'req_concurrent' })

    await Promise.all(Array.from({ length: 20 }, (_, i) => log.audit({ action: `step.${i}`, actor: alice })))

    expect(arrived.map(r => r.action)).toEqual(Array.from({ length: 20 }, (_, i) => `step.${19 - i}`))
    expect(arrived.toSorted((a, b) => a.id.localeCompare(b.id)).map(r => r.action))
      .toEqual(Array.from({ length: 20 }, (_, i) => `step.${i}`))
  })

  it('resolves once the drain has stored the record', async () => {
    const stored: AuditFields[] = []
    const db = gate()
    initLogger({
      pretty: false,
      redact: false,
      drain: async ({ event }) => {
        await db.wait
        stored.push(defined(event.audit))
      },
    })
    let resolved = false
    const pending = createLogger().audit({ action: 'token.create', actor: alice }).then(() => {
      resolved = true
    })

    await flushMicrotasks(10)
    expect(resolved).toBe(false)
    db.open()
    await pending
    expect(stored.map(r => r.action)).toEqual(['token.create'])
  })

  it('does not reject when a drain fails, and the other drains still receive the record', async () => {
    const stored: AuditFields[] = []
    initLogger({
      pretty: false,
      redact: false,
      drain: () => {
        throw new Error('database is down')
      },
      plugins: [
        definePlugin({
          name: 'second-store',
          drain: ({ event }) => {
            stored.push(defined(event.audit))
          },
        })
      ],
    })

    await expect(createLogger().audit({ action: 'token.create', actor: alice })).resolves.toBeUndefined()
    expect(stored.map(r => r.action)).toEqual(['token.create'])
    expect(console.error).toHaveBeenCalledWith('[evlog] drain failed:', expect.objectContaining({ message: 'database is down' }))
  })

  it('is not sampled, discarded or held back by the minLevel floor', async () => {
    const drain = captureDrain()
    initLogger({ pretty: false, redact: false, drain, sampling: { rates: { info: 0, warn: 0 }, minLevel: 'warn' } })
    const log = createRequestLogger({ requestId: 'req_sampled' })
    log.discard()

    await log.audit({ action: 'variables.read', actor: alice })
    await log.audit.deny('Missing team:admin', { action: 'team.delete', actor: alice, target: { type: 'team', id: 'team_7' } })
    log.emit()

    expect(drained(drain).map(e => [e.audit?.action, e.audit?.outcome, e.audit?.reason, e.level])).toEqual([
      ['variables.read', 'success', undefined, 'info'],
      ['team.delete', 'denied', 'Missing team:admin', 'warn'],
    ])
  })

  it('still records after the request event was emitted', async () => {
    const drain = captureDrain()
    initLogger({ pretty: false, redact: false, drain })
    const log = createRequestLogger({ requestId: 'req_late' })
    log.emit()

    await log.audit({ action: 'export.finish', actor: { type: 'system', id: 'exporter' } })

    expect(drainedAudits(drain)).toEqual([expect.objectContaining({ action: 'export.finish', context: { requestId: 'req_late' } })])
  })

  it('does nothing while logging is disabled', async () => {
    const drain = captureDrain()
    initLogger({ enabled: false, drain })
    await expect(createLogger().audit({ action: 'x', actor: alice })).resolves.toBeUndefined()
    expect(drain).not.toHaveBeenCalled()
  })

  it('hands a delivery nobody awaits to the request waitUntil', async () => {
    const db = gate()
    const drain = vi.fn<(ctx: DrainContext) => Promise<void>>(() => db.wait)
    initLogger({ pretty: false, redact: false, drain })
    const waitUntil = vi.fn<(promise: Promise<unknown>) => void>()
    const log = createRequestLogger({ requestId: 'req_bg', waitUntil })

    void log.audit({ action: 'variables.read', actor: alice })

    expect(waitUntil).toHaveBeenCalledOnce()
    let settled = false
    void defined(waitUntil.mock.calls[0])[0].then(() => {
      settled = true
    })
    await flushMicrotasks(10)
    expect(settled).toBe(false)
    db.open()
    await vi.waitFor(() => expect(settled).toBe(true))
    expect(drain).toHaveBeenCalledOnce()
  })
})

describe('audit()', () => {
  it('drains one event with no request context', async () => {
    const drain = captureDrain()
    initLogger({ pretty: false, redact: false, drain })

    await expect(audit({ action: 'cron.cleanup', actor: { type: 'system', id: 'cron' } })).resolves.toBeUndefined()

    const [event] = drained(drain)
    expect(defined(event).audit).toMatchObject({ action: 'cron.cleanup', outcome: 'success' })
    expect(defined(event).audit?.context).toBeUndefined()
    expect(defined(event).requestId).toBeUndefined()
  })

  it('is kept alive with the Vercel runtime waitUntil when nobody awaits it', async () => {
    const contextKey = Symbol.for('@vercel/request-context')
    const waitUntil = vi.fn<(promise: Promise<unknown>) => void>()
    ;(globalThis as Record<symbol, unknown>)[contextKey] = { get: () => ({ waitUntil }) }
    onTestFinished(() => {
      delete (globalThis as Record<symbol, unknown>)[contextKey]
    })
    const drain = captureDrain()
    initLogger({ pretty: false, redact: false, drain })

    void audit({ action: 'cron.cleanup', actor: { type: 'system', id: 'cron' } })

    expect(waitUntil).toHaveBeenCalledOnce()
    await defined(waitUntil.mock.calls[0])[0]
    expect(drain).toHaveBeenCalledOnce()
  })
})

describe('tenants', () => {
  it('records one event per tenant and routes each to its tenant store', async () => {
    const stores = new Map<string, AuditFields[]>()
    initLogger({
      pretty: false,
      redact: false,
      drain: auditOnly(({ event }) => {
        const stored = defined(event.audit)
        const tenant = defined(stored.tenantId)
        stores.set(tenant, [...stores.get(tenant) ?? [], stored])
      }),
    })
    const token: AuditActor = { type: 'api', id: 'tok_12', onBehalfOf: { type: 'user', id: 'usr_alice' } }
    const log = createRequestLogger({ requestId: 'req_teams' })

    await Promise.all(['team_1', 'team_2', 'team_3'].map(tenantId =>
      log.audit({ action: 'token.create', actor: token, target: { type: 'token', id: 'tok_99' }, tenantId })))

    expect([...stores.keys()].toSorted()).toEqual(['team_1', 'team_2', 'team_3'])
    const records = [...stores.values()].flat()
    expect(records).toHaveLength(3)
    expect(new Set(records.map(r => r.id)).size).toBe(3)
    for (const [tenant, [stored]] of stores) {
      expect(stored).toMatchObject({ tenantId: tenant, actor: token, context: { requestId: 'req_teams' } })
    }
  })

  it('auditEnricher fills the tenant only when the call left it empty', async () => {
    const drain = captureDrain()
    initLogger({
      pretty: false,
      redact: false,
      drain,
      plugins: [definePlugin({ name: 'tenant', enrich: auditEnricher({ tenantId: () => 'team_from_session' }) })],
    })
    const log = createRequestLogger({ requestId: 'req_tenant' })

    await log.audit({ action: 'variables.read', actor: alice })
    await log.audit({ action: 'variables.read', actor: alice, tenantId: 'team_explicit' })

    expect(drainedAudits(drain).map(r => r.tenantId)).toEqual(['team_from_session', 'team_explicit'])
  })

  it('auditEnricher leaves events without an audit record alone', () => {
    const ctx = createEnrichCtx()
    auditEnricher({ tenantId: () => 'team_1' })(ctx)
    expect(ctx.event.audit).toBeUndefined()
  })
})

describe('duplicates', () => {
  it('gives the same action made twice two records', async () => {
    const drain = captureDrain()
    initLogger({ pretty: false, redact: false, drain })
    const log = createRequestLogger({ requestId: 'req_twice' })
    const read = { action: 'variables.read', actor: alice, target: { type: 'environment', id: 'env_1' }, tenantId: 'team_7' }

    await log.audit(read)
    await log.audit(read)

    const [first, second] = drainedAudits(drain)
    expect(defined(first).id).not.toBe(defined(second).id)
  })

  it('resends the same id when a pipeline retries, so a store keyed on it keeps one row', async () => {
    const rows = new Map<string, AuditFields>()
    const attempts: string[] = []
    const pipeline = createDrainPipeline<DrainContext>({ batch: { size: 1 }, retry: { maxAttempts: 2, initialDelayMs: 0 } })
    const store = pipeline((batch) => {
      for (const { event } of batch) {
        const stored = defined(event.audit)
        attempts.push(stored.id)
        rows.set(stored.id, stored)
      }
      if (attempts.length === 1) throw new Error('timeout after commit')
    })
    initLogger({ pretty: false, redact: false, drain: auditOnly(store) })

    await createLogger().audit({ action: 'token.create', actor: alice, tenantId: 'team_7' })
    await store.flush()

    expect(attempts).toHaveLength(2)
    expect(attempts[0]).toBe(attempts[1])
    expect(rows.size).toBe(1)
  })
})

describe('redaction', () => {
  it('keeps emails and IPs for the auditOnly store, masks them for other drains and stdout, and masks secrets for both', async () => {
    const vendor: WideEvent[] = []
    const store: AuditFields[] = []
    initLogger({
      pretty: false,
      stringify: true,
      redact: true,
      drain: composeDrains([
        ({ event }) => {
          vendor.push(event)
        },
        auditOnly(({ event }) => {
          store.push(defined(event.audit))
        }),
      ]),
    })

    await createRequestLogger({ requestId: 'req_pii' }).audit({
      action: 'member.invite',
      actor: alice,
      target: { type: 'user', id: 'usr_bob', email: 'bob@acme.com' },
      tenantId: 'team_7',
      metadata: { ip: '203.0.113.9', password: 'hunter2', card: '4111 1111 1111 1111' },
    })

    const [kept] = store
    expect(defined(kept)).toMatchObject({
      actor: { email: 'alice@acme.com' },
      target: { email: 'bob@acme.com' },
      metadata: { ip: '203.0.113.9', card: '****1111' },
    })
    expect(defined(kept).metadata?.password).not.toBe('hunter2')

    const masked = defined(defined(vendor[0]).audit)
    expect(masked).toMatchObject({
      id: defined(kept).id,
      actor: { email: 'a***@***.com' },
      target: { email: 'b***@***.com' },
      metadata: { ip: '***.***.***.9', card: '****1111' },
    })
    expect(masked.metadata?.password).not.toBe('hunter2')

    const stdout = JSON.stringify(vi.mocked(console.info).mock.calls)
    expect(stdout).toContain('a***@***.com')
    expect(stdout).not.toContain('alice@acme.com')
    expect(stdout).not.toContain('203.0.113.9')
  })
})

describe('auditOnly()', () => {
  it('skips events that are not audit records made in this process', async () => {
    const sink = vi.fn<(ctx: DrainContext) => Promise<void>>(async () => {})
    const store = auditOnly(sink)

    await store(createDrainCtx())
    await store(createDrainCtx({ audit: record() }))

    expect(sink).not.toHaveBeenCalled()
  })

  it('routes audit records to the store and every event to the main drain', async () => {
    const main = captureDrain()
    const sink = captureDrain()
    initLogger({ pretty: false, redact: false, drain: composeDrains([main, auditOnly(sink)]) })

    const log = createLogger()
    await log.audit({ action: 'x', actor: alice })
    log.emit()

    expect(drained(main).map(e => e.audit?.action)).toEqual(['x', undefined])
    expect(drainedAudits(sink).map(r => r.action)).toEqual(['x'])
  })
})

describe('withAudit()', () => {
  it('records success with the tenant once fn resolves, before it returns', async () => {
    const drain = captureDrain()
    initLogger({ pretty: false, redact: false, drain })
    const refund = withAudit(
      { action: 'invoice.refund', target: (input: { id: string }) => ({ type: 'invoice', id: input.id }) },
      (input: { id: string }) => `refunded ${input.id}`,
    )

    await expect(refund({ id: 'inv_1' }, { actor: alice, tenantId: 'org_1' })).resolves.toBe('refunded inv_1')

    expect(drainedAudits(drain)).toEqual([
      expect.objectContaining({
        action: 'invoice.refund',
        outcome: 'success',
        tenantId: 'org_1',
        target: { type: 'invoice', id: 'inv_1' },
      })
    ])
  })

  it('records denied when fn throws AuditDeniedError', async () => {
    const collector = mockAudit()
    const fn = withAudit({ action: 'x' }, () => {
      throw new AuditDeniedError('not allowed')
    })
    await expect(fn(null, { actor: { type: 'user', id: 'u1' } })).rejects.toThrow('not allowed')
    const denied = defined(collector.events[0], 'audit event')
    expect(denied.outcome).toBe('denied')
    expect(denied.reason).toBe('not allowed')
    collector.restore()
  })

  it('records denied when fn throws a 403-status error', async () => {
    const collector = mockAudit()
    const fn = withAudit({ action: 'x' }, () => {
      const err = new Error('forbidden') as Error & { status: number }
      err.status = 403
      throw err
    })
    await expect(fn(null, { actor: { type: 'user', id: 'u1' } })).rejects.toThrow('forbidden')
    expect(defined(collector.events[0], 'audit event').outcome).toBe('denied')
    collector.restore()
  })

  it('records failure for other thrown errors', async () => {
    const collector = mockAudit()
    const fn = withAudit({ action: 'x' }, () => {
      throw new Error('boom')
    })
    await expect(fn(null, { actor: { type: 'user', id: 'u1' } })).rejects.toThrow('boom')
    const recorded = defined(collector.events[0], 'audit event')
    expect(recorded.outcome).toBe('failure')
    expect(recorded.reason).toBe('boom')
    collector.restore()
  })
})

describe('mockAudit()', () => {
  it('captures standalone audit() calls', async () => {
    const captured = mockAudit()
    await audit({ action: 'a', actor: { type: 'system', id: 's' } })
    expect(captured.events).toHaveLength(1)
    expect(captured.toIncludeAuditOf({ action: 'a' })).toBe(true)
    expect(captured.toIncludeAuditOf({ action: 'missing' })).toBe(false)
    captured.restore()
  })

  it('captures each log.audit() record when it is made, with its id', () => {
    const captured = mockAudit()
    const log = createRequestLogger({ requestId: 'req_mock' })
    void log.audit({ action: 'member.add', actor: alice, tenantId: 'team_1' })
    void log.audit.deny('Insufficient permissions', { action: 'invoice.refund', actor: alice, tenantId: 'team_2' })

    expect(captured.events.map(e => [e.action, e.outcome, e.tenantId])).toEqual([
      ['member.add', 'success', 'team_1'],
      ['invoice.refund', 'denied', 'team_2'],
    ])
    expect(defined(captured.events[0]).id).toMatch(UUID_V7)
    expect(captured.assertAudit({ tenantId: 'team_2' }).reason).toBe('Insufficient permissions')
    captured.restore()
  })

  it('matcher supports regex actions', async () => {
    const captured = mockAudit()
    await audit({ action: 'invoice.refund', actor: { type: 'system', id: 's' } })
    expect(captured.toIncludeAuditOf({ action: /^invoice\./ })).toBe(true)
    captured.restore()
  })

  it('assertAudit returns the matched event or throws', async () => {
    const captured = mockAudit()
    await audit({ action: 'invoice.refund', actor: { type: 'user', id: 'u1' }, outcome: 'success' })
    const match = captured.assertAudit({ action: 'invoice.refund', outcome: 'success' })
    expect(match.action).toBe('invoice.refund')
    expect(() => captured.assertAudit({ action: 'missing' })).toThrow(/No audit event matched/)
    captured.restore()
  })
})

describe('auditDiff()', () => {
  it('produces a JSON Patch with replace operations', () => {
    const diff = auditDiff({ amount: 100, currency: 'USD' }, { amount: 200, currency: 'USD' })
    expect(diff.patch).toEqual([{ op: 'replace', path: '/amount', value: 200 },])
  })

  it('redacts paths matching key names', () => {
    const diff = auditDiff(
      { user: { name: 'A', password: 'old' } },
      { user: { name: 'B', password: 'new' } },
      { redactPaths: ['password'] },
    )
    expect(diff.patch).toContainEqual({ op: 'replace', path: '/user/name', value: 'B' })
    expect(diff.patch).toContainEqual({ op: 'replace', path: '/user/password', value: '[REDACTED]' })
  })

  it('redacts exact dotted paths without matching other branches', () => {
    const diff = auditDiff(
      { user: { password: 'old' }, admin: { password: 'secret' } },
      { user: { password: 'new' }, admin: { password: 'secret' } },
      { redactPaths: ['user.password'] },
    )
    expect(diff.patch).toContainEqual({ op: 'replace', path: '/user/password', value: '[REDACTED]' })
    expect(diff.patch).not.toContainEqual({ op: 'replace', path: '/admin/password', value: '[REDACTED]' })
  })

  it('preserves non-plain objects in snapshots', () => {
    const before = { at: new Date('2026-01-01T00:00:00.000Z') }
    const after = { at: new Date('2026-06-01T00:00:00.000Z') }
    const diff = auditDiff(before, after, { includeBefore: true, includeAfter: true })
    expect((diff.before as { at: Date }).at).toBeInstanceOf(Date)
    expect((diff.after as { at: Date }).at).toBeInstanceOf(Date)
  })

  it('emits add and remove operations', () => {
    const diff = auditDiff({ a: 1 }, { b: 2 })
    expect(diff.patch).toEqual(expect.arrayContaining([
      { op: 'remove', path: '/a' },
      { op: 'add', path: '/b', value: 2 },
    ]))
  })

  it('replaces a changed Date and ignores a Date with the same timestamp', () => {
    expect(auditDiff(
      { expiresAt: new Date('2026-01-01T00:00:00.000Z') },
      { expiresAt: new Date('2027-01-01T00:00:00.000Z') },
    ).patch).toEqual([{ op: 'replace', path: '/expiresAt', value: new Date('2027-01-01T00:00:00.000Z') }])
    expect(auditDiff(
      { expiresAt: new Date('2026-01-01T00:00:00.000Z') },
      { expiresAt: new Date('2026-01-01T00:00:00.000Z') },
    ).patch).toEqual([])
  })

  it('replaces changed Set, Map and RegExp values and ignores equal ones', () => {
    expect(auditDiff({ tags: new Set(['a']) }, { tags: new Set(['a', 'b']) }).patch)
      .toEqual([{ op: 'replace', path: '/tags', value: new Set(['a', 'b']) }])
    expect(auditDiff({ tags: new Set(['a']) }, { tags: new Set(['a']) }).patch).toEqual([])
    expect(auditDiff({ m: new Map([['k', 1]]) }, { m: new Map([['k', 2]]) }).patch)
      .toEqual([{ op: 'replace', path: '/m', value: new Map([['k', 2]]) }])
    expect(auditDiff({ m: new Map([['k', 1]]) }, { m: new Map([['k', 1]]) }).patch).toEqual([])
    expect(auditDiff({ re: /a/g }, { re: /a/i }).patch).toEqual([{ op: 'replace', path: '/re', value: /a/i }])
    expect(auditDiff({ re: /a/g }, { re: /a/g }).patch).toEqual([])
  })

  it('replaces a value whose type changes between a Date and a plain object', () => {
    expect(auditDiff({ at: new Date(0) }, { at: {} }).patch).toEqual([{ op: 'replace', path: '/at', value: {} }])
  })

  it('still diffs class instances key by key', () => {
    class Entity {
      constructor(public name: string, public age: number) {}
    }
    expect(auditDiff(new Entity('a', 1), new Entity('a', 2)).patch).toEqual([{ op: 'replace', path: '/age', value: 2 }])
  })

  it('redacts a changed Map stored under a redacted path', () => {
    const diff = auditDiff(
      { credentials: new Map([['token', 'old']]) },
      { credentials: new Map([['token', 'secret']]) },
      { redactPaths: ['credentials'] },
    )
    expect(diff.patch).toEqual([{ op: 'replace', path: '/credentials', value: '[REDACTED]' }])
  })

  it('redacts fields of a class instance that replaces a Date', () => {
    class Login {
      constructor(public user: string, public password: string) {}
    }
    const diff = auditDiff({ at: new Date(0) }, { at: new Login('u', 'hunter2') }, { redactPaths: ['password'] })
    expect(diff.patch).toEqual([{ op: 'replace', path: '/at', value: { user: 'u', password: '[REDACTED]' } }])
  })

  it('compares self-referential Maps without overflowing the stack', () => {
    const a = new Map<string, unknown>([['k', 1]])
    a.set('self', a)
    const b = new Map<string, unknown>([['k', 1]])
    b.set('self', b)
    expect(auditDiff({ m: a }, { m: b }).patch).toEqual([])

    const c = new Map<string, unknown>([['k', 2]])
    c.set('self', c)
    expect(auditDiff({ m: a }, { m: c }).patch).toEqual([{ op: 'replace', path: '/m', value: c }])
  })

  it('returns a patch for an added self-referential class instance', () => {
    class Node {
      self: Node = this
      constructor(public password: string) {}
    }
    const diff = auditDiff(undefined, new Node('hunter2'), { redactPaths: ['password'] })
    expect(diff.patch).toEqual([{ op: 'add', path: '', value: { self: '[Circular]', password: '[REDACTED]' } }])
  })

  it('diffs self-referential objects without overflowing the stack', () => {
    const a: Record<string, unknown> = { n: 1 }
    a.self = a
    const b: Record<string, unknown> = { n: 2 }
    b.self = b
    expect(auditDiff(a, b).patch).toEqual([{ op: 'replace', path: '/n', value: 2 }])
  })

  it('redacts fields of objects that carry a Symbol.toStringTag', () => {
    const tagged = auditDiff(undefined, { password: 'secret', [Symbol.toStringTag]: 'Login' }, { redactPaths: ['password'] })
    expect(tagged.patch).toEqual([{ op: 'add', path: '', value: { password: '[REDACTED]' } }])

    class Login {
      constructor(public user: string, public password: string) {}
      get [Symbol.toStringTag]() {
        return 'Login' 
      }
    }
    const instance = auditDiff({ at: new Date(0) }, { at: new Login('u', 'hunter2') }, { redactPaths: ['password'] })
    expect(instance.patch).toEqual([{ op: 'replace', path: '/at', value: { user: 'u', password: '[REDACTED]' } }])

    const changed = auditDiff({ login: new Login('u', 'old') }, { login: new Login('u', 'new') }, { redactPaths: ['password'] })
    expect(changed.patch).toEqual([{ op: 'replace', path: '/login/password', value: '[REDACTED]' }])
  })

  it('escapes "/" and "~" in JSON Pointer paths', () => {
    const doc = { 'a/b': 1, 'a': { b: 1 } }
    expect(auditDiff(doc, { 'a/b': 2, 'a': { b: 1 } }).patch).toEqual([{ op: 'replace', path: '/a~1b', value: 2 }])
    expect(auditDiff(doc, { 'a/b': 1, 'a': { b: 2 } }).patch).toEqual([{ op: 'replace', path: '/a/b', value: 2 }])
    expect(auditDiff({ 'a~b': 1 }, { 'a~b': 2 }).patch).toEqual([{ op: 'replace', path: '/a~0b', value: 2 }])
    expect(auditDiff({ '~1': 1 }, { '~1': 2 }).patch).toEqual([{ op: 'replace', path: '/~01', value: 2 }])
  })

  it('uses an empty path for root operations', () => {
    expect(auditDiff({ a: 1 }, null).patch).toEqual([{ op: 'replace', path: '', value: null }])
    expect(auditDiff({ a: 1 }, undefined).patch).toEqual([{ op: 'remove', path: '' }])
    expect(auditDiff(undefined, { a: 1 }).patch).toEqual([{ op: 'add', path: '', value: { a: 1 } }])
  })

  it('redacts keys that contain "/" or "~"', () => {
    const diff = auditDiff(
      { 'creds/v1': { 'pass~word': 'old' } },
      { 'creds/v1': { 'pass~word': 'new' } },
      { redactPaths: ['creds/v1.pass~word'] },
    )
    expect(diff.patch).toEqual([{ op: 'replace', path: '/creds~1v1/pass~0word', value: '[REDACTED]' }])

    const added = auditDiff({}, { 'creds/v1': { 'pass~word': 'new', 'user': 'u' } }, { redactPaths: ['creds/v1.pass~word'] })
    expect(added.patch).toEqual([{ op: 'add', path: '/creds~1v1', value: { 'pass~word': '[REDACTED]', 'user': 'u' } }])
  })
})

describe('defineAuditAction()', () => {
  it('curries the action and infers target type', () => {
    const refund = defineAuditAction('invoice.refund', { target: 'invoice' as const })
    const built = refund({
      actor: { type: 'user', id: 'u1' },
      target: { id: 'inv_1' },
    })
    expect(built.action).toBe('invoice.refund')
    expect(built.target).toEqual({ type: 'invoice', id: 'inv_1' })
  })

  it('exposes catalog metadata on the factory', () => {
    const refund = defineAuditAction('invoice.refund', {
      target: 'invoice',
      severity: 'high',
      requiresChanges: true,
      description: 'Refund an invoice',
      redactPaths: ['cardNumber'],
    })
    expect(refund.action).toBe('invoice.refund')
    expect(refund.severity).toBe('high')
    expect(refund.requiresChanges).toBe(true)
    expect(refund.description).toBe('Refund an invoice')
    expect(refund.redactPaths).toEqual(['cardNumber'])
  })
})

describe('signed() — hmac', () => {
  it('adds a deterministic signature for matching events', async () => {
    const calls: WideEvent[] = []
    const drain = signed((ctx: DrainContext) => {
      calls.push(ctx.event)
    }, { strategy: 'hmac', secret: 'topsecret' })
    const ctx1 = createDrainCtx({ audit: record() })
    const ctx2 = createDrainCtx({ audit: record() })
    await drain(ctx1)
    await drain(ctx2)
    const firstAudit = defined(defined(calls[0], 'first event').audit, 'first audit') as AuditFields
    const secondAudit = defined(defined(calls[1], 'second event').audit, 'second audit') as AuditFields
    expect(firstAudit.signature).toBeDefined()
    expect(firstAudit.signature).toBe(secondAudit.signature)
  })

  it('passes through events without audit', async () => {
    const drain = signed(() => {}, { strategy: 'hmac', secret: 's' })
    await expect(drain(createDrainCtx())).resolves.toBeUndefined()
  })
})

describe('signed() — hash-chain', () => {
  it('chains events via prevHash', async () => {
    const calls: WideEvent[] = []
    const drain = signed((ctx: DrainContext) => {
      calls.push(ctx.event)
    }, { strategy: 'hash-chain' })
    const make = () => createDrainCtx({ audit: record() })
    await drain(make())
    await drain(make())
    await drain(make())

    const a1 = defined(defined(calls[0], 'audit event 1').audit, 'audit 1') as AuditFields
    const a2 = defined(defined(calls[1], 'audit event 2').audit, 'audit 2') as AuditFields
    const a3 = defined(defined(calls[2], 'audit event 3').audit, 'audit 3') as AuditFields
    expect(a1.prevHash).toBeUndefined()
    expect(a2.prevHash).toBe(a1.hash)
    expect(a3.prevHash).toBe(a2.hash)
    expect(a1.hash).toBeDefined()
    expect(a2.hash).toBeDefined()
    expect(a3.hash).toBeDefined()
  })

  it('persists chain head via state.save', async () => {
    const saved: string[] = []
    const drain = signed(() => {}, {
      strategy: 'hash-chain',
      state: {
        load: () => null,
        save: (h) => {
          saved.push(h)
        },
      },
    })
    await drain(createDrainCtx({ audit: record() }))
    await drain(createDrainCtx({ audit: record({ action: 'b' }) }))
    expect(saved).toHaveLength(2)
    expect(saved[0]).not.toBe(saved[1])
  })

  it('resumes chain from state.load on first event', async () => {
    const calls: WideEvent[] = []
    const drain = signed((ctx: DrainContext) => {
      calls.push(ctx.event)
    }, {
      strategy: 'hash-chain',
      state: { load: () => 'previous-hash-from-disk', save: () => {} },
    })
    await drain(createDrainCtx({ audit: record() }))
    expect((defined(defined(calls[0], 'audit event').audit, 'audit') as AuditFields).prevHash).toBe('previous-hash-from-disk')
  })
})

describe('stableStringify plain-object guard', () => {
  it('serializes Date in audit changes via JSON.stringify, not key enumeration', async () => {
    const calls: WideEvent[] = []
    const when = new Date('2026-01-01T00:00:00.000Z')
    const drain = signed((ctx: DrainContext) => {
      calls.push(ctx.event)
    }, { strategy: 'hmac', secret: 'test-secret' })

    await drain(createDrainCtx({
      audit: record({ action: 'update', changes: { after: { when } } }),
    }))
    await drain(createDrainCtx({
      audit: record({ action: 'update', changes: { after: { when: new Date('2026-01-01T00:00:00.000Z') } } }),
    }))

    const sig1 = defined(defined(calls[0], 'first event').audit as AuditFields).signature
    const sig2 = defined(defined(calls[1], 'second event').audit as AuditFields).signature
    expect(sig1).toBeDefined()
    expect(sig1).toBe(sig2)
  })

  it('does not hang on circular references in audit changes', async () => {
    const calls: WideEvent[] = []
    const drain = signed((ctx: DrainContext) => {
      calls.push(ctx.event)
    }, { strategy: 'hmac', secret: 'test-secret' })

    const circular: Record<string, unknown> = { name: 'loop' }
    circular.self = circular
    const shared = { id: 'x' }

    await drain(createDrainCtx({
      audit: record({ action: 'update', changes: { before: { circular }, after: { a: shared, b: shared } } }),
    }))

    const audit = defined(defined(calls[0], 'event').audit as AuditFields)
    expect(audit.signature).toBeDefined()
  })
})

describe('auditRedactPreset', () => {
  it('redacts authorization and cookie path globs at any depth', () => {
    const config = defined(resolveRedactConfig(auditRedactPreset), 'audit redact preset')
    expect(config.paths).toContain('authorization')
    expect(config.paths).toContain('cookie')
    expect(config.paths).toContain('set-cookie')
  })

  it('redacts credential path globs at any depth', () => {
    const config = defined(resolveRedactConfig(auditRedactPreset), 'audit redact preset')
    expect(config.paths).toContain('password')
    expect(config.paths).toContain('token')
    expect(config.paths).toContain('apiKey')
  })

  it('redacts nested audit.changes password fields via path globs', () => {
    const config = defined(resolveRedactConfig(auditRedactPreset), 'audit redact preset')
    const event = redactEvent(
      {
        audit: {
          changes: {
            before: { password: 'old' },
            after: { password: 'new' },
          },
        },
      },
      config,
    )
    const changes = (event.audit as Record<string, unknown>).changes as Record<string, unknown>
    expect((changes.before as Record<string, unknown>).password).toBe('[REDACTED]')
    expect((changes.after as Record<string, unknown>).password).toBe('[REDACTED]')
  })
})

describe('withAuditMethods()', () => {
  it('attaches audit methods to a logger that lacks them', () => {
    const base: { set: (x: unknown) => void; getContext: () => Record<string, unknown> } = {
      set: vi.fn(),
      getContext: () => ({}),
    }
    const augmented = withAuditMethods(base as never)
    expect(typeof augmented.audit).toBe('function')
    expect(typeof augmented.audit.deny).toBe('function')
  })
})

describe('relayAudit()', () => {
  function storeOf(count: number): RelayAuditEntry<number>[] {
    return Array.from({ length: count }, (_, i) => ({
      cursor: i + 1,
      record: buildAuditFields({ action: `step.${i + 1}`, actor: alice, tenantId: 'team_7' }),
    }))
  }

  function readerOf(entries: RelayAuditEntry<number>[]) {
    return vi.fn((after: number | undefined, limit: number) =>
      Promise.resolve(entries.filter(entry => after === undefined || entry.cursor > after).slice(0, limit)))
  }

  it('sends every record in store order, batch by batch, saving the cursor after each batch with the one it replaces', async () => {
    const sent: string[][] = []
    const saved: Array<[number, number | undefined]> = []

    const result = await relayAudit({
      cursor: undefined,
      read: readerOf(storeOf(5)),
      send: (records) => {
        sent.push(records.map(r => r.action))
        return Promise.resolve()
      },
      save: (cursor, previous) => {
        saved.push([cursor, previous])
        return Promise.resolve()
      },
      limit: 2,
    })

    expect(sent).toEqual([['step.1', 'step.2'], ['step.3', 'step.4'], ['step.5']])
    expect(saved).toEqual([[2, undefined], [4, 2], [5, 4]])
    expect(result).toEqual({ cursor: 5, delivered: 5 })
  })

  it('stops at a failed send without moving the cursor, and the next run resends from it', async () => {
    const received = new Map<string, AuditFields>()
    let sends = 0
    const send = (records: AuditFields[]) => {
      sends++
      for (const [i, r] of records.entries()) {
        if (sends === 2 && i === 1) return Promise.reject(new Error('503 Service Unavailable'))
        received.set(r.id, r)
      }
      return Promise.resolve()
    }
    let cursor: number | undefined
    const save = (next: number) => {
      cursor = next
      return Promise.resolve()
    }
    const read = readerOf(storeOf(5))

    const failed = await relayAudit({ cursor, read, send, save, limit: 2 })
    expect(failed).toEqual({ cursor: 2, delivered: 2, error: new Error('503 Service Unavailable') })
    expect(cursor).toBe(2)

    const resumed = await relayAudit({ cursor, read, send, save, limit: 2 })
    expect(resumed).toEqual({ cursor: 5, delivered: 3 })
    expect([...received.values()].map(r => r.action)).toEqual(['step.1', 'step.2', 'step.3', 'step.4', 'step.5'])
  })

  it('stops when another run moved the cursor first', async () => {
    const send = vi.fn(() => Promise.resolve())
    const result = await relayAudit({
      cursor: 0,
      read: readerOf(storeOf(4)),
      send,
      save: () => Promise.reject(new Error('cursor moved')),
      limit: 2,
    })

    expect(result).toEqual({ cursor: 0, delivered: 0, error: new Error('cursor moved') })
    expect(send).toHaveBeenCalledOnce()
  })

  it('stops between batches once the signal aborts', async () => {
    const controller = new AbortController()
    const read = readerOf(storeOf(6))

    const result = await relayAudit({
      cursor: undefined,
      read,
      send: () => {
        controller.abort()
        return Promise.resolve()
      },
      save: () => Promise.resolve(),
      limit: 2,
      signal: controller.signal,
    })

    expect(result).toEqual({ cursor: 2, delivered: 2 })
    expect(read).toHaveBeenCalledOnce()
  })

  it('sends nothing when the store has nothing newer', async () => {
    const send = vi.fn(() => Promise.resolve())
    const result = await relayAudit({ cursor: 3, read: readerOf(storeOf(3)), send, save: () => Promise.resolve() })
    expect(result).toEqual({ cursor: 3, delivered: 0 })
    expect(send).not.toHaveBeenCalled()
  })
})
