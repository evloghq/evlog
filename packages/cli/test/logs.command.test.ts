import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCommand } from 'citty'
import type { WideEvent } from 'evlog'
import { afterEach, describe, expect, it, vi } from 'vitest'
import logs, { runLogs } from '../src/commands/logs'
import { createContext } from '../src/core/context'
import type { CliContext } from '../src/core/context'
import { buildQuery, matchesId, parseDuration, parseTime } from '../src/lib/logs/query'
import { formatEvent, formatLine } from '../src/lib/logs/render'
import { createStyle } from '../src/core/output'

const NOW = new Date('2026-10-01T12:00:00.000Z')
const tempDirs: string[] = []

function event(overrides: Record<string, unknown>): WideEvent {
  return {
    timestamp: '2026-10-01T11:00:00.000Z',
    level: 'info',
    service: 'shop',
    environment: 'development',
    method: 'GET',
    path: '/api/items',
    status: 200,
    durationMs: 12,
    duration: '12ms',
    requestId: 'aaaaaaaa-0000-4000-8000-000000000001',
    ...overrides,
  } as WideEvent
}

/** Six requests over two days, one of them pretty-printed, in the fs drain's layout. */
const EVENTS: WideEvent[] = [
  event({ timestamp: '2026-09-30T08:00:00.000Z', requestId: 'bbbbbbbb-0000-4000-8000-000000000002', path: '/api/health', durationMs: 2, duration: '2ms' }),
  event({ timestamp: '2026-10-01T10:00:00.000Z', requestId: 'cccccccc-0000-4000-8000-000000000003', method: 'POST', path: '/api/checkout', status: 402, level: 'error', durationMs: 412, duration: '412ms',
    error: { name: 'Error', message: 'Payment processing failed', statusCode: 402, data: { why: 'Card declined by issuer', fix: 'Use another card', link: 'https://docs.example.com/declined' }, stack: 'Error: Payment processing failed\n    at handler (checkout.ts:12:3)\n    at run (h3.mjs:2017:19)' },
    cart: { items: 3, total: 9999 } }),
  event({ timestamp: '2026-10-01T10:30:00.000Z', requestId: 'dddddddd-0000-4000-8000-000000000004', _parentRequestId: 'aaaaaaaa-0000-4000-8000-000000000001', path: '/api/reports', durationMs: 1200, duration: '1.2s', report: { id: 'r-1' } }),
  event({ timestamp: '2026-10-01T11:00:00.000Z', requestId: 'eeeeeeee-0000-4000-8000-000000000005', method: 'POST', path: '/api/refund', status: 200, durationMs: 80, duration: '80ms',
    audit: { action: 'billing.refund', actor: { type: 'user', id: 'usr_42' }, target: { type: 'invoice', id: 'inv_1' }, outcome: 'success' } }),
  event({ timestamp: '2026-10-01T11:30:00.000Z', requestId: 'ffffffff-0000-4000-8000-000000000006', path: '/api/items', status: 500, durationMs: 30, duration: '30ms' }),
  event({ timestamp: '2026-10-01T11:45:00.000Z', requestId: 'aaaaaaaa-0000-4000-8000-000000000001', path: '/api/items', level: 'warn', durationMs: 700, duration: '700ms', user: { id: 'usr_7', plan: 'pro' } }),
]

async function makeSink(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'evlog-cli-logs-'))
  tempDirs.push(cwd)
  await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'shop' }))
  const dir = join(cwd, '.evlog', 'logs')
  await mkdir(dir, { recursive: true })
  /* The first day is pretty-printed, the way `pretty: true` writes it. */
  await writeFile(join(dir, '2026-09-30.jsonl'), `${JSON.stringify(EVENTS[0], null, 2)}\n`)
  await writeFile(join(dir, '2026-10-01.jsonl'), `${EVENTS.slice(1).map(e => JSON.stringify(e)).join('\n') }\n`)
  return cwd
}

function fakeContext(cwd: string, overrides: Partial<CliContext> = {}): CliContext {
  return createContext({ cwd, env: {}, nodeVersion: 'v22.0.0', tty: false, color: false, columns: 120, ...overrides })
}

function captureStdout(): string[] {
  const out: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    out.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
    return true
  }) as typeof process.stdout.write)
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  return out
}

afterEach(async () => {
  vi.restoreAllMocks()
  process.exitCode = undefined
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('parsing', () => {
  it('reads durations with and without a unit', () => {
    expect(parseDuration('500')).toBe(500)
    expect(parseDuration('1.5s')).toBe(1500)
    expect(parseDuration('15m')).toBe(900_000)
    expect(parseDuration('2h')).toBe(7_200_000)
    expect(parseDuration('3d')).toBe(259_200_000)
    expect(parseDuration('soon')).toBeUndefined()
  })

  it('reads --since as a duration back or a date, and refuses the rest', () => {
    expect(parseTime('since', '15m', NOW)?.toISOString()).toBe('2026-10-01T11:45:00.000Z')
    expect(parseTime('since', '2026-09-30', NOW)?.toISOString()).toBe('2026-09-30T00:00:00.000Z')
    expect(parseTime('since', undefined, NOW)).toBeUndefined()
    expect(() => parseTime('since', 'yesterday-ish', NOW)).toThrow(/Invalid --since/)
  })

  it('picks the view from the positional', () => {
    expect(buildQuery({}).view).toBe('recent')
    expect(buildQuery({ what: 'errors' }).view).toBe('errors')
    expect(buildQuery({ what: 'slow' }).view).toBe('slow')
    expect(buildQuery({ what: 'cccccccc' })).toMatchObject({ view: 'trace', id: 'cccccccc' })
  })

  it.each([
    [{ level: 'loud' }, /Unknown level/],
    [{ status: '42' }, /Invalid --status/],
    [{ status: '6xx' }, /Invalid --status/],
    [{ over: 'fast' }, /Invalid --over/],
    [{ limit: '0' }, /Invalid --limit/],
  ])('rejects %o', (args, message) => {
    expect(() => buildQuery(args)).toThrow(message)
  })

  it('matches an id exactly, or by a prefix of at least eight characters', () => {
    const e = event({ requestId: 'cccccccc-0000-4000-8000-000000000003', traceId: 'trace-1' })
    expect(matchesId(e, 'cccccccc-0000-4000-8000-000000000003')).toBe(true)
    expect(matchesId(e, 'cccccccc')).toBe(true)
    expect(matchesId(e, 'ccc')).toBe(false)
    expect(matchesId(e, 'trace-1')).toBe(true)
  })
})

describe('runLogs', () => {
  it('shows the last events oldest first, across both file formats', async () => {
    const cwd = await makeSink()
    const result = await runLogs(fakeContext(cwd), {}, { now: NOW })
    expect(result.dir).toBe(join(cwd, '.evlog', 'logs'))
    expect(result.matched).toBe(6)
    expect(result.events.map(e => e.path)).toEqual(['/api/health', '/api/checkout', '/api/reports', '/api/refund', '/api/items', '/api/items'])
  })

  it('keeps the newest when --limit cuts the list', async () => {
    const cwd = await makeSink()
    const result = await runLogs(fakeContext(cwd), { limit: '2' }, { now: NOW })
    expect(result.events.map(e => e.status)).toEqual([500, 200])
    expect(result.matched).toBe(6)
  })

  it('errors: a failing status, an error level, or an error block', async () => {
    const cwd = await makeSink()
    const result = await runLogs(fakeContext(cwd), { what: 'errors' }, { now: NOW })
    expect(result.events.map(e => [e.path, e.status])).toEqual([['/api/checkout', 402], ['/api/items', 500]])
  })

  it('slow: worst first, above --over', async () => {
    const cwd = await makeSink()
    const slow = await runLogs(fakeContext(cwd), { what: 'slow' }, { now: NOW })
    expect(slow.events.map(e => e.durationMs)).toEqual([1200, 700])
    const slower = await runLogs(fakeContext(cwd), { what: 'slow', over: '1s' }, { now: NOW })
    expect(slower.events.map(e => e.durationMs)).toEqual([1200])
  })

  it('trace: every event carrying the id, by prefix', async () => {
    const cwd = await makeSink()
    const result = await runLogs(fakeContext(cwd), { what: 'aaaaaaaa' }, { now: NOW })
    /* The forked report event links back through `_parentRequestId`. */
    expect(result.events.map(e => e.path)).toEqual(['/api/reports', '/api/items'])
  })

  it('filters on time, level, path and status class together', async () => {
    const cwd = await makeSink()
    const ctx = fakeContext(cwd)
    /* `since` is inclusive: the checkout at exactly 10:00 is two hours before noon. */
    expect((await runLogs(ctx, { since: '2h' }, { now: NOW })).events.map(e => e.timestamp)).toEqual(['2026-10-01T10:00:00.000Z', '2026-10-01T10:30:00.000Z', '2026-10-01T11:00:00.000Z', '2026-10-01T11:30:00.000Z', '2026-10-01T11:45:00.000Z'])
    expect((await runLogs(ctx, { until: '2026-10-01T10:00:00.000Z' }, { now: NOW })).events).toHaveLength(2)
    expect((await runLogs(ctx, { level: 'warn,error' }, { now: NOW })).events.map(e => e.level)).toEqual(['error', 'warn'])
    expect((await runLogs(ctx, { path: '/api/items', status: '5xx' }, { now: NOW })).events).toHaveLength(1)
    expect((await runLogs(ctx, { status: '402' }, { now: NOW })).events.map(e => e.path)).toEqual(['/api/checkout'])
  })

  it('reads --dir as given and refuses a project with no sink', async () => {
    const cwd = await makeSink()
    const elsewhere = await mkdtemp(join(tmpdir(), 'evlog-cli-logs-other-'))
    tempDirs.push(elsewhere)
    await writeFile(join(elsewhere, 'package.json'), '{"name":"other"}')
    const result = await runLogs(fakeContext(elsewhere), {}, { dir: join(cwd, '.evlog', 'logs'), now: NOW })
    expect(result.matched).toBe(6)
    await expect(runLogs(fakeContext(elsewhere), {}, { now: NOW })).rejects.toThrow(/No local logs/)
  })

  it('follows: new lines arrive through onEvent until the signal aborts', async () => {
    const cwd = await makeSink()
    const controller = new AbortController()
    const seen: WideEvent[] = []
    const run = runLogs(fakeContext(cwd), { path: '/api/items' }, {
      follow: true,
      signal: controller.signal,
      now: NOW,
      onEvent: (event) => {
        seen.push(event)
        controller.abort()
      },
    })
    await new Promise(resolve => setTimeout(resolve, 300))
    await appendFile(join(cwd, '.evlog', 'logs', '2026-10-01.jsonl'), `${JSON.stringify(event({ timestamp: '2026-10-01T11:50:00.000Z', path: '/api/other' }))}\n${JSON.stringify(event({ timestamp: '2026-10-01T11:51:00.000Z', path: '/api/items', status: 201 }))}\n`)
    const result = await run
    expect(result.matched).toBe(2)
    expect(seen.map(e => e.status)).toEqual([201])
  })
})

describe('rendering', () => {
  const style = createStyle({ color: false })

  it('puts the error, the audit record, or the business fields at the end of the line', () => {
    expect(formatLine(style, EVENTS[1]!)).toMatch(/POST {3}\/api\/checkout\s+402\s+412ms\s+✗ Error: Payment processing failed · Card declined by issuer$/)
    expect(formatLine(style, EVENTS[3]!)).toMatch(/audit billing\.refund user:usr_42 → invoice:inv_1 success$/)
    expect(formatLine(style, EVENTS[5]!)).toMatch(/user\.id=usr_7$/)
  })

  it('shows why, fix and the first frames of the stack for one event', () => {
    const text = formatEvent(style, EVENTS[1]!)
    expect(text).toContain('why      Card declined by issuer')
    expect(text).toContain('fix      Use another card')
    expect(text).toContain('at handler (checkout.ts:12:3)')
    expect(text).toContain('"cart"')
    expect(text).not.toContain('"error"')
  })
})

describe('logs command', () => {
  it('--json is an envelope with the events and the counts', async () => {
    const cwd = await makeSink()
    const out = captureStdout()
    await runCommand(logs, { rawArgs: ['--cwd', cwd, '--json', '--no-header', 'errors'] })
    const payload = JSON.parse(out.join('')) as { view: string, count: number, matched: number, events: Array<{ path: string }> }
    expect(payload.view).toBe('errors')
    expect(payload.count).toBe(2)
    expect(payload.matched).toBe(2)
    expect(payload.events.map(e => e.path)).toEqual(['/api/checkout', '/api/items'])
    expect(process.exitCode).toBeUndefined()
  })

  it('a bad flag is a usage error, before any file is read', async () => {
    const cwd = await makeSink()
    const out = captureStdout()
    await runCommand(logs, { rawArgs: ['--cwd', cwd, '--json', '--no-header', '--since', 'nope'] })
    expect(JSON.parse(out.join('')).error.code).toBe('cli.LOGS_INVALID_TIME')
    expect(process.exitCode).toBe(2)
  })

  it('no sink is a failure with the fix', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evlog-cli-logs-empty-'))
    tempDirs.push(cwd)
    await writeFile(join(cwd, 'package.json'), '{"name":"empty"}')
    const out = captureStdout()
    await runCommand(logs, { rawArgs: ['--cwd', cwd, '--json', '--no-header'] })
    expect(JSON.parse(out.join('')).error.code).toBe('cli.LOGS_NO_SINK')
    expect(process.exitCode).toBe(1)
  })
})
