import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCommand } from 'citty'
import type { WideEvent } from 'evlog'
import { afterEach, describe, expect, it, vi } from 'vitest'
import logs, { runLogs } from '../src/commands/logs'
import { createContext } from '../src/core/context'
import type { CliContext } from '../src/core/context'
import { buildQuery, createSelection, matchesId, matchesWhere, parseDuration, parseTime, parseWhere } from '../src/lib/logs/query'
import { formatEvent, formatLine, formatLogsReport } from '../src/lib/logs/render'
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

  it('reads every --where shape', () => {
    expect(parseWhere('user.id=42')).toEqual({ path: ['user', 'id'], op: '=', value: 42 })
    expect(parseWhere('payment.amount>5000')).toMatchObject({ op: '>', value: 5000 })
    expect(parseWhere('status<=299')).toMatchObject({ op: '<=', value: 299 })
    expect(parseWhere('audit.outcome!=success')).toMatchObject({ op: '!=', value: 'success' })
    expect(parseWhere('error.message~declined')).toMatchObject({ op: '~' })
    expect(parseWhere('path="/a b"')).toMatchObject({ op: '=', value: '/a b' })
    expect(parseWhere('audit')).toEqual({ path: ['audit'], op: 'exists', value: undefined })
    expect(parseWhere('!error')).toEqual({ path: ['error'], op: 'absent', value: undefined })
    expect(parseWhere('cart.items=true')).toMatchObject({ value: true })
  })

  it.each(['', '=1', '!user=1', 'a~[', 'a>>1'])('rejects --where %j', (raw) => {
    expect(() => parseWhere(raw)).toThrow(/Invalid --where/)
  })

  it('compares numbers as numbers, strings as strings, and reaches into objects', () => {
    const e = event({ user: { id: 'usr_7', plan: 'pro' }, cart: { total: 9999 } })
    expect(matchesWhere(e, parseWhere('cart.total>5000'))).toBe(true)
    expect(matchesWhere(e, parseWhere('cart.total>10000'))).toBe(false)
    expect(matchesWhere(e, parseWhere('user.plan=pro'))).toBe(true)
    expect(matchesWhere(e, parseWhere('user.plan!=pro'))).toBe(false)
    expect(matchesWhere(e, parseWhere('user.id~^usr_'))).toBe(true)
    expect(matchesWhere(e, parseWhere('user'))).toBe(true)
    expect(matchesWhere(e, parseWhere('!error'))).toBe(true)
    expect(matchesWhere(e, parseWhere('error'))).toBe(false)
    expect(matchesWhere(e, parseWhere('missing.deep=1'))).toBe(false)
  })

  it('reads a numeric field that arrived as text as the number it is', () => {
    const e = event({ headers: { 'content-length': '10000' }, label: '5kg' })
    expect(matchesWhere(e, parseWhere('headers.content-length>5000'))).toBe(true)
    expect(matchesWhere(e, parseWhere('headers.content-length<5000'))).toBe(false)
    expect(matchesWhere(e, parseWhere('headers.content-length=10000'))).toBe(true)
    /* Text that is not a number is still compared as text, not coerced. */
    expect(matchesWhere(e, parseWhere('label=5kg'))).toBe(true)
    expect(matchesWhere(e, parseWhere('label=5'))).toBe(false)
  })

  it('reads only text that spells a number exactly as a number', () => {
    const e = event({ user: { id: '1234567890123456800' }, zip: '00123', amount: 'n/a', price: '5000.50' })
    /* Past what a double holds, two different ids would compare equal. */
    expect(matchesWhere(e, parseWhere('user.id=1234567890123456789'))).toBe(false)
    expect(matchesWhere(e, parseWhere('user.id=1234567890123456800'))).toBe(true)
    expect(matchesWhere(e, parseWhere('zip=123'))).toBe(false)
    expect(matchesWhere(e, parseWhere('zip=00123'))).toBe(true)
    expect(matchesWhere(e, parseWhere('price>5000.5'))).toBe(false)
    expect(matchesWhere(e, parseWhere('price>=5000.50'))).toBe(true)
  })

  it('never orders text that is not a number against a number', () => {
    const e = event({ amount: 'n/a' })
    expect(matchesWhere(e, parseWhere('amount>5000'))).toBe(false)
    expect(matchesWhere(e, parseWhere('amount<5000'))).toBe(false)
    expect(matchesWhere(e, parseWhere('amount!=5000'))).toBe(true)
    expect(matchesWhere(e, parseWhere('amount=5000'))).toBe(false)
  })

  it('takes several --where clauses and requires all of them', () => {
    const query = buildQuery({ where: ['status=200', 'durationMs>50'] })
    expect(query.where).toHaveLength(2)
    expect(query.filter(event({ status: 200, durationMs: 80 }))).toBe(true)
    expect(query.filter(event({ status: 200, durationMs: 10 }))).toBe(false)
    expect(buildQuery({ where: 'status=200' }).where).toHaveLength(1)
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
    expect(result.sources).toEqual(['.evlog/logs'])
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

  it('trace: a complete id selects its own request, not the longer ids it is a prefix of', () => {
    const select = (id: string) => {
      const query = buildQuery({ what: id })
      const selection = createSelection(query)
      for (const turn of ['turn_1', ...Array.from({ length: 10 }, (_, i) => `turn_1${i}`)]) {
        const e = event({ requestId: `wrun_demo:${turn}` })
        if (query.filter(e)) selection.add(e)
      }
      return selection.done()
    }
    const exact = select('wrun_demo:turn_1')
    expect(exact.matched).toBe(1)
    expect(exact.events.map(e => e.requestId)).toEqual(['wrun_demo:turn_1'])
    /* No event carries the id whole, so it is still read as a prefix. */
    expect(select('wrun_demo:turn_10').matched).toBe(1)
    expect(select('wrun_demo:turn').matched).toBe(11)
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

  it('--where composes with a view', async () => {
    const cwd = await makeSink()
    const ctx = fakeContext(cwd)
    expect((await runLogs(ctx, { where: 'audit.actor.id=usr_42' }, { now: NOW })).events.map(e => e.path)).toEqual(['/api/refund'])
    expect((await runLogs(ctx, { what: 'errors', where: 'error.data.why~declined' }, { now: NOW })).events.map(e => e.status)).toEqual([402])
    expect((await runLogs(ctx, { where: ['!error', 'durationMs>=700'] }, { now: NOW })).events.map(e => e.path)).toEqual(['/api/reports', '/api/items'])
  })

  it('--session keeps one conversation, and a redelivered event shows once', async () => {
    const cwd = await makeSink()
    const turn = (session: string, turnId: string, at: string): WideEvent => event({
      timestamp: at, path: undefined, method: undefined, operation: 'turn', requestId: `${session}:${turnId}`,
      idempotencyKey: `${session}:${turnId}`, gen_ai: { conversation: { id: session } },
    })
    const turns = [
      turn('wrun_A', 'turn_0', '2026-10-01T11:50:00.000Z'),
      turn('wrun_B', 'turn_0', '2026-10-01T11:51:00.000Z'),
      turn('wrun_A', 'turn_1', '2026-10-01T11:52:00.000Z'),
      /* The step that emitted turn_1 was retried, so the drain wrote it again. */
      turn('wrun_A', 'turn_1', '2026-10-01T11:52:00.000Z'),
      /* Without an idempotencyKey, two identical events stay two. */
      event({ timestamp: '2026-10-01T11:53:00.000Z', requestId: 'gggggggg-0000-4000-8000-000000000007' }),
      event({ timestamp: '2026-10-01T11:53:00.000Z', requestId: 'gggggggg-0000-4000-8000-000000000007' }),
    ]
    await appendFile(join(cwd, '.evlog', 'logs', '2026-10-01.jsonl'), `${turns.map(e => JSON.stringify(e)).join('\n')}\n`)
    const ctx = fakeContext(cwd)

    const session = await runLogs(ctx, { session: 'wrun_A' }, { now: NOW })
    expect(session.events.map(e => e.requestId)).toEqual(['wrun_A:turn_0', 'wrun_A:turn_1'])
    const all = await runLogs(ctx, {}, { now: NOW })
    expect(all.matched).toBe(EVENTS.length + 5)
    expect(all.events.filter(e => e.requestId === 'gggggggg-0000-4000-8000-000000000007')).toHaveLength(2)
  })

  it('stats: per route with errors first, then by status class and level', async () => {
    const cwd = await makeSink()
    const result = await runLogs(fakeContext(cwd), { what: 'stats' }, { now: NOW })
    expect(result.events).toEqual([])
    expect(result.matched).toBe(6)
    const stats = result.stats!
    expect(stats.total).toBe(6)
    expect(stats.errors).toBe(2)
    expect(stats.byRoute[0]).toEqual({ route: 'GET /api/items', count: 2, errors: 1, p50: 30, p95: 700 })
    expect(stats.byRoute[1]).toMatchObject({ route: 'POST /api/checkout', count: 1, errors: 1, p50: 412 })
    expect(stats.byStatus).toEqual({ '2xx': 4, '4xx': 1, '5xx': 1 })
    expect(stats.byLevel).toEqual({ info: 4, error: 1, warn: 1 })
  })

  it('reads every app of a workspace when the root has no logs, labelling each event', async () => {
    const root = await mkdtemp(join(tmpdir(), 'evlog-cli-logs-mono-'))
    tempDirs.push(root)
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'mono', workspaces: ['apps/*'] }))
    for (const [app, path, at] of [['web', '/home', '2026-10-01T10:00:00.000Z'], ['api', '/users', '2026-10-01T09:00:00.000Z']] as const) {
      await mkdir(join(root, 'apps', app, '.evlog', 'logs'), { recursive: true })
      await writeFile(join(root, 'apps', app, 'package.json'), JSON.stringify({ name: app }))
      await writeFile(join(root, 'apps', app, '.evlog', 'logs', '2026-10-01.jsonl'), `${JSON.stringify(event({ path, timestamp: at }))}\n`)
    }
    await mkdir(join(root, 'apps', 'docs'))
    const result = await runLogs(fakeContext(root), {}, { now: NOW })
    expect(result.sources).toEqual(['apps/api/.evlog/logs', 'apps/web/.evlog/logs'])
    expect(result.events.map(e => e.path)).toEqual(['/users', '/home'])
    expect(formatLine(createStyle({ color: false }), result.events[0]!)).toMatch(/^\S+  api\s+GET    \/users/)
  })

  it('orders a workspace by time in every view, whatever order the files are read in', async () => {
    const root = await mkdtemp(join(tmpdir(), 'evlog-cli-logs-mono-'))
    tempDirs.push(root)
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'mono', workspaces: ['apps/*'] }))
    const apps = {
      api: [['/a1', '09:00', 100, 'info'], ['/a2', '12:00', 900, 'warn'], ['/a3', '08:00', 900, 'error']],
      web: [['/w1', '10:00', 900, 'debug'], ['/w2', '11:00', 50, 'info'], ['/w3', '08:00', 10, 'info']],
    } as const
    for (const [app, rows] of Object.entries(apps)) {
      await mkdir(join(root, 'apps', app, '.evlog', 'logs'), { recursive: true })
      const lines = rows.map(([path, at, durationMs, level]) => JSON.stringify(event({ path, timestamp: `2026-10-01T${at}:00.000Z`, durationMs, level })))
      await writeFile(join(root, 'apps', app, '.evlog', 'logs', '2026-10-01.jsonl'), `${lines.join('\n')}\n`)
    }
    const ctx = fakeContext(root)

    /* By time: a3 and w3 at 08:00 in the order read, then a1, w1, w2, a2. */
    expect((await runLogs(ctx, { limit: '2' }, { now: NOW })).events.map(e => e.path)).toEqual(['/w2', '/a2'])
    expect((await runLogs(ctx, { what: 'slow', limit: '2' }, { now: NOW })).events.map(e => e.path)).toEqual(['/a3', '/w1'])
    expect(Object.entries((await runLogs(ctx, { what: 'stats' }, { now: NOW })).stats!.byLevel)).toEqual([['error', 1], ['info', 3], ['debug', 1], ['warn', 1]])
  })

  it('reads a memory drain endpoint with --url, and follows it by polling', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evlog-cli-logs-url-'))
    tempDirs.push(cwd)
    const snapshot: WideEvent[] = [EVENTS[1]!, EVENTS[4]!]
    const fetchFn = (() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(snapshot) })) as unknown as typeof fetch
    const result = await runLogs(fakeContext(cwd), { what: 'errors' }, { url: 'http://localhost:3000/_evlog/logs', fetchFn, now: NOW })
    expect(result.sources).toEqual(['http://localhost:3000/_evlog/logs'])
    expect(result.events.map(e => e.status)).toEqual([402, 500])

    const wrapped = (() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ events: snapshot }) })) as unknown as typeof fetch
    expect((await runLogs(fakeContext(cwd), {}, { url: 'http://x', fetchFn: wrapped, now: NOW })).matched).toBe(2)

    const controller = new AbortController()
    const seen: WideEvent[] = []
    const run = runLogs(fakeContext(cwd), {}, {
      url: 'http://x', fetchFn, follow: true, signal: controller.signal, now: NOW,
      onEvent: (e) => {
        seen.push(e)
        if (seen.length === 3) controller.abort()
      },
    })
    await new Promise(resolve => setTimeout(resolve, 50))
    snapshot.push(event({ timestamp: '2026-10-01T11:59:00.000Z', path: '/api/new' }))
    await run
    expect(seen.map(e => e.path)).toEqual(['/api/checkout', '/api/items', '/api/new'])
  })

  it('a failed poll is a gap in the follow, not the end of it', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evlog-cli-logs-url-flaky-'))
    tempDirs.push(cwd)
    const snapshot: WideEvent[] = [EVENTS[0]!]
    let polls = 0
    const flaky = (() => {
      polls += 1
      /* The second call is the first poll: the app is restarting. */
      if (polls === 2) return Promise.reject(new Error('ECONNREFUSED'))
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(snapshot) })
    }) as unknown as typeof fetch

    const controller = new AbortController()
    const seen: WideEvent[] = []
    const run = runLogs(fakeContext(cwd), {}, {
      url: 'http://x', fetchFn: flaky, follow: true, signal: controller.signal, now: NOW,
      onEvent: (e) => {
        seen.push(e)
        if (seen.length === 2) controller.abort()
      },
    })
    await new Promise(resolve => setTimeout(resolve, 50))
    snapshot.push(event({ timestamp: '2026-10-01T11:59:00.000Z', path: '/api/back-up' }))
    await run
    expect(polls).toBeGreaterThanOrEqual(3)
    expect(seen.map(e => e.path)).toEqual(['/api/health', '/api/back-up'])
  })

  it('hands the abort signal to the fetch, so a stalled poll can be interrupted', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evlog-cli-logs-url-signal-'))
    tempDirs.push(cwd)
    const signals: Array<AbortSignal | undefined> = []
    const controller = new AbortController()
    const fetchFn = ((_url: string, init?: { signal?: AbortSignal }) => {
      signals.push(init?.signal)
      if (signals.length === 2) controller.abort()
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([EVENTS[1]!]) })
    }) as unknown as typeof fetch

    await runLogs(fakeContext(cwd), {}, { url: 'http://x', fetchFn, follow: true, signal: controller.signal, pollIntervalMs: 5, now: NOW })

    expect(signals).toHaveLength(2)
    expect(signals.every(signal => signal === controller.signal)).toBe(true)
  })

  it('says when a followed endpoint goes quiet, and when it answers again', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evlog-cli-logs-url-quiet-'))
    tempDirs.push(cwd)
    let calls = 0
    const fetchFn = (() => {
      calls += 1
      /* The first call is the one-shot read; then six dead polls, then it is back. */
      if (calls > 1 && calls <= 7) return Promise.reject(new Error('ECONNREFUSED'))
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([EVENTS[1]!]) })
    }) as unknown as typeof fetch

    const controller = new AbortController()
    const notices: string[] = []
    await runLogs(fakeContext(cwd), {}, {
      url: 'http://x',
      fetchFn,
      follow: true,
      signal: controller.signal,
      pollIntervalMs: 5,
      now: NOW,
      onNotice: (message) => {
        notices.push(message)
        if (notices.length === 2) controller.abort()
      },
    })

    /* One line per outage, not one per poll: the sixth failure is silent. */
    expect(notices).toEqual([
      'no answer from http://x for 5 polls (Could not read events from http://x: ECONNREFUSED) — still trying',
      'http://x is answering again',
    ])
  })

  it('an unreachable --url is a failure with the fix', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evlog-cli-logs-url-down-'))
    tempDirs.push(cwd)
    const down = (() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch
    await expect(runLogs(fakeContext(cwd), {}, { url: 'http://localhost:1', fetchFn: down })).rejects.toThrow(/Could not read events from http:\/\/localhost:1: ECONNREFUSED/)
    const notJson = (() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ hello: 1 }) })) as unknown as typeof fetch
    await expect(runLogs(fakeContext(cwd), {}, { url: 'http://x', fetchFn: notJson })).rejects.toThrow(/not a JSON array/)
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

  it('follows: what it already found streams first, then what arrives, until the signal aborts', async () => {
    const cwd = await makeSink()
    const controller = new AbortController()
    const seen: WideEvent[] = []
    const run = runLogs(fakeContext(cwd), { path: '/api/items' }, {
      follow: true,
      signal: controller.signal,
      now: NOW,
      onEvent: (event) => {
        seen.push(event)
        if (seen.length === 3) controller.abort()
      },
    })
    await new Promise(resolve => setTimeout(resolve, 300))
    await appendFile(join(cwd, '.evlog', 'logs', '2026-10-01.jsonl'), `${JSON.stringify(event({ timestamp: '2026-10-01T11:50:00.000Z', path: '/api/other' }))}\n${JSON.stringify(event({ timestamp: '2026-10-01T11:51:00.000Z', path: '/api/items', status: 201 }))}\n`)
    const result = await run
    expect(result.matched).toBe(2)
    /* The two already on disk, oldest first, then the one appended. */
    expect(seen.map(e => e.status)).toEqual([500, 200, 201])
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

describe('events that do not have the usual shape', () => {
  const style = createStyle(fakeContext('/tmp'))
  const odd = [
    { timestamp: '2026-10-01T11:00:00.000Z', level: 'info', duration: 12, status: 200, path: '/api/items', method: 'GET' },
    { timestamp: '2026-10-01T11:00:00.000Z' },
    { level: 7, service: 3, method: 5, path: 9, duration: { ms: 1 } },
  ] as unknown as WideEvent[]

  it('prints one line for each', () => {
    expect(formatLine(style, odd[0]!)).toContain('GET    /api/items')
    expect(formatLine(style, odd[0]!)).toMatch(/ {5}12$/)
    expect(odd.map(e => formatLine(style, e).includes('\n'))).toEqual([false, false, false])
  })

  it('prints each in full', () => {
    for (const e of odd) expect(formatEvent(style, e)).toEqual(expect.any(String))
  })

  it('prints every view of a log that holds them', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evlog-cli-logs-odd-'))
    tempDirs.push(cwd)
    await writeFile(join(cwd, 'package.json'), '{"name":"odd"}')
    await mkdir(join(cwd, '.evlog', 'logs'), { recursive: true })
    await writeFile(join(cwd, '.evlog', 'logs', '2026-10-01.jsonl'), `${odd.map(e => JSON.stringify(e)).join('\n')}\n`)

    for (const what of [undefined, 'errors', 'slow', 'stats']) {
      const result = await runLogs(fakeContext(cwd), { what }, { now: NOW })
      expect(formatLogsReport(fakeContext(cwd), result)).toEqual(expect.any(String))
    }
  })
})

describe('control characters in logged values', () => {
  // The only escape sequences the CLI writes itself are SGR colour codes.
  const ownColors = /\x1B\[[0-9;]*m/g
  const controlChar = /[\x00-\x08\x0A-\x1F\x7F-\x9F]/
  const style = createStyle({ color: true })
  const spoof = '\r\x1B[2K\x1B[32m11:00:00  GET    /admin  200'
  const escaped = '\\r\\u001b[2K\\u001b[32m11:00:00  GET    /admin  200'

  function visibleLines(text: string): string[] {
    return text.replace(ownColors, '').split('\n')
  }

  it('escapes them in the one-line view', () => {
    const lines = [
      formatLine(style, event({ method: `GET${spoof}`, path: `/x${spoof}`, duration: `1ms${spoof}`, user: { id: `u${spoof}` } })),
      formatLine(style, event({ status: undefined, level: `info${spoof}` })),
      formatLine(style, event({ level: 'error', status: 500, error: { name: 'Error', message: `boom${spoof}`, data: { why: `why${spoof}` } } })),
      formatLine(style, event({ audit: { action: `billing.refund${spoof}`, actor: { type: 'user', id: 'usr_42' }, outcome: 'success' } })),
    ]
    for (const line of lines) {
      expect(visibleLines(line)).toHaveLength(1)
      expect(line.replace(ownColors, '')).not.toMatch(controlChar)
      expect(line).toContain(escaped)
    }
  })

  it('escapes them in the full view of one event, fields included', () => {
    const text = formatEvent(style, event({
      level: 'error',
      status: 500,
      requestId: `aaaaaaaa${spoof}`,
      error: { name: 'Error', message: `boom${spoof}`, data: { why: `why\nsecond line` }, stack: `Error: boom\n    at handler${spoof} (checkout.ts:12:3)\n    at run (h3.mjs:2017:19)` },
      note: `n\u009B2K\u007F`,
    }))
    for (const line of visibleLines(text)) expect(line).not.toMatch(controlChar)
    expect(text).toContain(`aaaaaaaa${escaped}`)
    expect(text).toContain('why      why\\nsecond line')
    expect(text).toContain(`at handler${escaped} (checkout.ts:12:3)`)
    expect(text).toMatch(/^ {11}at run \(h3\.mjs:2017:19\)$/m)
    expect(text).toContain('"note": "n\\u009b2K\\u007f"')
  })

  it('escapes them in the stats table', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evlog-cli-logs-'))
    tempDirs.push(cwd)
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'shop' }))
    const dir = join(cwd, '.evlog', 'logs')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, '2026-10-01.jsonl'), `${JSON.stringify(event({ path: `/x${spoof}`, level: `info${spoof}` }))}\n`)
    const result = await runLogs(fakeContext(cwd, { color: true }), { what: 'stats' }, { now: NOW })
    const report = formatLogsReport(fakeContext(cwd, { color: true }), result)
    for (const line of visibleLines(report)) expect(line).not.toMatch(controlChar)
    expect(report).toContain(`GET /x${escaped}`)
    expect(report).toContain(`info${escaped} 1`)
  })
})

describe('error status row', () => {
  const style = createStyle({ color: false })
  const failing = (error: Record<string, unknown>) => event({
    level: 'error',
    status: 500,
    error: { name: 'Error', message: 'Payment processing failed', ...error },
  })

  it('shows error.status when only status is set (v3 shape)', () => {
    expect(formatEvent(style, failing({ status: 402 }))).toMatch(/^ {2}status\s+402$/m)
  })

  it('falls back to error.statusCode when status is missing (files written before v3)', () => {
    expect(formatEvent(style, failing({ statusCode: 402 }))).toMatch(/^ {2}status\s+402$/m)
  })

  it('prefers error.status when both are set', () => {
    const text = formatEvent(style, failing({ status: 404, statusCode: 500 }))
    expect(text).toMatch(/^ {2}status\s+404$/m)
    expect(text).not.toMatch(/^ {2}status\s+500$/m)
  })

  it('has no status row when neither field is set', () => {
    expect(formatEvent(style, failing({}))).not.toMatch(/^ {2}status\s/m)
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

  it('stats --json carries the table instead of events', async () => {
    const cwd = await makeSink()
    const out = captureStdout()
    await runCommand(logs, { rawArgs: ['--cwd', cwd, '--json', '--no-header', 'stats', '--where', 'status<500'] })
    const payload = JSON.parse(out.join('')) as { view: string, matched: number, events?: unknown, stats: { total: number, byStatus: Record<string, number> } }
    expect(payload.view).toBe('stats')
    expect(payload.events).toBeUndefined()
    expect(payload.stats.total).toBe(5)
    expect(payload.stats.byStatus).toEqual({ '2xx': 4, '4xx': 1 })
  })

  it('applies every --where given, in either spelling', async () => {
    const cwd = await makeSink()
    const out = captureStdout()
    await runCommand(logs, { rawArgs: ['--cwd', cwd, '--json', '--no-header', '--where', 'status=200', '--where=path=/api/items'] })
    const payload = JSON.parse(out.join('')) as { matched: number, events: Array<{ requestId: string }> }
    /* Four events have the status and two the path: one has both. */
    expect(payload.matched).toBe(1)
    expect(payload.events.map(e => e.requestId)).toEqual(['aaaaaaaa-0000-4000-8000-000000000001'])
  })

  it('refuses a bad clause even when a later one is valid', async () => {
    const cwd = await makeSink()
    const out = captureStdout()
    await runCommand(logs, { rawArgs: ['--cwd', cwd, '--json', '--no-header', '--where', 'a>>1', '--where', 'status=500'] })
    expect(JSON.parse(out.join('')).error.code).toBe('cli.LOGS_INVALID_WHERE')
    expect(process.exitCode).toBe(2)
  })

  it('--json carries an event whose duration is a number as it was written', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evlog-cli-logs-odd-'))
    tempDirs.push(cwd)
    await writeFile(join(cwd, 'package.json'), '{"name":"odd"}')
    await mkdir(join(cwd, '.evlog', 'logs'), { recursive: true })
    await writeFile(join(cwd, '.evlog', 'logs', '2026-10-01.jsonl'), `${JSON.stringify({ timestamp: '2026-10-01T11:00:00.000Z', level: 'info', path: '/a', duration: 12 })}\n`)
    const out = captureStdout()
    await runCommand(logs, { rawArgs: ['--cwd', cwd, '--json', '--no-header'] })
    expect(JSON.parse(out.join('')).events).toEqual([{ timestamp: '2026-10-01T11:00:00.000Z', level: 'info', path: '/a', duration: 12 }])
    expect(process.exitCode).toBeUndefined()
  })

  it('a config it cannot read is a failure, as in map and config', async () => {
    const cwd = await makeSink()
    await writeFile(join(cwd, 'evlog.config.ts'), 'export default {')
    const out = captureStdout()
    await runCommand(logs, { rawArgs: ['--cwd', cwd, '--json', '--no-header'] })
    expect(JSON.parse(out.join('')).error.code).toBe('cli.CONFIG_PARSE_FAILED')
    expect(process.exitCode).toBe(1)
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
