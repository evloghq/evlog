import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineCommand, runCommand } from 'citty'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveConsent, purgeOutbox } from '../src/consent'
import { FLAG_VALUE_SET, sanitizeFlags, sanitizeCustom, sanitizeSystemCustom } from '../src/sanitize'
import { computeRunIdempotencyKey } from '../src/idempotency'
import { generateDisclosure, exampleRunEvent } from '../src/disclosure'
import { TelemetryOutbox } from '../src/outbox'
import { formatTelemetryNotice } from '../src/notice'
import { withTelemetry } from '../src/citty'
import {
  createTelemetry,
  telemetry,
  disableTelemetry,
  enableTelemetry,
  _resetActiveTelemetryForTests,
} from '../src/create'
import {
  CI_FLUSH_INTERVAL_MS,
  DEFAULT_FLUSH_INTERVAL_MS,
  DEFAULT_FLUSH_THRESHOLD,
  MAX_FLUSH_BATCH,
  resolveFlushIntervalMs,
  resolveFlushThreshold,
  shouldFlushOutbox,
} from '../src/flush-policy'

const TOOL = 'evlog-test'

describe('telemetry consent', () => {
  const { env } = process

  beforeEach(() => {
    process.env = { ...env }
    delete process.env.XDG_CONFIG_HOME
    delete process.env.DO_NOT_TRACK
    delete process.env.EVLOG_TELEMETRY
  })

  afterEach(() => {
    process.env = env
  })

  it('honours DO_NOT_TRACK first', () => {
    process.env.DO_NOT_TRACK = '1'
    process.env.EVLOG_TELEMETRY = '1'
    expect(resolveConsent(TOOL)).toBe(false)
  })

  it('honours EVLOG_TELEMETRY=0 over default', () => {
    process.env.EVLOG_TELEMETRY = '0'
    expect(resolveConsent(TOOL)).toBe(false)
  })

  it('honours EVLOG_TELEMETRY=1', () => {
    process.env.EVLOG_TELEMETRY = '1'
    expect(resolveConsent(TOOL)).toBe(true)
  })
})

describe('telemetry sanitize', () => {
  it('captures boolean and number flag values', () => {
    expect(sanitizeFlags({ json: true, limit: 50 })).toEqual({ json: true, limit: 50 })
  })

  it('marks undeclared string flag values as set without recording them', () => {
    expect(sanitizeFlags({ output: '/secret/path' })).toEqual({ output: FLAG_VALUE_SET })
  })

  it('allowlists declared string flag values', () => {
    const flags = sanitizeFlags(
      { format: 'json' },
      { collect: { flags: { format: ['json', 'csv'] } } },
    )
    expect(flags).toEqual({ format: 'json' })
  })

  it('drops the positional bucket', () => {
    expect(sanitizeFlags({ _: ['src/api'], all: true })).toEqual({ all: true })
  })

  it('collapses kebab-case duplicates onto the camelCase flag', () => {
    expect(sanitizeFlags({ 'minScore': 90, 'min-score': 90 })).toEqual({ minScore: 90 })
  })

  it('allowlists a kebab-case flag under its camelCase name', () => {
    const flags = sanitizeFlags(
      { 'out-format': 'csv' },
      { collect: { flags: { outFormat: ['json', 'csv'] } } },
    )
    expect(flags).toEqual({ outFormat: 'csv' })
  })

  it('drops flags left at their declared default', () => {
    const flags = sanitizeFlags(
      { write: true, verbose: true },
      { args: { write: { default: true }, verbose: { default: false } } },
    )
    expect(flags).toEqual({ verbose: true })
  })

  it('keeps a flag whose value differs from its declared default', () => {
    const flags = sanitizeFlags({ write: false }, { args: { write: { default: true } } })
    expect(flags).toEqual({ write: false })
  })

  it('drops undeclared string custom fields', () => {
    const out = sanitizeCustom({ secret: 'nope' }, {}, undefined)
    expect(out).toEqual({})
  })

  it('accepts declared string custom fields', () => {
    const out = sanitizeCustom(
      { framework: 'nuxt' },
      {},
      { fields: { framework: ['nitro', 'nuxt', 'next'] } },
    )
    expect(out).toEqual({ framework: 'nuxt' })
  })

  it('allowlists system-injected custom keys only', () => {
    expect(sanitizeSystemCustom({
      ghaAction: 'checkout',
      ghaEvent: 'push',
      secret: 'nope',
    })).toEqual({ ghaAction: 'checkout', ghaEvent: 'push' })
  })

  it('truncates long system custom strings', () => {
    const long = 'x'.repeat(200)
    expect(sanitizeSystemCustom({ ghaAction: long }).ghaAction).toHaveLength(128)
  })
})

describe('telemetry outbox', () => {
  let base: string

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'evlog-telemetry-'))
    process.env.XDG_CONFIG_HOME = base
  })

  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
    delete process.env.XDG_CONFIG_HOME
    _resetActiveTelemetryForTests()
  })

  it('round-trips events offline then drains on next run', async () => {
    const outbox = new TelemetryOutbox({ toolName: TOOL })
    const event = exampleRunEvent({ idempotencyKey: 'abc' })
    await outbox.append(event)
    const read = await outbox.readAll()
    expect(read).toHaveLength(1)
    expect(read[0]?.idempotencyKey).toBe('abc')
  })

  it('skips corrupt lines', async () => {
    const dir = join(base, TOOL, 'telemetry')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'outbox.ndjson'), `{bad\n${ JSON.stringify({ event: exampleRunEvent(), storedAt: Date.now() }) }\n`)
    const outbox = new TelemetryOutbox({ toolName: TOOL })
    expect(await outbox.readAll()).toHaveLength(1)
  })

  it('purges on opt-out', async () => {
    const outbox = new TelemetryOutbox({ toolName: TOOL })
    await outbox.append(exampleRunEvent())
    await purgeOutbox(TOOL)
    expect(await outbox.readAll()).toHaveLength(0)
  })

  it('excludes expired events on read', async () => {
    const dir = join(base, TOOL, 'telemetry')
    await mkdir(dir, { recursive: true })
    const stale = { event: exampleRunEvent({ idempotencyKey: 'stale' }), storedAt: Date.now() - 60_000 }
    const fresh = { event: exampleRunEvent({ idempotencyKey: 'fresh' }), storedAt: Date.now() }
    await writeFile(
      join(dir, 'outbox.ndjson'),
      `${JSON.stringify(stale) }\n${JSON.stringify(fresh) }\n`,
    )
    const outbox = new TelemetryOutbox({ toolName: TOOL, maxEventAgeMs: 30_000 })
    const read = await outbox.readAll()
    expect(read).toHaveLength(1)
    expect(read[0]?.idempotencyKey).toBe('fresh')
  })

  it('serializes concurrent appends without corrupting the outbox', async () => {
    const outbox = new TelemetryOutbox({ toolName: TOOL })
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        outbox.append(exampleRunEvent({ idempotencyKey: `key-${i}` })),
      ),
    )
    const read = await outbox.readAll()
    expect(read).toHaveLength(20)
    expect(new Set(read.map(e => e.idempotencyKey)).size).toBe(20)
  })

  it('recovers a stale lock from a dead pid', async () => {
    const dir = join(base, TOOL, 'telemetry')
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'outbox.lock'),
      JSON.stringify({ pid: 99_999_999, acquiredAt: Date.now() }),
    )
    const outbox = new TelemetryOutbox({ toolName: TOOL })
    await outbox.append(exampleRunEvent({ idempotencyKey: 'recovered' }))
    expect(await outbox.readAll()).toHaveLength(1)
  })

  it('recovers a stale lock by age', async () => {
    const dir = join(base, TOOL, 'telemetry')
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'outbox.lock'),
      JSON.stringify({ pid: process.pid, acquiredAt: Date.now() - 60_000 }),
    )
    const outbox = new TelemetryOutbox({ toolName: TOOL, lockStaleMs: 30_000 })
    await outbox.append(exampleRunEvent({ idempotencyKey: 'aged-out' }))
    expect(await outbox.readAll()).toHaveLength(1)
  })

  it('round-trips last-flush and clears it on purge', async () => {
    const outbox = new TelemetryOutbox({ toolName: TOOL })
    expect(await outbox.readLastFlushAt()).toBeUndefined()
    await outbox.markFlushed(1_700_000_000_000)
    expect(await outbox.readLastFlushAt()).toBe(1_700_000_000_000)
    await outbox.append(exampleRunEvent())
    await purgeOutbox(TOOL)
    expect(await outbox.readAll()).toHaveLength(0)
    expect(await outbox.readLastFlushAt()).toBeUndefined()
  })
})

describe('telemetry flush policy', () => {
  it('defaults to 15 minutes, 60 minutes in CI', () => {
    expect(resolveFlushIntervalMs(undefined, false, {})).toBe(DEFAULT_FLUSH_INTERVAL_MS)
    expect(resolveFlushIntervalMs(undefined, true, {})).toBe(CI_FLUSH_INTERVAL_MS)
  })

  it('lets the env override the option and CI default', () => {
    expect(resolveFlushIntervalMs(1_000, true, { EVLOG_TELEMETRY_FLUSH_INTERVAL_MS: '0' })).toBe(0)
    expect(resolveFlushIntervalMs(undefined, false, { EVLOG_TELEMETRY_FLUSH_INTERVAL_MS: '120000' })).toBe(120_000)
  })

  it('caps the threshold at the ingest batch size', () => {
    expect(resolveFlushThreshold(undefined, {})).toBe(DEFAULT_FLUSH_THRESHOLD)
    expect(resolveFlushThreshold(3, {})).toBe(3)
    expect(resolveFlushThreshold(99, {})).toBe(MAX_FLUSH_BATCH)
    expect(resolveFlushThreshold(undefined, { EVLOG_TELEMETRY_FLUSH_THRESHOLD: '50' })).toBe(50)
  })

  it('does not flush when the window has not elapsed', () => {
    expect(shouldFlushOutbox({
      pending: 1,
      lastFlushAt: 1_000,
      now: 1_000 + DEFAULT_FLUSH_INTERVAL_MS - 1,
      intervalMs: DEFAULT_FLUSH_INTERVAL_MS,
      threshold: DEFAULT_FLUSH_THRESHOLD,
    })).toBe(false)
  })

  it('flushes when the window has elapsed', () => {
    expect(shouldFlushOutbox({
      pending: 1,
      lastFlushAt: 1_000,
      now: 1_000 + DEFAULT_FLUSH_INTERVAL_MS,
      intervalMs: DEFAULT_FLUSH_INTERVAL_MS,
      threshold: DEFAULT_FLUSH_THRESHOLD,
    })).toBe(true)
  })

  it('flushes when the outbox reaches the threshold', () => {
    expect(shouldFlushOutbox({
      pending: DEFAULT_FLUSH_THRESHOLD,
      lastFlushAt: 1_000,
      now: 1_001,
      intervalMs: DEFAULT_FLUSH_INTERVAL_MS,
      threshold: DEFAULT_FLUSH_THRESHOLD,
    })).toBe(true)
  })

  it('uses the oldest stored event when nothing has flushed yet', () => {
    expect(shouldFlushOutbox({
      pending: 1,
      oldestStoredAt: 1_000,
      now: 1_000 + DEFAULT_FLUSH_INTERVAL_MS,
      intervalMs: DEFAULT_FLUSH_INTERVAL_MS,
      threshold: DEFAULT_FLUSH_THRESHOLD,
    })).toBe(true)
    expect(shouldFlushOutbox({
      pending: 1,
      oldestStoredAt: 1_000,
      now: 1_001,
      intervalMs: DEFAULT_FLUSH_INTERVAL_MS,
      threshold: DEFAULT_FLUSH_THRESHOLD,
    })).toBe(false)
  })
})

describe('telemetry flush', () => {
  let base: string

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'evlog-telemetry-'))
    process.env.XDG_CONFIG_HOME = base
    process.env.EVLOG_TELEMETRY = '1'
    _resetActiveTelemetryForTests()
  })

  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
    delete process.env.XDG_CONFIG_HOME
    delete process.env.EVLOG_TELEMETRY
    _resetActiveTelemetryForTests()
  })

  it('never throws when drain always fails', async () => {
    const instance = createTelemetry({
      name: TOOL,
      version: '0.0.0',
      endpoint: 'http://127.0.0.1:1', // unreachable
      flushTimeoutMs: 100,
    })
    await expect(instance.run('test', () => 'ok')).resolves.toBe('ok')
    await expect(instance.flush()).resolves.toBeUndefined()
  })

  it('collects custom fields via telemetry.set()', async () => {
    const instance = createTelemetry({ name: TOOL, version: '0.0.0' })
    await instance.run('doctor', () => {
      telemetry.set({ checksFailed: 2, ok: true })
    })
    const outbox = new TelemetryOutbox({ toolName: TOOL })
    const events = await outbox.readAll()
    expect(events[0]?.custom).toEqual({ checksFailed: 2, ok: true })
  })

  it('stops recording after disableTelemetry on the active instance', async () => {
    const instance = createTelemetry({ name: TOOL, version: '0.0.0' })
    await instance.run('before', () => undefined)
    await disableTelemetry(TOOL)
    expect(instance.enabled).toBe(false)
    await instance.run('after', () => undefined)
    const outbox = new TelemetryOutbox({ toolName: TOOL })
    expect(await outbox.readAll()).toHaveLength(0)
  })

  it('resumes recording after enableTelemetry on the active instance', async () => {
    const instance = createTelemetry({ name: TOOL, version: '0.0.0' })
    await disableTelemetry(TOOL)
    await enableTelemetry(TOOL)
    expect(instance.enabled).toBe(true)
    await instance.run('again', () => undefined)
    const outbox = new TelemetryOutbox({ toolName: TOOL })
    const events = await outbox.readAll()
    expect(events).toHaveLength(1)
    expect(events[0]?.command).toBe('again')
  })
})

describe('telemetry flush coalescing', () => {
  const endpoint = 'https://telemetry.test/ingest'
  let base: string

  function stubIngest(status = 204) {
    const fetchSpy = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(null, { status })),
    )
    vi.stubGlobal('fetch', fetchSpy)
    return fetchSpy
  }

  function postedBody(fetchSpy: ReturnType<typeof stubIngest>): { events: { command: string }[] } {
    return JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as { events: { command: string }[] }
  }

  function createHandle(overrides: Partial<Parameters<typeof createTelemetry>[0]> = {}) {
    return createTelemetry({
      name: TOOL,
      version: '0.0.0',
      endpoint,
      flushIntervalMs: 60_000,
      flushThreshold: 20,
      ...overrides,
    })
  }

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'evlog-telemetry-'))
    process.env.XDG_CONFIG_HOME = base
    process.env.EVLOG_TELEMETRY = '1'
    delete process.env.EVLOG_TELEMETRY_FLUSH_INTERVAL_MS
    delete process.env.EVLOG_TELEMETRY_FLUSH_THRESHOLD
    _resetActiveTelemetryForTests()
  })

  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
    delete process.env.XDG_CONFIG_HOME
    delete process.env.EVLOG_TELEMETRY
    delete process.env.EVLOG_TELEMETRY_FLUSH_INTERVAL_MS
    delete process.env.EVLOG_TELEMETRY_FLUSH_THRESHOLD
    vi.unstubAllGlobals()
    _resetActiveTelemetryForTests()
  })

  it('records without POSTing when the window has not elapsed', async () => {
    const fetchSpy = stubIngest()
    const instance = createHandle()
    await instance.run('doctor', () => 'ok')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(await new TelemetryOutbox({ toolName: TOOL }).readAll()).toHaveLength(1)
  })

  it('POSTs and updates last-flush when the window has elapsed', async () => {
    const fetchSpy = stubIngest()
    const outbox = new TelemetryOutbox({ toolName: TOOL })
    const seeded = Date.now() - 120_000
    await outbox.markFlushed(seeded)
    const instance = createHandle()
    await instance.run('doctor', () => 'ok')
    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(endpoint)
    const flushedAt = await outbox.readLastFlushAt()
    expect(flushedAt).toBeGreaterThan(seeded)
    expect(await outbox.readAll()).toHaveLength(0)
  })

  it('POSTs when the outbox reaches the threshold', async () => {
    const fetchSpy = stubIngest()
    const instance = createHandle({ flushThreshold: 2 })
    await instance.run('first', () => undefined)
    expect(fetchSpy).not.toHaveBeenCalled()
    await instance.run('second', () => undefined)
    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(postedBody(fetchSpy).events.map(e => e.command)).toEqual(['first', 'second'])
    expect(await new TelemetryOutbox({ toolName: TOOL }).readAll()).toHaveLength(0)
  })

  it('keeps events on disk and leaves last-flush unchanged when the POST fails', async () => {
    const fetchSpy = stubIngest(500)
    const outbox = new TelemetryOutbox({ toolName: TOOL })
    const seeded = Date.now() - 120_000
    await outbox.markFlushed(seeded)
    const instance = createHandle()
    await instance.run('doctor', () => 'ok')
    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(await outbox.readAll()).toHaveLength(1)
    expect(await outbox.readLastFlushAt()).toBe(seeded)
  })

  it('flush() POSTs even when the window has not elapsed', async () => {
    const fetchSpy = stubIngest()
    const instance = createHandle()
    await instance.run('doctor', () => 'ok')
    expect(fetchSpy).not.toHaveBeenCalled()
    await instance.flush()
    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(await new TelemetryOutbox({ toolName: TOOL }).readAll()).toHaveLength(0)
  })

  it('POSTs on every run when EVLOG_TELEMETRY_FLUSH_INTERVAL_MS is 0', async () => {
    process.env.EVLOG_TELEMETRY_FLUSH_INTERVAL_MS = '0'
    const fetchSpy = stubIngest()
    const instance = createHandle()
    await instance.run('doctor', () => 'ok')
    expect(fetchSpy).toHaveBeenCalledOnce()
  })

  it('caps a flush POST at the ingest batch size', async () => {
    const fetchSpy = stubIngest()
    const outbox = new TelemetryOutbox({ toolName: TOOL })
    await outbox.markFlushed(Date.now() - 120_000)
    await Promise.all(
      Array.from({ length: MAX_FLUSH_BATCH }, (_, i) =>
        outbox.append(exampleRunEvent({ idempotencyKey: `cap-${i}` })),
      ),
    )
    const instance = createHandle()
    await instance.run('extra', () => undefined)
    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(postedBody(fetchSpy).events).toHaveLength(MAX_FLUSH_BATCH)
    expect(await outbox.readAll()).toHaveLength(1)
  })
})

describe('telemetry notice', () => {
  const { env } = process

  beforeEach(() => {
    process.env = { ...env }
    process.env.NO_COLOR = '1'
  })

  afterEach(() => {
    process.env = env
    delete process.env.NO_COLOR
  })

  it('matches snapshot without ANSI colors', () => {
    expect(formatTelemetryNotice('my-tool')).toMatchSnapshot()
  })
})

describe('telemetry disclosure', () => {
  it('matches snapshot for default envelope', () => {
    expect(generateDisclosure('evlog-cli').markdown).toMatchSnapshot()
  })

  it('matches snapshot with collect extensions', () => {
    const doc = generateDisclosure('evlog-cli', {
      flags: { format: ['json', 'csv'] },
      fields: { framework: ['nuxt', 'next'] },
    })
    expect(doc).toMatchSnapshot()
  })
})

describe('telemetry payload snapshot', () => {
  it('matches enriched run event shape', () => {
    const key = computeRunIdempotencyKey({
      command: 'doctor',
      tool: { name: 'evlog-cli', version: '0.1.0' },
      timestamp: '2026-07-14T12:00:00.000Z',
      machineId: 'ab3f0123456789ab',
    })
    expect(exampleRunEvent({ idempotencyKey: key })).toMatchSnapshot()
  })
})

describe('telemetry status command', () => {
  it('prints the local data directory', async () => {
    const { defineTelemetryCommands } = await import('../src/commands')
    const { getTelemetryDir } = await import('../src/paths')
    const writes: string[] = []
    const original = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
      return true
    }) as typeof process.stderr.write

    try {
      const tree = defineTelemetryCommands({ name: TOOL })
      const subs = typeof tree.subCommands === 'function' ? await tree.subCommands() : await tree.subCommands
      const status = subs?.status
      expect(status).toBeDefined()
      const cmd = typeof status === 'function' ? await status() : await status
      await runCommand(cmd!, { rawArgs: [] })
      const out = writes.join('')
      expect(out).toContain(`Data directory: ${getTelemetryDir(TOOL)}`)
      expect(out).toMatch(/Telemetry: (enabled|disabled)/)
    } finally {
      process.stderr.write = original
    }
  })
})

describe('citty flag capture', () => {
  let base: string

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'evlog-telemetry-'))
    process.env.XDG_CONFIG_HOME = base
    process.env.EVLOG_TELEMETRY = '1'
  })

  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
    delete process.env.XDG_CONFIG_HOME
    delete process.env.EVLOG_TELEMETRY
    _resetActiveTelemetryForTests()
  })

  /** The wrapper's own view of a run — parsed args in, outbox event out. */
  async function runWrapped(rawArgs: string[]) {
    const command = withTelemetry(
      defineCommand({
        meta: { name: 'scan' },
        args: {
          entry: { type: 'positional', required: false },
          write: { type: 'boolean', default: true },
          minScore: { type: 'string' },
          all: { type: 'boolean' },
        },
        run: () => {},
      }),
      { name: TOOL, version: '0.0.0' },
    )
    await runCommand(command, { rawArgs })
    const [event] = await new TelemetryOutbox({ toolName: TOOL }).readAll()
    return event!
  }

  it('reports the flags the user passed, not the parser defaults', async () => {
    const event = await runWrapped(['--all', '--min-score', '90'])
    expect(event.flags).toEqual({ all: true, minScore: FLAG_VALUE_SET })
  })

  it('keeps a defaulted flag once it is negated', async () => {
    const event = await runWrapped(['--no-write'])
    expect(event.flags).toEqual({ write: false })
  })

  it('leaves positional values out of the payload', async () => {
    const event = await runWrapped(['server/api/checkout.ts'])
    expect(event.flags).toEqual({ entry: FLAG_VALUE_SET })
  })

  it('wraps lazily loaded subcommands without loading the others', async () => {
    let loadedOther = false
    const command = withTelemetry(
      defineCommand({
        meta: { name: 'tool' },
        subCommands: {
          scan: () => Promise.resolve(defineCommand({
            meta: { name: 'scan' },
            args: { all: { type: 'boolean' } },
            run: () => {},
          })),
          other: () => {
            loadedOther = true
            return defineCommand({ meta: { name: 'other' }, run: () => {} })
          },
        },
      }),
      { name: TOOL, version: '0.0.0' },
    )
    await runCommand(command, { rawArgs: ['scan', '--all'] })
    const [event] = await new TelemetryOutbox({ toolName: TOOL }).readAll()
    expect(event!.command).toBe('scan')
    expect(event!.flags).toEqual({ all: true })
    expect(loadedOther).toBe(false)
  })

  it('reads the argument definitions citty resolved instead of resolving them again', async () => {
    let resolutions = 0
    const command = withTelemetry(
      defineCommand({
        meta: { name: 'scan' },
        args: () => {
          resolutions += 1
          return { write: { type: 'boolean', default: true } }
        },
        run: () => {},
      }),
      { name: TOOL, version: '0.0.0' },
    )
    await runCommand(command, { rawArgs: ['--no-write'] })
    const [event] = await new TelemetryOutbox({ toolName: TOOL }).readAll()
    expect(resolutions).toBe(1)
    expect(event!.flags).toEqual({ write: false })
  })

  it('records one event for a leaf under a parent that has no run of its own', async () => {
    const command = withTelemetry(
      defineCommand({
        meta: { name: 'tool' },
        subCommands: {
          telemetry: {
            meta: { name: 'telemetry' },
            subCommands: {
              status: defineCommand({ meta: { name: 'status' }, run: () => {} }),
            },
          },
        },
      }),
      { name: TOOL, version: '0.0.0' },
    )
    await runCommand(command, { rawArgs: ['telemetry', 'status'] })
    const events = await new TelemetryOutbox({ toolName: TOOL }).readAll()
    expect(events.map(event => event.command)).toEqual(['telemetry status'])
  })
})
