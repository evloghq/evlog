import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runLogs } from '../src/commands/logs'
import { formatLogsReport } from '../src/lib/logs/render'
import { createContext } from '../src/core/context'
import { vercelScope } from '../../evlog/src/logs-vercel'
import { readVercelLogs } from '../src/lib/logs/vercel'
import type { VercelAccess } from '../src/lib/logs/vercel'
import { runSetupVercel } from '../src/lib/setup-vercel'
import type { VercelCli } from '../src/lib/setup-vercel'

const NOW = new Date('2026-10-01T12:00:00.000Z')
const SCOPE = { teamId: 'team_1', projectId: 'prj_1', environment: 'production' as const }
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

function jwt(claims: Record<string, unknown>): string {
  return `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`
}

function line(timestamp: string, fields: Record<string, unknown> = {}): string {
  return JSON.stringify({ timestamp, level: 'info', service: 'agent', path: '/api/chat', status: 200, ...fields })
}

interface Page { events: Array<{ message?: string, truncated?: boolean }>, nextCursor?: string }

/** Vercel's observability API, answering one page per request and recording the bodies. */
function fakeVercel(pages: Page[]): { fetchFn: typeof fetch, bodies: Record<string, any>[], urls: string[] } {
  const bodies: Record<string, any>[] = []
  const urls: string[] = []
  const fetchFn = ((url: string, init: RequestInit) => {
    urls.push(url)
    bodies.push(JSON.parse(String(init.body)))
    const page = pages[bodies.length - 1]!
    return Promise.resolve(new Response(JSON.stringify({ events: page.events, pagination: { hasMore: page.nextCursor !== undefined, nextCursor: page.nextCursor ?? null } })))
  }) as typeof fetch
  return { fetchFn, bodies, urls }
}

async function linkedProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'evlog-cli-vercel-'))
  tempDirs.push(cwd)
  await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'agent' }))
  await mkdir(join(cwd, '.vercel'))
  await writeFile(join(cwd, '.vercel', 'project.json'), JSON.stringify({ projectId: 'prj_1', orgId: 'team_1' }))
  return cwd
}

function ctxAt(cwd: string) {
  return createContext({ cwd, env: {}, nodeVersion: 'v22.0.0', tty: false, color: false, columns: 120 })
}

const access = (): Promise<VercelAccess> => Promise.resolve({ token: 'tok', scope: SCOPE })

describe('vercelScope', () => {
  it('reads the team, project and environment from the OIDC token', () => {
    expect(vercelScope(jwt({ owner_id: 'team_1', project_id: 'prj_1', environment: 'preview' }))).toEqual({ teamId: 'team_1', projectId: 'prj_1', environment: 'preview' })
  })

  it('reads production for a development token, which leaves no runtime logs', () => {
    expect(vercelScope(jwt({ owner_id: 'team_1', project_id: 'prj_1', environment: 'development' }))?.environment).toBe('production')
  })

  it.each(['not-a-jwt', jwt({ owner_id: 'team_1' }), 'a.%%%.b'])('has no scope for %j', (token) => {
    expect(vercelScope(token)).toBeUndefined()
  })
})

describe('readVercelLogs', () => {
  it('pages newest first, pinned to the scope, and skips what is not an event', async () => {
    const { fetchFn, bodies, urls } = fakeVercel([
      { events: [{ message: line('2026-10-01T11:00:00.000Z') }, { message: 'plain console output' }, { truncated: true, message: '{"timestamp":' }], nextCursor: 'c1' },
      { events: [{ message: `${line('2026-10-01T10:00:00.000Z')}\n${line('2026-10-01T09:00:00.000Z')}` }] },
    ])
    const reader = readVercelLogs({ token: 'tok', scope: SCOPE, since: new Date('2026-10-01T00:00:00.000Z'), until: NOW, search: 'wrun_A', maxLines: 5000, fetchFn })
    const seen: string[] = []
    let step = await reader.next()
    for (; !step.done; step = await reader.next()) seen.push(step.value.timestamp)

    expect(seen).toEqual(['2026-10-01T11:00:00.000Z', '2026-10-01T10:00:00.000Z', '2026-10-01T09:00:00.000Z'])
    expect(step.value).toEqual({ lines: 4, truncated: 1, more: false })
    expect(urls[0]).toBe('https://api.vercel.com/v1/observability/events?teamId=team_1')
    expect(bodies[0]).toMatchObject({ event: 'vercel.log', scope: { ownerId: 'team_1', projectIds: ['prj_1'] }, order: 'desc', limit: 1000, filter: 'environment:"production" AND wrun_A' })
    expect(bodies[0]!.cursor).toBeUndefined()
    expect(bodies[1]!.cursor).toBe('c1')
  })

  it('stops at maxLines, says older lines are left, and keeps a search that is not one word on our side', async () => {
    const { fetchFn, bodies } = fakeVercel([{ events: [{ message: line('2026-10-01T11:00:00.000Z') }, { message: line('2026-10-01T10:00:00.000Z') }], nextCursor: 'c1' }])
    const reader = readVercelLogs({ token: 'tok', scope: SCOPE, since: new Date(0), until: NOW, search: 'error message', maxLines: 2, fetchFn })
    let step = await reader.next()
    while (!step.done) step = await reader.next()

    expect(step.value).toEqual({ lines: 2, truncated: 0, more: true })
    expect(bodies).toHaveLength(1)
    expect(bodies[0]!.limit).toBe(2)
    expect(bodies[0]!.filter).toBe('environment:"production"')
  })
})

describe('evlog logs --source vercel', () => {
  it('reads the linked project\'s events over the last day, narrowed to a session', async () => {
    const cwd = await linkedProject()
    const { fetchFn, bodies } = fakeVercel([
      { events: [
        { message: line('2026-10-01T11:00:00.000Z', { gen_ai: { conversation: { id: 'wrun_A' } }, status: 500, level: 'error' }) },
        { message: line('2026-09-29T11:00:00.000Z') },
        { truncated: true },
      ] }
    ])

    const result = await runLogs(ctxAt(cwd), { session: 'wrun_A' }, { source: 'vercel', vercelAccess: access, fetchFn, now: NOW })

    expect(bodies[0]!.timeRange).toEqual({ start: '2026-09-30T12:00:00.000Z', end: '2026-10-01T12:00:00.000Z' })
    expect(bodies[0]!.filter).toBe('environment:"production" AND wrun_A')
    expect(result.sources).toEqual(['vercel prj_1 (production)'])
    expect(result.events.map(e => e.timestamp)).toEqual(['2026-10-01T11:00:00.000Z'])
    expect(result.notes).toEqual(['1 log line was cut by Vercel\'s size limit and skipped'])
  })

  it('points an empty read at the window, not at the fs drain', async () => {
    const cwd = await linkedProject()
    const { fetchFn } = fakeVercel([{ events: [] }])
    const ctx = ctxAt(cwd)

    const report = formatLogsReport(ctx, await runLogs(ctx, {}, { source: 'vercel', vercelAccess: access, fetchFn, now: NOW }))

    expect(report).toContain('--since reaches further back')
    expect(report).not.toContain('fs drain')
  })

  it('needs a linked project', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evlog-cli-vercel-'))
    tempDirs.push(cwd)
    await writeFile(join(cwd, 'package.json'), '{"name":"x"}')

    await expect(runLogs(ctxAt(cwd), {}, { source: 'vercel', vercelAccess: access })).rejects.toMatchObject({ code: 'cli.LOGS_VERCEL_NOT_LINKED' })
  })

  it.each([
    [{ follow: true }, 'follow'],
    [{ dir: 'logs' }, 'dir'],
    [{ url: 'http://x' }, 'url'],
  ])('refuses %o', async (options, flag) => {
    const cwd = await linkedProject()
    await expect(runLogs(ctxAt(cwd), {}, { source: 'vercel', vercelAccess: access, ...options })).rejects.toThrow(`--source vercel cannot be combined with --${flag}`)
  })

  it('refuses an unknown source instead of reading files', async () => {
    const cwd = await linkedProject()
    await expect(runLogs(ctxAt(cwd), {}, { source: 'blob' })).rejects.toMatchObject({ code: 'cli.LOGS_INVALID_SOURCE' })
  })

  it('maps a refused read to its error', async () => {
    const cwd = await linkedProject()
    const fetchFn = (() => Promise.resolve(new Response('forbidden', { status: 403 }))) as typeof fetch
    await expect(runLogs(ctxAt(cwd), {}, { source: 'vercel', vercelAccess: access, fetchFn, now: NOW })).rejects.toThrow('Vercel refused the read (403): forbidden')
  })
})

describe('evlog setup vercel', () => {
  /** The Vercel CLI, over a team whose connectors and project attachments the test sets. */
  function fakeCli(state: { team: Array<{ uid: string, type: string }>, onProject: string[] }): { vercel: VercelCli, calls: string[] } {
    const calls: string[] = []
    const vercel: VercelCli = (args) => {
      calls.push(args.join(' '))
      if (args[1] === 'list') {
        const listed = args.includes('--all-projects') ? state.team : state.team.filter(connector => state.onProject.includes(connector.uid))
        return Promise.resolve({ code: 0, stdout: JSON.stringify(listed.map(connector => ({ ...connector, service: null }))), stderr: '' })
      }
      if (args[1] === 'create') state.team.push({ uid: `vercel/${args[4]}`, type: 'api-key' })
      if (args[1] === 'attach') state.onProject.push(args[2]!)
      return Promise.resolve({ code: 0, stdout: '', stderr: '' })
    }
    return { vercel, calls }
  }

  const changes = (calls: string[]) => calls.filter(call => !call.includes('list'))

  it('creates and attaches the connector, then reads the last hour through it', async () => {
    const cwd = await linkedProject()
    const { vercel, calls } = fakeCli({ team: [{ uid: 'slack/bot', type: 'slack' }], onProject: [] })
    const { fetchFn, bodies } = fakeVercel([{ events: [{ message: line('2026-10-01T11:30:00.000Z') }] }])
    const used: string[] = []

    const result = await runSetupVercel(ctxAt(cwd), { vercel, access: (_, connector) => (used.push(connector), access()), fetchFn, now: NOW })

    expect(result).toEqual({ projectId: 'prj_1', connector: 'vercel/evlog', created: true, attached: true, reused: false, events: 1 })
    expect(changes(calls)).toEqual(['connect create vercel --name evlog', 'connect attach vercel/evlog --yes'])
    expect(used).toEqual(['vercel/evlog'])
    expect(bodies[0]!.timeRange.start).toBe('2026-10-01T11:00:00.000Z')
  })

  it('changes nothing on a second run', async () => {
    const cwd = await linkedProject()
    const { vercel, calls } = fakeCli({ team: [{ uid: 'vercel/evlog', type: 'api-key' }], onProject: ['vercel/evlog'] })
    const { fetchFn } = fakeVercel([{ events: [] }])

    const result = await runSetupVercel(ctxAt(cwd), { vercel, access, fetchFn, now: NOW })

    expect(result).toMatchObject({ created: false, attached: false, reused: false, events: 0 })
    expect(changes(calls)).toEqual([])
  })

  it('offers the team\'s Vercel API-key connectors and reuses the pick', async () => {
    const cwd = await linkedProject()
    const team = [{ uid: 'vercel/deploys', type: 'oauth' }, { uid: 'vercel/mcp', type: 'api-key' }, { uid: 'vercel/ops', type: 'api-key' }, { uid: 'linear/mcp', type: 'api-key' }]
    const { vercel, calls } = fakeCli({ team, onProject: ['vercel/mcp'] })
    const { fetchFn } = fakeVercel([{ events: [] }])
    const offered: Array<{ uids: string[], attached: string[] }> = []
    const used: string[] = []

    const result = await runSetupVercel(ctxAt(cwd), {
      vercel,
      access: (_, connector) => (used.push(connector), access()),
      fetchFn,
      now: NOW,
      choose: (reusable, attached) => {
        offered.push({ uids: reusable.map(connector => connector.uid), attached: [...attached] })
        return Promise.resolve('vercel/mcp')
      },
    })

    expect(offered).toEqual([{ uids: ['vercel/mcp', 'vercel/ops'], attached: ['vercel/mcp'] }])
    expect(result).toMatchObject({ connector: 'vercel/mcp', created: false, attached: false, reused: true })
    expect(changes(calls)).toEqual([])
    expect(used).toEqual(['vercel/mcp'])
  })

  it('creates the default connector when nothing can ask, even with one to reuse', async () => {
    const cwd = await linkedProject()
    const { vercel, calls } = fakeCli({ team: [{ uid: 'vercel/mcp', type: 'api-key' }], onProject: ['vercel/mcp'] })
    const { fetchFn } = fakeVercel([{ events: [] }])

    const result = await runSetupVercel(ctxAt(cwd), { vercel, access, fetchFn, now: NOW })

    expect(result).toMatchObject({ connector: 'vercel/evlog', created: true, reused: false })
    expect(changes(calls)).toEqual(['connect create vercel --name evlog', 'connect attach vercel/evlog --yes'])
  })

  it('attaches a configured connector without asking, and refuses one the team does not have', async () => {
    const cwd = await linkedProject()
    await writeFile(join(cwd, 'evlog.config.ts'), `export default { logs: { vercel: { connector: 'vercel/ops' } } }\n`)
    const { vercel, calls } = fakeCli({ team: [{ uid: 'vercel/ops', type: 'api-key' }, { uid: 'vercel/mcp', type: 'api-key' }], onProject: [] })
    const { fetchFn } = fakeVercel([{ events: [] }])
    const choose = () => Promise.reject(new Error('asked'))

    const result = await runSetupVercel(ctxAt(cwd), { vercel, access, fetchFn, now: NOW, choose })

    expect(result).toMatchObject({ connector: 'vercel/ops', created: false, attached: true, reused: false })
    expect(changes(calls)).toEqual(['connect attach vercel/ops --yes'])
    await expect(runSetupVercel(ctxAt(cwd), { vercel, access, connector: 'vercel/gone' })).rejects.toThrow('the team has no vercel/gone connector')
  })

  it('names the step that failed', async () => {
    const cwd = await linkedProject()
    const vercel: VercelCli = () => Promise.resolve({ code: 1, stdout: '', stderr: 'Error: Not authorized\n' })

    await expect(runSetupVercel(ctxAt(cwd), { vercel, access })).rejects.toThrow('vercel connect list --json --all-projects failed: Error: Not authorized')
  })
})

describe('logs.vercel.connector', () => {
  it('is the connector --source vercel reads through', async () => {
    const cwd = await linkedProject()
    await writeFile(join(cwd, 'evlog.config.ts'), `export default { logs: { vercel: { connector: 'vercel/mcp' } } }\n`)
    const { fetchFn } = fakeVercel([{ events: [] }])
    const used: string[] = []

    await runLogs(ctxAt(cwd), {}, { source: 'vercel', vercelAccess: (_, connector) => (used.push(connector), access()), fetchFn, now: NOW })

    expect(used).toEqual(['vercel/mcp'])
  })

  it('must be a connector UID', async () => {
    const cwd = await linkedProject()
    await writeFile(join(cwd, 'evlog.config.ts'), `export default { logs: { vercel: { connector: 'mcp' } } }\n`)

    await expect(runLogs(ctxAt(cwd), {}, { source: 'vercel', vercelAccess: access })).rejects.toThrow('logs.vercel.connector in evlog.config.ts:1 must be a connector UID such as vercel/evlog')
  })
})
