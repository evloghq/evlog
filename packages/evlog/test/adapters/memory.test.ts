import { afterEach, describe, expect, it } from 'vitest'
import type { WideEvent } from '../../src/types'
import { clearMemoryLogs, createMemoryDrain, parseReadMemoryLogsQuery, readMemoryLogs, writeToMemory } from '../../src/adapters/memory'

const createTestEvent = (overrides?: Partial<WideEvent>): WideEvent => ({
  timestamp: '2026-03-14T10:00:00.000Z',
  level: 'info',
  service: 'test-service',
  environment: 'test',
  ...overrides,
})

afterEach(() => {
  clearMemoryLogs()
  clearMemoryLogs('custom')
  clearMemoryLogs('a')
  clearMemoryLogs('b')
})

describe('writeToMemory', () => {
  it('stores events in the default store', () => {
    writeToMemory([createTestEvent({ action: 'req_1' })], { store: 'default', maxEvents: 1000 })

    expect(readMemoryLogs()).toHaveLength(1)
    expect(readMemoryLogs()[0]!.action).toBe('req_1')
  })

  it('appends to existing events', () => {
    const cfg = { store: 'default', maxEvents: 1000 }
    writeToMemory([createTestEvent({ requestId: '1' })], cfg)
    writeToMemory([createTestEvent({ requestId: '2' })], cfg)

    expect(readMemoryLogs()).toHaveLength(2)
  })

  it('skips empty arrays without touching the store', () => {
    writeToMemory([], { store: 'default', maxEvents: 1000 })

    expect(readMemoryLogs()).toHaveLength(0)
  })

  it('enforces maxEvents by dropping oldest events', () => {
    const cfg = { store: 'default', maxEvents: 3 }
    for (let i = 1; i <= 5; i++) {
      writeToMemory([createTestEvent({ requestId: String(i) })], cfg)
    }

    const events = readMemoryLogs()
    expect(events).toHaveLength(3)
    expect(events.map(e => e.requestId)).toEqual(['3', '4', '5'])
  })

  it('writes to a named store independently', () => {
    writeToMemory([createTestEvent({ action: 'default_event' })], { store: 'default', maxEvents: 1000 })
    writeToMemory([createTestEvent({ action: 'custom_event' })], { store: 'custom', maxEvents: 1000 })

    expect(readMemoryLogs({ store: 'default' })).toHaveLength(1)
    expect(readMemoryLogs({ store: 'custom' })).toHaveLength(1)
    expect(readMemoryLogs({ store: 'default' })[0]!.action).toBe('default_event')
    expect(readMemoryLogs({ store: 'custom' })[0]!.action).toBe('custom_event')
  })
})

describe('createMemoryDrain', () => {
  it('writes events to the default store via drain', async () => {
    const drain = createMemoryDrain()
    const ctx = { event: createTestEvent({ action: 'drain_test' }), request: { method: 'GET', path: '/', requestId: 'r1' }, headers: {} }

    await drain(ctx)

    expect(readMemoryLogs()).toHaveLength(1)
    expect(readMemoryLogs()[0]!.action).toBe('drain_test')
  })

  it('writes batch of contexts', async () => {
    const drain = createMemoryDrain()
    const ctxs = [
      { event: createTestEvent({ requestId: '1' }), request: { method: 'GET', path: '/', requestId: '1' }, headers: {} },
      { event: createTestEvent({ requestId: '2' }), request: { method: 'GET', path: '/', requestId: '2' }, headers: {} },
    ]

    await drain(ctxs)

    expect(readMemoryLogs()).toHaveLength(2)
  })

  it('respects the maxEvents cap', async () => {
    const drain = createMemoryDrain({ maxEvents: 2 })

    for (let i = 1; i <= 4; i++) {
      await drain({ event: createTestEvent({ requestId: String(i) }), request: { method: 'GET', path: '/', requestId: String(i) }, headers: {} })
    }

    expect(readMemoryLogs()).toHaveLength(2)
    expect(readMemoryLogs().map(e => e.requestId)).toEqual(['3', '4'])
  })

  it('writes to a custom named store', async () => {
    const drain = createMemoryDrain({ store: 'custom' })
    await drain({ event: createTestEvent({ action: 'named' }), request: { method: 'GET', path: '/', requestId: 'r1' }, headers: {} })

    expect(readMemoryLogs({ store: 'custom' })).toHaveLength(1)
    expect(readMemoryLogs()).toHaveLength(0)
  })

  it('resolves store and maxEvents from environment variables', async () => {
    const origStore = process.env.EVLOG_MEMORY_STORE
    const origMaxEvents = process.env.EVLOG_MEMORY_MAX_EVENTS

    try {
      process.env.EVLOG_MEMORY_STORE = 'env-store'
      process.env.EVLOG_MEMORY_MAX_EVENTS = '2'
      clearMemoryLogs('env-store')

      const drain = createMemoryDrain()
      for (let i = 1; i <= 3; i++) {
        await drain({ event: createTestEvent({ requestId: String(i) }), request: { method: 'GET', path: '/', requestId: String(i) }, headers: {} })
      }

      expect(readMemoryLogs({ store: 'env-store' }).map(e => e.requestId)).toEqual(['2', '3'])
    } finally {
      if (origStore === undefined) delete process.env.EVLOG_MEMORY_STORE
      else process.env.EVLOG_MEMORY_STORE = origStore
      if (origMaxEvents === undefined) delete process.env.EVLOG_MEMORY_MAX_EVENTS
      else process.env.EVLOG_MEMORY_MAX_EVENTS = origMaxEvents
      clearMemoryLogs('env-store')
    }
  })

  it('multiple drains sharing the same store key see each other\'s events', async () => {
    const drainA = createMemoryDrain({ store: 'a' })
    const drainB = createMemoryDrain({ store: 'a' })

    await drainA({ event: createTestEvent({ action: 'from_a' }), request: { method: 'GET', path: '/', requestId: 'r1' }, headers: {} })
    await drainB({ event: createTestEvent({ action: 'from_b' }), request: { method: 'GET', path: '/', requestId: 'r2' }, headers: {} })

    expect(readMemoryLogs({ store: 'a' })).toHaveLength(2)
  })
})

describe('readMemoryLogs', () => {
  const populate = () => {
    writeToMemory([
      createTestEvent({ level: 'info', timestamp: '2026-03-14T08:00:00.000Z', requestId: 'r1' }),
      createTestEvent({ level: 'warn', timestamp: '2026-03-14T09:00:00.000Z', requestId: 'r2' }),
      createTestEvent({ level: 'error', timestamp: '2026-03-14T10:00:00.000Z', requestId: 'r3' }),
      createTestEvent({ level: 'info', timestamp: '2026-03-14T11:00:00.000Z', requestId: 'r4' }),
    ], { store: 'default', maxEvents: 1000 })
  }

  it('returns all events when no filter is provided', () => {
    populate()

    expect(readMemoryLogs()).toHaveLength(4)
  })

  it('returns an empty array when the store is empty', () => {
    expect(readMemoryLogs()).toHaveLength(0)
  })

  it('filters by a single level', () => {
    populate()

    const errors = readMemoryLogs({ level: 'error' })
    expect(errors).toHaveLength(1)
    expect(errors[0]!.requestId).toBe('r3')
  })

  it('filters by multiple levels', () => {
    populate()

    const warnAndError = readMemoryLogs({ level: ['warn', 'error'] })
    expect(warnAndError).toHaveLength(2)
    expect(warnAndError.map(e => e.requestId)).toEqual(['r2', 'r3'])
  })

  it('filters by since', () => {
    populate()

    const recent = readMemoryLogs({ since: '2026-03-14T09:30:00.000Z' })
    expect(recent.map(e => e.requestId)).toEqual(['r3', 'r4'])
  })

  it('filters by until', () => {
    populate()

    const early = readMemoryLogs({ until: '2026-03-14T09:30:00.000Z' })
    expect(early.map(e => e.requestId)).toEqual(['r1', 'r2'])
  })

  it('filters by since and until range', () => {
    populate()

    const range = readMemoryLogs({
      since: '2026-03-14T08:30:00.000Z',
      until: '2026-03-14T09:30:00.000Z',
    })
    expect(range.map(e => e.requestId)).toEqual(['r2'])
  })

  it('accepts Date objects for since/until', () => {
    populate()

    const range = readMemoryLogs({
      since: new Date('2026-03-14T09:00:00.000Z'),
      until: new Date('2026-03-14T10:00:00.000Z'),
    })
    expect(range.map(e => e.requestId)).toEqual(['r2', 'r3'])
  })

  it('applies a custom filter predicate', () => {
    populate()

    const filtered = readMemoryLogs({ filter: e => e.requestId === 'r2' })
    expect(filtered).toHaveLength(1)
    expect(filtered[0]!.requestId).toBe('r2')
  })

  it('returns only the most-recent N events when limit is set', () => {
    populate()

    const limited = readMemoryLogs({ limit: 2 })
    expect(limited.map(e => e.requestId)).toEqual(['r3', 'r4'])
  })

  it('returns an empty array when limit is 0', () => {
    populate()

    expect(readMemoryLogs({ limit: 0 })).toHaveLength(0)
  })

  it('returns an empty array when limit is negative', () => {
    populate()

    expect(readMemoryLogs({ limit: -1 })).toHaveLength(0)
  })

  it('returns a snapshot (mutations to result do not affect the store)', () => {
    populate()

    const snap = readMemoryLogs()
    snap.splice(0)

    expect(readMemoryLogs()).toHaveLength(4)
  })
})

describe('clearMemoryLogs', () => {
  it('empties the default store', () => {
    writeToMemory([createTestEvent()], { store: 'default', maxEvents: 1000 })
    clearMemoryLogs()

    expect(readMemoryLogs()).toHaveLength(0)
  })

  it('empties a named store without touching the default', () => {
    writeToMemory([createTestEvent()], { store: 'default', maxEvents: 1000 })
    writeToMemory([createTestEvent()], { store: 'custom', maxEvents: 1000 })
    clearMemoryLogs('custom')

    expect(readMemoryLogs()).toHaveLength(1)
    expect(readMemoryLogs({ store: 'custom' })).toHaveLength(0)
  })

  it('is a no-op on a store that was never written to', () => {
    expect(() => clearMemoryLogs('nonexistent')).not.toThrow()
  })
})

describe('parseReadMemoryLogsQuery', () => {
  it('returns empty options for an empty query', () => {
    expect(parseReadMemoryLogsQuery({})).toEqual({})
  })

  it('passes store and string timestamp params through', () => {
    const result = parseReadMemoryLogsQuery({
      store: 'api',
      since: '2026-01-01T00:00:00.000Z',
      until: '2026-12-31T23:59:59.999Z',
    })
    expect(result).toEqual({
      store: 'api',
      since: '2026-01-01T00:00:00.000Z',
      until: '2026-12-31T23:59:59.999Z',
    })
  })

  it('coerces a single level string', () => {
    expect(parseReadMemoryLogsQuery({ level: 'error' })).toEqual({ level: 'error' })
  })

  it('coerces comma-separated levels into an array', () => {
    expect(parseReadMemoryLogsQuery({ level: 'error,warn' })).toEqual({ level: ['error', 'warn'] })
  })

  it('coerces an array of level strings', () => {
    expect(parseReadMemoryLogsQuery({ level: ['error', 'warn'] })).toEqual({ level: ['error', 'warn'] })
  })

  it('ignores unknown level values', () => {
    expect(parseReadMemoryLogsQuery({ level: 'critical,error' })).toEqual({ level: 'error' })
  })

  it('omits level when all values are invalid', () => {
    expect(parseReadMemoryLogsQuery({ level: 'critical,verbose' })).toEqual({})
  })

  it('coerces limit to a number', () => {
    expect(parseReadMemoryLogsQuery({ limit: '50' })).toEqual({ limit: 50 })
  })

  it('ignores a non-numeric limit', () => {
    expect(parseReadMemoryLogsQuery({ limit: 'all' })).toEqual({})
  })

  it('passes a zero limit through (readMemoryLogs will return [])', () => {
    expect(parseReadMemoryLogsQuery({ limit: '0' })).toEqual({ limit: 0 })
  })

  it('ignores empty string values', () => {
    expect(parseReadMemoryLogsQuery({ store: '', since: '' })).toEqual({})
  })

  it('end-to-end: filters events via parsed query', () => {
    const cfg = { store: 'default', maxEvents: 1000 }
    writeToMemory([createTestEvent({ level: 'error', action: 'e1' })], cfg)
    writeToMemory([createTestEvent({ level: 'info', action: 'i1' })], cfg)

    const opts = parseReadMemoryLogsQuery({ level: 'error', limit: '10' })
    const events = readMemoryLogs(opts)
    expect(events).toHaveLength(1)
    expect(events[0]!.level).toBe('error')
  })
})
