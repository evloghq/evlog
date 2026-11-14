import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  finalizeAudit,
  mockAudit,
  signed,
  withAudit,
  withAuditMethods,
} from '../../src/audit'
import type { AuditFields, DrainContext, EnrichContext, WideEvent } from '../../src/types'
import { createLogger, createRequestLogger, initLogger } from '../../src/logger'
import { redactEvent, resolveRedactConfig } from '../../src/redact'
import { defined } from '../helpers/defined'

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

function createEnrichCtx(event: Partial<WideEvent> = {}, headers?: Record<string, string>, requestId?: string): EnrichContext {
  const wide: WideEvent = {
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'test',
    environment: 'test',
    ...event,
  }
  return {
    event: wide,
    headers,
    request: requestId ? { path: '/x', requestId } : undefined,
  }
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
  it('defaults outcome to success and version to AUDIT_SCHEMA_VERSION', () => {
    const fields = buildAuditFields({
      action: 'invoice.refund',
      actor: { type: 'user', id: 'u1' },
    })
    expect(fields.outcome).toBe('success')
    expect(fields.version).toBe(AUDIT_SCHEMA_VERSION)
  })

  it('preserves explicit outcome and version', () => {
    const fields = buildAuditFields({
      action: 'invoice.refund',
      actor: { type: 'system', id: 'cron' },
      outcome: 'failure',
      version: 2,
    })
    expect(fields.outcome).toBe('failure')
    expect(fields.version).toBe(2)
  })
})

describe('log.audit() on createLogger', () => {
  it('attaches audit fields and force-keeps the event past tail sampling', () => {
    initLogger({ pretty: false, redact: false, sampling: { rates: { info: 0 } } })
    const log = createLogger()
    log.audit?.({
      action: 'invoice.refund',
      actor: { type: 'user', id: 'u1' },
      target: { type: 'invoice', id: 'inv_1' },
    })
    const event = defined(log.emit(), 'emitted event')
    const audit = event.audit as AuditFields
    expect(audit.action).toBe('invoice.refund')
    expect(audit.outcome).toBe('success')
    expect(audit.idempotencyKey).toMatch(/^[\da-f]{32}$/)
  })

  it('log.audit.deny() sets outcome to denied and records reason', () => {
    const log = createLogger()
    log.audit?.deny('Insufficient permissions', {
      action: 'invoice.refund',
      actor: { type: 'user', id: 'u1' },
      target: { type: 'invoice', id: 'inv_1' },
    })
    const event = defined(log.emit(), 'emitted event')
    const audit = event.audit as AuditFields
    expect(audit.outcome).toBe('denied')
    expect(audit.reason).toBe('Insufficient permissions')
  })

  it('falls back to set+emit when log.set({ audit }) is used directly', () => {
    initLogger({ pretty: false, redact: false, sampling: { rates: { info: 0 } } })
    const log = createLogger()
    log.set({ audit: buildAuditFields({ action: 'manual', actor: { type: 'system', id: 's' } }) })
    const event = defined(log.emit(), 'emitted event')
    expect((event.audit as AuditFields).action).toBe('manual')
  })

  it('createRequestLogger exposes the same audit method', () => {
    const log = createRequestLogger({ method: 'POST', path: '/x' })
    expect(typeof log.audit).toBe('function')
  })
})

describe('standalone audit()', () => {
  it('emits an event tagged as audit and returns it', () => {
    const event = defined(audit({
      action: 'cron.cleanup',
      actor: { type: 'system', id: 'cron' },
    }), 'audit event')
    expect((event.audit as AuditFields).action).toBe('cron.cleanup')
  })

  it('is force-kept even when info sampling is at 0%', () => {
    initLogger({ pretty: false, redact: false, sampling: { rates: { info: 0 } } })
    const event = audit({
      action: 'cron.cleanup',
      actor: { type: 'system', id: 'cron' },
    })
    expect(event).not.toBeNull()
  })
})

describe('withAudit()', () => {
  it('records success when fn resolves', async () => {
    const collector = mockAudit()
    const refund = withAudit(
      { action: 'invoice.refund', target: input => ({ type: 'invoice', id: (input as { id: string }).id }) },
      (input: { id: string }) => `refunded ${input.id}`,
    )
    await refund({ id: 'inv_1' }, { actor: { type: 'user', id: 'u1' } })
    expect(collector.events).toHaveLength(1)
    const recorded = defined(collector.events[0], 'audit event')
    expect(recorded.outcome).toBe('success')
    expect(recorded.target).toEqual({ type: 'invoice', id: 'inv_1' })
    collector.restore()
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

describe('mockAudit()', () => {
  it('captures audit events from standalone audit()', () => {
    const captured = mockAudit()
    audit({ action: 'a', actor: { type: 'system', id: 's' } })
    expect(captured.events).toHaveLength(1)
    expect(captured.toIncludeAuditOf({ action: 'a' })).toBe(true)
    expect(captured.toIncludeAuditOf({ action: 'missing' })).toBe(false)
    captured.restore()
  })

  it('captures audit events from log.audit() on emit', () => {
    const captured = mockAudit()
    const log = createRequestLogger()
    log.audit({
      action: 'invoice.refund',
      actor: { type: 'user', id: 'u1' },
      target: { type: 'invoice', id: 'inv_1' },
      outcome: 'success',
    })
    log.emit()
    expect(captured.events).toHaveLength(1)
    const recorded = defined(captured.events[0], 'audit event')
    expect(recorded.action).toBe('invoice.refund')
    expect(recorded.idempotencyKey).toBeDefined()
    captured.restore()
  })

  it('captures log.audit.deny() with outcome denied', () => {
    const captured = mockAudit()
    const log = createRequestLogger()
    log.audit.deny('Insufficient permissions', {
      action: 'invoice.refund',
      actor: { type: 'user', id: 'u1' },
      target: { type: 'invoice', id: 'inv_1' },
    })
    log.emit()
    const recorded = defined(captured.events[0], 'audit event')
    expect(recorded.outcome).toBe('denied')
    expect(recorded.reason).toBe('Insufficient permissions')
    captured.restore()
  })

  it('matcher supports regex actions', () => {
    const captured = mockAudit()
    audit({ action: 'invoice.refund', actor: { type: 'system', id: 's' } })
    expect(captured.toIncludeAuditOf({ action: /^invoice\./ })).toBe(true)
    captured.restore()
  })

  it('assertAudit returns the matched event or throws', () => {
    const captured = mockAudit()
    audit({ action: 'invoice.refund', actor: { type: 'user', id: 'u1' }, outcome: 'success' })
    const match = captured.assertAudit({ action: 'invoice.refund', outcome: 'success' })
    expect(match.action).toBe('invoice.refund')
    expect(() => captured.assertAudit({ action: 'missing' })).toThrow(/No audit event matched/)
    captured.restore()
  })
})

describe('auditEnricher()', () => {
  it('skips events without audit field', async () => {
    const ctx = createEnrichCtx()
    await auditEnricher()(ctx)
    expect(ctx.event.audit).toBeUndefined()
  })

  it('populates context fields when audit is present', async () => {
    const ctx = createEnrichCtx(
      { audit: { action: 'a', actor: { type: 'user', id: 'u1' }, outcome: 'success' } },
      { 'user-agent': 'jest', 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
      'req-1',
    )
    await auditEnricher()(ctx)
    const audit = ctx.event.audit as AuditFields
    expect(audit.context).toMatchObject({
      requestId: 'req-1',
      ip: '1.2.3.4',
      userAgent: 'jest',
    })
  })

  it('uses tenantId resolver', async () => {
    const ctx = createEnrichCtx(
      { audit: { action: 'a', actor: { type: 'user', id: 'u1' }, outcome: 'success' } },
    )
    await auditEnricher({ tenantId: () => 'tenant_42' })(ctx)
    expect((ctx.event.audit as AuditFields).context?.tenantId).toBe('tenant_42')
  })

  it('uses better-auth bridge to fill missing actor', async () => {
    const ctx = createEnrichCtx(
      { audit: { action: 'a', actor: undefined as unknown as AuditFields['actor'], outcome: 'success' } as AuditFields },
    )
    await auditEnricher({
      bridge: { getSession: () => ({ type: 'user', id: 'session-user' }) },
    })(ctx)
    expect((ctx.event.audit as AuditFields).actor.id).toBe('session-user')
  })
})

describe('auditOnly()', () => {
  it('only forwards events that carry an audit field', async () => {
    const sink = vi.fn<(ctx: DrainContext) => Promise<void>>(async () => {})
    const wrapped = auditOnly(sink)
    await wrapped(createDrainCtx({}))
    await wrapped(createDrainCtx({ audit: { action: 'a', actor: { type: 'user', id: 'u1' }, outcome: 'success' } }))
    expect(sink).toHaveBeenCalledTimes(1)
  })

  it('with await: true awaits the wrapped drain', async () => {
    let resolved = false
    const sink = vi.fn<(ctx: DrainContext) => Promise<void>>(async () => {
      await new Promise(r => setTimeout(r, 5))
      resolved = true
    })
    const wrapped = auditOnly(sink, { await: true })
    await wrapped(createDrainCtx({ audit: { action: 'a', actor: { type: 'user', id: 'u1' }, outcome: 'success' } }))
    expect(resolved).toBe(true)
  })
})

describe('signed() — hmac', () => {
  it('adds a deterministic signature for matching events', async () => {
    const calls: WideEvent[] = []
    const drain = signed((ctx: DrainContext) => {
      calls.push(ctx.event)
    }, { strategy: 'hmac', secret: 'topsecret' })
    const ctx1 = createDrainCtx({ audit: { action: 'a', actor: { type: 'user', id: 'u1' }, outcome: 'success' } })
    const ctx2 = createDrainCtx({ audit: { action: 'a', actor: { type: 'user', id: 'u1' }, outcome: 'success' } })
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
    const make = () => createDrainCtx({ audit: { action: 'a', actor: { type: 'user', id: 'u1' }, outcome: 'success' } })
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
    await drain(createDrainCtx({ audit: { action: 'a', actor: { type: 'user', id: 'u1' }, outcome: 'success' } }))
    await drain(createDrainCtx({ audit: { action: 'b', actor: { type: 'user', id: 'u1' }, outcome: 'success' } }))
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
    await drain(createDrainCtx({ audit: { action: 'a', actor: { type: 'user', id: 'u1' }, outcome: 'success' } }))
    expect((defined(defined(calls[0], 'audit event').audit, 'audit') as AuditFields).prevHash).toBe('previous-hash-from-disk')
  })
})

describe('finalizeAudit', () => {
  it('skips partial audit objects missing actor fields', () => {
    const event: WideEvent = {
      timestamp: '2026-06-25T12:00:00.000Z',
      level: 'info',
      service: 'test',
      environment: 'test',
      audit: { action: 'refund.issued' } as AuditFields,
    }
    expect(() => finalizeAudit(event)).not.toThrow()
    expect(event.audit).toEqual({ action: 'refund.issued' })
  })

  it('decorates complete audit objects with an idempotency key', () => {
    const event: WideEvent = {
      timestamp: '2026-06-25T12:00:00.000Z',
      level: 'info',
      service: 'test',
      environment: 'test',
      audit: buildAuditFields({
        action: 'refund.issued',
        actor: { type: 'agent', id: 'bot' },
        target: { type: 'order', id: '4821' },
      }),
    }
    finalizeAudit(event)
    expect((event.audit as AuditFields).idempotencyKey).toMatch(/^[\da-f]{32}$/)
  })
})

describe('idempotency key', () => {
  it('is stable across identical events in the same second', () => {
    const e1 = defined(audit({ action: 'a', actor: { type: 'user', id: 'u1' }, target: { type: 't', id: 'r1' } }), 'audit event 1')
    const e2 = defined(audit({ action: 'a', actor: { type: 'user', id: 'u1' }, target: { type: 't', id: 'r1' } }), 'audit event 2')
    const t1 = (e1.timestamp as string).slice(0, 19)
    const t2 = (e2.timestamp as string).slice(0, 19)
    if (t1 === t2) {
      expect((e1.audit as AuditFields).idempotencyKey).toBe((e2.audit as AuditFields).idempotencyKey)
    }
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
      audit: {
        action: 'update',
        actor: { type: 'user', id: 'u1' },
        outcome: 'success',
        changes: { when },
      },
    }))
    await drain(createDrainCtx({
      audit: {
        action: 'update',
        actor: { type: 'user', id: 'u1' },
        outcome: 'success',
        changes: { when: new Date('2026-01-01T00:00:00.000Z') },
      },
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
      audit: {
        action: 'update',
        actor: { type: 'user', id: 'u1' },
        outcome: 'success',
        changes: { circular, a: shared, b: shared },
      },
    }))

    const audit = defined(defined(calls[0], 'event').audit as AuditFields)
    expect(audit.signature).toBeDefined()
  })
})

describe('end-to-end: audit + auditOnly + global drain', () => {
  it('routes audit-only drain alongside the main drain', () => {
    const main = vi.fn<(ctx: DrainContext) => void>()
    const auditSink = vi.fn<(ctx: DrainContext) => void>()
    const onlyAudit = auditOnly(auditSink as never)
    initLogger({
      pretty: false,
      redact: false,
      drain: (ctx) => {
        main(ctx)
        return onlyAudit(ctx)
      },
    })

    const log = createLogger()
    log.audit?.({ action: 'x', actor: { type: 'user', id: 'u1' } })
    log.emit()

    expect(main).toHaveBeenCalledTimes(1)
    expect(auditSink).toHaveBeenCalledTimes(1)
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
