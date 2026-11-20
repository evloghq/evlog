import { describe, expect, it } from 'vitest'
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
