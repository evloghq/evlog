import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { readLogs } from '../extension/lib/read-logs'

const NOW = new Date('2026-10-01T12:00:00.000Z')
const OIDC = `e30.${Buffer.from(JSON.stringify({ owner_id: 'team_1', project_id: 'prj_1', environment: 'production' })).toString('base64url')}.sig`

function turn(sessionId: string, fields: Record<string, unknown> = {}): string {
  return JSON.stringify({ timestamp: '2026-10-01T11:00:00.000Z', level: 'info', requestId: `${sessionId}:turn_0`, gen_ai: { conversation: { id: sessionId } }, ...fields })
}

/** Vercel Connect and the observability API, recording what each was asked. */
function fakeVercel(lines: string[], connectStatus = 200): { fetchFn: typeof fetch, calls: Array<{ url: string, auth: string, body: Record<string, any> }> } {
  const calls: Array<{ url: string, auth: string, body: Record<string, any> }> = []
  const fetchFn = ((url: string, init: RequestInit) => {
    calls.push({ url, auth: (init.headers as Record<string, string>).authorization!, body: JSON.parse(String(init.body)) })
    if (url.includes('/v1/connect/token/')) {
      return Promise.resolve(connectStatus === 200 ? new Response(JSON.stringify({ token: 'connect-token' })) : new Response('{"error":{"code":"not_found"}}', { status: connectStatus }))
    }
    return Promise.resolve(new Response(JSON.stringify({ events: lines.map(message => ({ message })), pagination: { hasMore: false, nextCursor: null } })))
  }) as typeof fetch
  return { fetchFn, calls }
}

describe('readLogs on Vercel', () => {
  it('reads through the connector, pinned to the token\'s project, and to the caller\'s session', async () => {
    const { fetchFn, calls } = fakeVercel([turn('wrun_A', { level: 'error', status: 500 }), turn('wrun_B', { level: 'error', status: 500 })])

    const result = await readLogs({ view: 'errors', session: 'wrun_B' }, { source: { kind: 'vercel', oidcToken: OIDC, connector: 'vercel/mcp', fetchFn }, session: 'wrun_A', now: NOW })

    expect(calls[0]).toMatchObject({ url: 'https://api.vercel.com/v1/connect/token/vercel%2Fmcp', auth: `Bearer ${OIDC}`, body: { subject: { type: 'app' } } })
    expect(calls[1]).toMatchObject({ auth: 'Bearer connect-token', body: { scope: { ownerId: 'team_1', projectIds: ['prj_1'] }, filter: 'environment:"production" AND wrun_A', timeRange: { start: '2026-09-30T12:00:00.000Z' } } })
    expect(result).toMatchObject({ source: 'vercel prj_1 (production)', scope: 'session', view: 'errors', matched: 1 })
    expect(result.rows!.map(row => row.requestId)).toEqual(['wrun_A:turn_0'])
  })

  it('lists one short row per turn, and the full event only in trace', async () => {
    const tools = Array.from({ length: 30 }, (_, i) => ({ name: `tool_${i}`, kind: 'tool', duration_ms: 12, success: i !== 7, input: { query: 'x'.repeat(200) } }))
    const failing = turn('wrun_A', {
      level: 'error',
      status: 500,
      durationMs: 4200,
      user: { id: 'u_42', plan: 'pro' },
      error: { name: 'EvlogError', message: 'Refund declined', code: 'REFUND_DECLINED', why: 'Issuer rejected it', fix: 'Ask for another card', stack: 'at refund (…)' },
      gen_ai: { conversation: { id: 'wrun_A' }, usage: { total_tokens: 9100 }, tools },
    })
    const { fetchFn } = fakeVercel([failing])
    const source = { kind: 'vercel' as const, oidcToken: OIDC, connector: 'vercel/evlog', fetchFn }

    const list = await readLogs({ view: 'errors', fields: ['user.id', 'missing.field'] }, { source, now: NOW })
    expect(list.events).toBeUndefined()
    expect(list.rows).toEqual([
      {
        requestId: 'wrun_A:turn_0',
        timestamp: '2026-10-01T11:00:00.000Z',
        level: 'error',
        status: 500,
        durationMs: 4200,
        session: 'wrun_A',
        result: 'failed',
        error: { code: 'REFUND_DECLINED', message: 'Refund declined', why: 'Issuer rejected it', fix: 'Ask for another card' },
        toolCalls: 30,
        failedTools: ['tool_7'],
        tokens: 9100,
        fields: { 'user.id': 'u_42' },
      }
    ])
    expect(JSON.stringify(list.rows).length).toBeLessThan(JSON.stringify(JSON.parse(failing)).length / 10)

    const trace = await readLogs({ view: 'trace', id: 'wrun_A:turn_0' }, { source, now: NOW })
    expect(trace.rows).toBeUndefined()
    expect(trace.events).toEqual([JSON.parse(failing)])
  })

  it('narrows by level, status, path, until and over', async () => {
    const at = (hour: string, fields: Record<string, unknown>) => turn('wrun_A', { timestamp: `2026-10-01T${hour}:00:00.000Z`, ...fields, requestId: `r_${hour}` })
    const { fetchFn } = fakeVercel([
      at('08', { level: 'warn', status: 200, path: '/a', durationMs: 3000 }),
      at('09', { level: 'error', status: 502, path: '/a', durationMs: 900 }),
      at('10', { level: 'error', status: 404, path: '/b', durationMs: 2500 }),
      at('11', { level: 'info', status: 200, path: '/a', durationMs: 100 }),
    ])
    const source = { kind: 'vercel' as const, oidcToken: OIDC, connector: 'vercel/evlog', fetchFn }
    const ids = async (input: Parameters<typeof readLogs>[0]) => (await readLogs(input, { source, now: NOW })).rows!.map(row => row.requestId)

    expect(await ids({ level: ['warn', 'error'] })).toEqual(['r_08', 'r_09', 'r_10'])
    expect(await ids({ status: '5xx' })).toEqual(['r_09'])
    expect(await ids({ status: '404' })).toEqual(['r_10'])
    expect(await ids({ path: '/a', until: '2h' })).toEqual(['r_08', 'r_09'])
    expect(await ids({ view: 'slow', over: '2s' })).toEqual(['r_08', 'r_10'])
  })

  it('says what to run when Connect issues no token', async () => {
    const { fetchFn } = fakeVercel([], 404)

    await expect(readLogs({}, { source: { kind: 'vercel', oidcToken: OIDC, connector: 'vercel/evlog', fetchFn }, now: NOW }))
      .rejects.toMatchObject({ message: 'Vercel Connect issued no token for vercel/evlog (404)', fix: 'Run npx evlog setup vercel in the agent\'s project' })
  })

  it('refuses input it cannot read instead of widening the query', async () => {
    const { fetchFn } = fakeVercel([])
    const source = { kind: 'vercel' as const, oidcToken: OIDC, connector: 'vercel/evlog', fetchFn }

    await expect(readLogs({ since: 'yesterday' }, { source, now: NOW })).rejects.toThrow('since "yesterday" is not a duration')
    await expect(readLogs({ where: ['a>>1'] }, { source, now: NOW })).rejects.toThrow('where "a>>1" cannot be read')
    await expect(readLogs({ view: 'trace' }, { source, now: NOW })).rejects.toThrow('The trace view needs an id')
    await expect(readLogs({ status: '5x' }, { source, now: NOW })).rejects.toThrow('status "5x" is not a status')
    await expect(readLogs({ until: 'soon' }, { source, now: NOW })).rejects.toThrow('until "soon" is not a duration')
  })
})

describe('readLogs results say what they cover', () => {
  it('names the origin, the window and the filters, and is complete when nothing was cut', async () => {
    const { fetchFn } = fakeVercel([turn('wrun_A', { durationMs: 900 })])
    const result = await readLogs({ view: 'slow' }, { source: { kind: 'vercel', oidcToken: OIDC, connector: 'vercel/evlog', fetchFn }, caller: { session: 'wrun_A', turn: 'turn_3' }, now: NOW })
    expect(result).toMatchObject({
      origin: { kind: 'vercel', teamId: 'team_1', projectId: 'prj_1', environment: 'production' },
      caller: { session: 'wrun_A', turn: 'turn_3' },
      window: { since: '2026-09-30T12:00:00.000Z', until: '2026-10-01T12:00:00.000Z' },
      filters: { over: '500ms', limit: 10 },
      matched: 1,
      returned: 1,
      coverage: { complete: true },
    })
  })

  it('is not complete when Vercel cut lines or more were left', async () => {
    const fetchFn = ((url: string) => Promise.resolve(url.includes('/connect/')
      ? new Response(JSON.stringify({ token: 't' }))
      : new Response(JSON.stringify({ events: [{ message: turn('wrun_A') }, { truncated: true }], pagination: { hasMore: false, nextCursor: null } })))) as typeof fetch
    const result = await readLogs({ view: 'errors' }, { source: { kind: 'vercel', oidcToken: OIDC, connector: 'vercel/evlog', fetchFn }, now: NOW })
    expect(result.matched).toBe(0)
    expect(result.coverage).toEqual({ complete: false, reasons: ['1 log line(s) were cut by Vercel\'s size limit and skipped'] })
  })

  it('refuses a read from another source or environment than the one expected', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'evlog-eve-expect-'))
    dirs.push(dir)
    const files = { kind: 'fs' as const, dir, environment: 'development' }
    await expect(readLogs({ view: 'errors', expect: { environment: 'production' } }, { source: files, now: NOW }))
      .rejects.toMatchObject({ status: 409, message: `This tool reads ${dir} (files, development), not production` })
    await expect(readLogs({ expect: { source: 'vercel' } }, { source: files, now: NOW })).rejects.toMatchObject({ status: 409 })
    const { fetchFn, calls } = fakeVercel([])
    await expect(readLogs({ expect: { environment: 'preview' } }, { source: { kind: 'vercel', oidcToken: OIDC, connector: 'vercel/evlog', fetchFn }, now: NOW })).rejects.toMatchObject({ status: 409 })
    /* Refused before Connect is asked for a token. */
    expect(calls).toHaveLength(0)
    expect((await readLogs({ expect: { source: 'files', environment: 'development' } }, { source: files, now: NOW })).origin).toEqual({ kind: 'files', dir, environment: 'development' })
  })
})

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function sink(lines: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'evlog-eve-logs-'))
  dirs.push(dir)
  writeFileSync(join(dir, '2026-10-01.jsonl'), `${lines.join('\n')}\n`)
  return dir
}

describe('readLogs sessions', () => {
  const lines = [
    turn('wrun_A', { requestId: 'wrun_A:turn_0', timestamp: '2026-10-01T10:00:01.000Z', durationMs: 1000, eve: { outcome: 'completed' }, gen_ai: { conversation: { id: 'wrun_A' }, calls: 1, usage: { input_tokens: 50, output_tokens: 5, cost: 0.0002 } } }),
    turn('wrun_A', { requestId: 'wrun_A:turn_1', timestamp: '2026-10-01T10:10:00.000Z', level: 'warn', durationMs: 3000, eve: { outcome: 'completed', failedCalls: 1 }, gen_ai: { conversation: { id: 'wrun_A' }, calls: 2, tools: [{ name: 'refund', success: false }] } }),
    turn('wrun_B', { requestId: 'wrun_B:turn_0', timestamp: '2026-10-01T11:00:00.000Z', durationMs: 200, eve: { outcome: 'failed' }, status: 500, level: 'error' }),
  ]

  it('sums each session and marks the caller\'s', async () => {
    const result = await readLogs({ view: 'sessions' }, { source: { kind: 'fs', dir: sink(lines) }, caller: { session: 'wrun_A', turn: 'turn_2' }, now: NOW })
    expect(result.sessionsMatched).toBe(2)
    expect(result.returned).toBe(2)
    expect(result.sessions!.map(s => [s.session, s.current])).toEqual([['wrun_B', undefined], ['wrun_A', true]])
    expect(result.sessions![1]).toMatchObject({ turns: 2, outcomes: { completed: 1, recovered: 1 }, failedToolCalls: 1, modelCalls: 3, processingMs: 4000, elapsedMs: 600_000, cost: { usd: 0.0002, turnsReporting: 1 } })
  })

  it('never shows another session to a session-scoped caller', async () => {
    const result = await readLogs({ view: 'sessions', session: 'wrun_B' }, { source: { kind: 'fs', dir: sink(lines) }, session: 'wrun_A', caller: { session: 'wrun_A' }, now: NOW })
    expect(result.scope).toBe('session')
    expect(result.sessions!.map(s => s.session)).toEqual(['wrun_A'])
  })

  it('adds the diagnostic fields to rows on request only', async () => {
    const dir = sink([turn('wrun_C', { traceId: 'tr_1', spanId: 'sp_1', gen_ai: { conversation: { id: 'wrun_C' }, calls: 4, request: { model: 'm1' }, usage: { cost: 0.01, cache_read: { input_tokens: 900 } } } })])
    const [brief] = (await readLogs({}, { source: { kind: 'fs', dir }, now: NOW })).rows!
    expect(brief).not.toHaveProperty('traceId')
    const [row] = (await readLogs({ detail: 'diagnostic' }, { source: { kind: 'fs', dir }, now: NOW })).rows!
    expect(row).toMatchObject({ modelCalls: 4, models: ['m1'], cost: 0.01, cacheReadTokens: 900, traceId: 'tr_1', spanId: 'sp_1' })
  })
})

describe('readLogs trace', () => {
  it('returns full events within a size budget, says it is not the span tree, and points at the trace', async () => {
    const big = (i: number) => turn('wrun_D', { requestId: 'wrun_D:turn_1', timestamp: `2026-10-01T10:0${i}:00.000Z`, traceId: `tr_${i}`, spanId: `sp_${i}`, pad: 'x'.repeat(10_000) })
    const dir = sink([0, 1, 2, 3].map(big))
    const result = await readLogs({ view: 'trace', id: 'wrun_D:turn_1' }, { source: { kind: 'fs', dir }, now: NOW })
    expect(result.matched).toBe(4)
    expect(result.returned).toBe(2)
    expect(result.omitted).toBe(2)
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(24_000)
    expect(result.events!.map(event => event.traceId)).toEqual(['tr_2', 'tr_3'])
    expect(result.traces).toEqual([0, 1, 2, 3].map(i => ({ requestId: 'wrun_D:turn_1', traceId: `tr_${i}`, spanId: `sp_${i}`, open: `eve traces show tr_${i}` })))
    expect(result.notes).toContain('trace returns full wide events, not the OTel span tree: open a span tree with traces[].traceId')
    expect((await readLogs({ view: 'trace', id: 'wrun_D:turn_1', full: true }, { source: { kind: 'fs', dir }, now: NOW })).events).toHaveLength(4)
  })
})

describe('readLogs size budget', () => {
  const files = (lines: string[]) => ({ source: { kind: 'fs' as const, dir: sink(lines) }, now: NOW })
  const size = (value: unknown) => JSON.stringify(value).length
  const huge = 'x'.repeat(210_000)
  const ids = { requestId: 'wrun_E:turn_1', traceId: 'tr_e', spanId: 'sp_e' }

  it('keeps the trace reference of an event too large for the default budget, and says full raises it', async () => {
    const options = files([turn('wrun_E', { ...ids, payload: huge })])
    const result = await readLogs({ view: 'trace', id: 'wrun_E:turn_1' }, options)
    expect(result).toMatchObject({ matched: 1, returned: 0, omitted: 1, events: [], coverage: { complete: true } })
    expect(result.traces).toEqual([{ requestId: 'wrun_E:turn_1', traceId: 'tr_e', spanId: 'sp_e', open: 'eve traces show tr_e' }])
    expect(result.notes).toContain('1 event(s) left out to stay within the 24000-character budget: pass full: true to raise it to 200000')
    expect(size(result)).toBeLessThanOrEqual(24_000)
  })

  it('does not suggest full when the full budget is the one exhausted', async () => {
    const options = files([turn('wrun_E', { ...ids, payload: huge })])
    const result = await readLogs({ view: 'trace', id: 'wrun_E:turn_1', full: true }, options)
    expect(result).toMatchObject({ returned: 0, omitted: 1, traces: [{ traceId: 'tr_e' }], coverage: { complete: true } })
    expect(result.notes!.join('\n')).not.toContain('pass full: true')
    expect(result.notes).toContain('1 event(s) left out to stay within the 200000-character budget, the largest there is: read single fields with view recent, where requestId=<id> and fields, or open the span tree from traces[]')
    expect(size(result)).toBeLessThanOrEqual(200_000)
  })

  it('keeps the small events around a large one', async () => {
    const event = (minute: number, pad: string) => turn('wrun_E', { ...ids, traceId: `tr_${minute}`, timestamp: `2026-10-01T10:0${minute}:00.000Z`, pad })
    const result = await readLogs({ view: 'trace', id: 'wrun_E:turn_1' }, files([event(1, 'a'), event(2, 'x'.repeat(30_000)), event(3, 'b')]))
    expect(result.events!.map(e => e.traceId)).toEqual(['tr_1', 'tr_3'])
    expect(result.omitted).toBe(1)
    expect(result.traces!.map(t => t.traceId)).toEqual(['tr_1', 'tr_2', 'tr_3'])
  })

  it('drops a projected field too large for the budget from its row, and says which', async () => {
    for (const payload of [{ nested: { blob: huge } }, huge]) {
      const result = await readLogs({ fields: ['payload', 'user.id'] }, files([turn('wrun_E', { ...ids, payload, user: { id: 'u1' } })]))
      expect(result.returned).toBe(1)
      expect(result.rows![0]).toMatchObject({ requestId: 'wrun_E:turn_1', omittedFields: ['payload', 'user.id'] })
      expect(result.rows![0]).not.toHaveProperty('fields')
      expect(result.notes).toContain('1 row(s) left fields out to stay within the 24000-character budget: pass full: true to raise it to 200000, or ask for fewer fields')
      expect(size(result)).toBeLessThanOrEqual(24_000)
    }
  })

  it('bounds many rows together, newest kept whole first', async () => {
    const lines = [1, 2, 3, 4, 5].map(minute => turn('wrun_E', { requestId: `r${minute}`, timestamp: `2026-10-01T10:0${minute}:00.000Z`, payload: 'y'.repeat(8_000) }))
    const result = await readLogs({ fields: ['payload'] }, files(lines))
    expect(result.rows!.map(row => [row.requestId, row.fields ? 'whole' : row.omittedFields])).toEqual([['r1', ['payload']], ['r2', ['payload']], ['r3', ['payload']], ['r4', 'whole'], ['r5', 'whole']])
    expect(size(result)).toBeLessThanOrEqual(24_000)
    expect((await readLogs({ fields: ['payload'], full: true }, files(lines))).rows!.every(row => row.fields)).toBe(true)
  })

  it('cuts a row with a huge error down to what identifies it', async () => {
    const result = await readLogs({ view: 'errors' }, files([turn('wrun_E', { ...ids, level: 'error', status: 500, error: { message: huge } })]))
    expect(result.rows).toEqual([{ requestId: 'wrun_E:turn_1', timestamp: '2026-10-01T11:00:00.000Z', level: 'error', result: 'failed', session: 'wrun_E', omittedFields: ['status', 'error'] }])
    expect(size(result)).toBeLessThanOrEqual(24_000)
  })

  it('drops a huge failure message from a session summary', async () => {
    const result = await readLogs({ view: 'sessions' }, files([turn('wrun_E', { ...ids, level: 'error', eve: { outcome: 'failed' }, error: { code: 'BOOM', message: huge } })]))
    expect(result.sessions![0]).toMatchObject({ session: 'wrun_E', latestFailure: { requestId: 'wrun_E:turn_1', code: 'BOOM' }, omittedFields: ['latestFailure.message'] })
    expect(result.sessions![0]!.latestFailure).not.toHaveProperty('message')
    expect(size(result)).toBeLessThanOrEqual(24_000)
  })

  it('leaves a normal diagnostic projection as it is', async () => {
    const result = await readLogs({ detail: 'diagnostic', fields: ['user.id'] }, files([turn('wrun_E', { ...ids, user: { id: 'u1' } })]))
    expect(result.rows![0]).toMatchObject({ traceId: 'tr_e', fields: { 'user.id': 'u1' } })
    expect(result.rows![0]).not.toHaveProperty('omittedFields')
    expect(result).not.toHaveProperty('omitted')
    expect(result).not.toHaveProperty('notes')
  })
})

describe('readLogs window on files', () => {
  it('reads up to the window it reports, even when a clock wrote events ahead of now', async () => {
    const options = { source: { kind: 'fs' as const, dir: sink([turn('a', { requestId: 'past' }), turn('b', { requestId: 'ahead', timestamp: '2026-10-01T12:01:00.000Z' })]) }, now: NOW }
    const read = await readLogs({}, options)
    expect(read.window).toEqual({ until: '2026-10-01T12:00:00.000Z' })
    expect(read.rows!.map(row => row.requestId)).toEqual(['past'])
    const bounded = await readLogs({ until: '30m' }, options)
    expect(bounded.window).toEqual({ until: '2026-10-01T11:30:00.000Z' })
    expect(bounded.rows!.map(row => row.requestId)).toEqual(['past'])
    expect((await readLogs({ until: '90m' }, options)).rows).toEqual([])
  })
})
