import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runLogs } from '../src/commands/logs'
import { formatLogsReport } from '../src/lib/logs/render'
import { createContext } from '../src/core/context'
import { vercelScope } from '../../evlog/src/logs-vercel'
import { projectOidc, readVercelLogs } from '../src/lib/logs/vercel'
import type { VercelAccess } from '../src/lib/logs/vercel'
import { runSetupVercel, runSetupVercelCheck } from '../src/lib/setup-vercel'
import { runSetupEve } from '../src/lib/setup-eve'
import { loadCliConfig } from '../src/lib/config'
import { resolveProject } from '../src/lib/project'
import type { VercelCli } from '../src/lib/setup-vercel'

const oidcSdk = vi.hoisted(() => ({ getVercelOidcToken: vi.fn<(options: { team: string, project: string }) => Promise<string>>() }))
vi.mock('@vercel/oidc', () => oidcSdk)

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

/** A project `vercel link` linked, with `connector` as its `logs.vercel.connector` when given. */
async function linkedProject(connector?: string): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'evlog-cli-vercel-'))
  tempDirs.push(cwd)
  await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'agent' }))
  await mkdir(join(cwd, '.vercel'))
  await writeFile(join(cwd, '.vercel', 'project.json'), JSON.stringify({ projectId: 'prj_1', orgId: 'team_1' }))
  if (connector) await writeFile(join(cwd, 'evlog.config.ts'), `export default { logs: { vercel: { connector: '${connector}' } } }\n`)
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
    const cwd = await linkedProject('vercel/evlog')
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

  it('says what it read: the project, its environment, the window, and that a cut line leaves it incomplete', async () => {
    const cwd = await linkedProject('vercel/evlog')
    const { fetchFn } = fakeVercel([{ events: [{ message: line('2026-10-01T11:00:00.000Z') }, { truncated: true }] }])
    const ctx = ctxAt(cwd)
    const result = await runLogs(ctx, { what: 'errors' }, { source: 'vercel', vercelAccess: access, fetchFn, now: NOW })
    expect(result.origin).toEqual({ kind: 'vercel', teamId: 'team_1', projectId: 'prj_1', environments: ['production'] })
    expect(result.window).toEqual({ since: '2026-09-30T12:00:00.000Z', until: '2026-10-01T12:00:00.000Z' })
    expect(result.coverage).toEqual({ complete: false, reasons: ['1 log line was cut by Vercel\'s size limit and skipped'] })
    const report = formatLogsReport(ctx, result)
    expect(report.split('\n').slice(0, 2)).toEqual(['Vercel prj_1 (production) · 2026-09-30 12:00 → 2026-10-01 12:00 UTC', 'incomplete: 1 log line was cut by Vercel\'s size limit and skipped'])
  })

  it('ranks the Vercel events with --ask, and refuses --ask on the sessions view', async () => {
    const cwd = await linkedProject('vercel/evlog')
    const { fetchFn } = fakeVercel([
      { events: [
        { message: line('2026-10-01T11:00:00.000Z', { path: '/api/checkout', status: 402 }) },
        { message: line('2026-10-01T10:00:00.000Z', { path: '/api/checkout', status: 200 }) },
      ] }
    ])
    const question = 'The customer tried to pay but did not end up with a confirmed order'

    const result = await runLogs(ctxAt(cwd), { ask: question }, { source: 'vercel', vercelAccess: access, fetchFn, now: NOW, dryRun: true })

    expect(result.estimated).toMatchObject({ question, estimate: { events: 2, calls: 2 } })
    await expect(runLogs(ctxAt(cwd), { what: 'sessions', ask: question }, { source: 'vercel', vercelAccess: access, fetchFn, now: NOW }))
      .rejects.toMatchObject({ code: 'cli.LOGS_ASK_UNSUPPORTED' })
  })

  it('reads Vercel when evlog.config says so, and a flag still wins', async () => {
    const cwd = await linkedProject('vercel/evlog')
    await writeFile(join(cwd, 'evlog.config.ts'), `export default { logs: { source: 'vercel', vercel: { connector: 'vercel/evlog' } } }\n`)
    const { fetchFn } = fakeVercel([{ events: [] }])
    expect((await runLogs(ctxAt(cwd), {}, { vercelAccess: access, fetchFn, now: NOW })).origin.kind).toBe('vercel')
    await expect(runLogs(ctxAt(cwd), {}, { source: 'files', vercelAccess: access, fetchFn, now: NOW })).rejects.toMatchObject({ code: 'cli.LOGS_NO_SINK' })
  })

  it('refuses to answer for production from local files, or for preview from production', async () => {
    const cwd = await linkedProject('vercel/evlog')
    await mkdir(join(cwd, '.evlog', 'logs'), { recursive: true })
    await writeFile(join(cwd, '.evlog', 'logs', '2026-10-01.jsonl'), `${line('2026-10-01T11:00:00.000Z', { environment: 'development', status: 500, level: 'error' })}\n`)
    const ctx = ctxAt(cwd)
    await expect(runLogs(ctx, { what: 'errors' }, { expect: 'production', now: NOW }))
      .rejects.toMatchObject({ code: 'cli.LOGS_SOURCE_MISMATCH', message: 'Expected production, but this reads local files (development)' })
    await expect(runLogs(ctx, {}, { expect: 'vercel', now: NOW })).rejects.toMatchObject({ code: 'cli.LOGS_SOURCE_MISMATCH' })
    const { fetchFn, bodies } = fakeVercel([{ events: [] }])
    await expect(runLogs(ctx, {}, { source: 'vercel', expect: 'preview', vercelAccess: access, fetchFn, now: NOW })).rejects.toMatchObject({ code: 'cli.LOGS_SOURCE_MISMATCH' })
    expect(bodies).toHaveLength(0)
    const local = await runLogs(ctx, { what: 'errors' }, { expect: 'files,development', now: NOW })
    expect(local.origin).toEqual({ kind: 'files', environments: ['development'] })
    expect(local.matched).toBe(1)
  })

  it('points an empty read at the window, not at the fs drain', async () => {
    const cwd = await linkedProject('vercel/evlog')
    const { fetchFn } = fakeVercel([{ events: [] }])
    const ctx = ctxAt(cwd)

    const report = formatLogsReport(ctx, await runLogs(ctx, {}, { source: 'vercel', vercelAccess: access, fetchFn, now: NOW }))

    expect(report).toContain('--since reaches further back')
    expect(report).not.toContain('fs drain')
  })

  it('refuses to read Vercel until a connector is configured, rather than guess one', async () => {
    const cwd = await linkedProject()
    const used: string[] = []
    const vercelAccess = (_: unknown, connector: string) => (used.push(connector), access())
    const refused = { code: 'cli.LOGS_VERCEL_NO_CONNECTOR', message: 'Vercel logs are not set up: evlog.config names no logs.vercel.connector', fix: 'Run npx evlog setup vercel: it offers the team\'s connectors and writes the one you pick to evlog.config.ts' }

    await expect(runLogs(ctxAt(cwd), {}, { source: 'vercel', vercelAccess, now: NOW })).rejects.toMatchObject(refused)
    await writeFile(join(cwd, 'evlog.config.ts'), `export default { logs: { source: 'vercel' } }\n`)
    await expect(runLogs(ctxAt(cwd), {}, { vercelAccess, now: NOW })).rejects.toMatchObject(refused)
    expect(used).toEqual([])
  })

  it('needs a linked project', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evlog-cli-vercel-'))
    tempDirs.push(cwd)
    await writeFile(join(cwd, 'package.json'), '{"name":"x"}')
    await writeFile(join(cwd, 'evlog.config.ts'), `export default { logs: { vercel: { connector: 'vercel/evlog' } } }\n`)

    await expect(runLogs(ctxAt(cwd), {}, { source: 'vercel', vercelAccess: access })).rejects.toMatchObject({ code: 'cli.LOGS_VERCEL_NOT_LINKED' })
  })

  it.each([
    [{ follow: true }, 'follow'],
    [{ dir: 'logs' }, 'dir'],
    [{ url: 'http://x' }, 'url'],
  ])('refuses %o', async (options, flag) => {
    const cwd = await linkedProject('vercel/evlog')
    await expect(runLogs(ctxAt(cwd), {}, { source: 'vercel', vercelAccess: access, ...options })).rejects.toThrow(`--source vercel cannot be combined with --${flag}`)
  })

  it('refuses an unknown source instead of reading files', async () => {
    const cwd = await linkedProject('vercel/evlog')
    await expect(runLogs(ctxAt(cwd), {}, { source: 'blob' })).rejects.toMatchObject({ code: 'cli.LOGS_INVALID_SOURCE' })
  })

  it('maps a refused read to its error', async () => {
    const cwd = await linkedProject('vercel/evlog')
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

  it('creates the connector it is told to create, attaches it, names it in evlog.config.ts, then reads the last hour through it', async () => {
    const cwd = await linkedProject()
    const { vercel, calls } = fakeCli({ team: [{ uid: 'slack/bot', type: 'slack' }], onProject: [] })
    const { fetchFn, bodies } = fakeVercel([{ events: [{ message: line('2026-10-01T11:30:00.000Z') }] }])
    const used: string[] = []

    const result = await runSetupVercel(ctxAt(cwd), { vercel, access: (_, connector) => (used.push(connector), access()), fetchFn, now: NOW, connector: 'vercel/logs-reader', create: true })

    expect(result).toEqual({ projectId: 'prj_1', connector: 'vercel/logs-reader', created: true, attached: true, environments: ['production', 'development'], config: { file: 'evlog.config.ts', state: 'created', diff: [
      `+ import { defineEvlog } from 'evlog'`,
      `+ export default defineEvlog({`,
      `+   logs: {`,
      `+     vercel: { connector: 'vercel/logs-reader' },`,
      `+   },`,
      `+ })`,
    ] }, events: 1 })
    expect(changes(calls)).toEqual(['connect create vercel --name logs-reader', 'connect attach vercel/logs-reader --yes --environment production,development'])
    expect(used).toEqual(['vercel/logs-reader'])
    expect(bodies[0]!.timeRange.start).toBe('2026-10-01T11:00:00.000Z')
    expect(loadCliConfig(await resolveProject(cwd))?.logs.vercel).toEqual({ connector: 'vercel/logs-reader' })
  })

  it('changes nothing on a second run', async () => {
    const cwd = await linkedProject('vercel/evlog')
    const { vercel, calls } = fakeCli({ team: [{ uid: 'vercel/evlog', type: 'api-key' }], onProject: ['vercel/evlog'] })
    const { fetchFn } = fakeVercel([{ events: [] }])
    const before = await readFile(join(cwd, 'evlog.config.ts'), 'utf8')

    const result = await runSetupVercel(ctxAt(cwd), { vercel, access, fetchFn, now: NOW })

    expect(result).toMatchObject({ created: false, attached: false, config: { file: 'evlog.config.ts', state: 'unchanged' }, events: 0 })
    expect(changes(calls)).toEqual([])
    expect(await readFile(join(cwd, 'evlog.config.ts'), 'utf8')).toBe(before)
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
        return Promise.resolve({ connector: 'vercel/mcp', create: false })
      },
    })

    expect(offered).toEqual([{ uids: ['vercel/mcp', 'vercel/ops'], attached: ['vercel/mcp'] }])
    expect(result).toMatchObject({ connector: 'vercel/mcp', created: false, attached: false, config: { state: 'created' } })
    expect(changes(calls)).toEqual([])
    expect(used).toEqual(['vercel/mcp'])
    expect(loadCliConfig(await resolveProject(cwd))?.logs.vercel).toEqual({ connector: 'vercel/mcp' })
  })

  it('offers a vercel/evlog connector the team already has like any other, instead of using it unasked', async () => {
    const cwd = await linkedProject()
    const { vercel } = fakeCli({ team: [{ uid: 'vercel/evlog', type: 'api-key' }, { uid: 'vercel/mcp', type: 'api-key' }], onProject: [] })
    const offered: string[][] = []

    await expect(runSetupVercel(ctxAt(cwd), { vercel, access, choose: (reusable) => {
      offered.push(reusable.map(connector => connector.uid))
      return Promise.resolve(undefined)
    } })).rejects.toMatchObject({ code: 'cli.SETUP_VERCEL_NO_CONNECTOR' })
    expect(offered).toEqual([['vercel/evlog', 'vercel/mcp']])
  })

  it('creates nothing and names the team\'s connectors when nothing can ask and no connector is passed', async () => {
    const cwd = await linkedProject()
    const { vercel, calls } = fakeCli({ team: [{ uid: 'vercel/mcp', type: 'api-key' }, { uid: 'vercel/ops', type: 'api-key' }], onProject: ['vercel/mcp'] })

    await expect(runSetupVercel(ctxAt(cwd), { vercel, access })).rejects.toMatchObject({
      code: 'cli.SETUP_VERCEL_NO_CONNECTOR',
      message: 'No connector chosen to read Vercel logs through. The team has vercel/mcp, vercel/ops',
      fix: 'Pass --connector with one of the team\'s connectors, or --connector vercel/<name> --create to create one',
    })
    expect(changes(calls)).toEqual([])
    expect(existsSync(join(cwd, 'evlog.config.ts'))).toBe(false)
  })

  it('refuses to create a connector that is not a Vercel one, or one the team already has', async () => {
    const cwd = await linkedProject()
    const { vercel, calls } = fakeCli({ team: [{ uid: 'vercel/mcp', type: 'api-key' }], onProject: [] })

    await expect(runSetupVercel(ctxAt(cwd), { vercel, access, connector: 'slack/evlog', create: true })).rejects.toMatchObject({ code: 'cli.SETUP_INVALID_CONNECTOR' })
    await expect(runSetupVercel(ctxAt(cwd), { vercel, access, connector: 'vercel/mcp', create: true })).rejects.toThrow('the team already has a vercel/mcp connector; drop --create to use it')
    expect(changes(calls)).toEqual([])
  })

  it('adds the connector to an evlog.config.ts that has other settings, and leaves them as they are', async () => {
    const cwd = await linkedProject()
    const config = `import { defineEvlog } from 'evlog'

export default defineEvlog({
  service: 'agent',
  logs: {
    dir: '.evlog/logs',
  },
})
`
    await writeFile(join(cwd, 'evlog.config.ts'), config)
    const { vercel } = fakeCli({ team: [{ uid: 'vercel/mcp', type: 'api-key' }], onProject: ['vercel/mcp'] })
    const { fetchFn } = fakeVercel([{ events: [] }])

    const said: string[] = []

    const result = await runSetupVercel(ctxAt(cwd), { vercel, access, fetchFn, now: NOW, connector: 'vercel/mcp', onStep: step => said.push(step) })

    expect(result.config).toEqual({ file: 'evlog.config.ts', state: 'updated', diff: [`+     vercel: { connector: 'vercel/mcp' },`] })
    expect(said).toEqual(['edited evlog.config.ts:', `+     vercel: { connector: 'vercel/mcp' },`])
    expect(await readFile(join(cwd, 'evlog.config.ts'), 'utf8')).toBe(config.replace(`    dir: '.evlog/logs',\n`, `    vercel: { connector: 'vercel/mcp' },\n    dir: '.evlog/logs',\n`))
    const loaded = loadCliConfig(await resolveProject(cwd))
    expect(loaded?.logs.vercel).toEqual({ connector: 'vercel/mcp' })
    expect(loaded?.resolved.service).toBe('agent')
  })

  it('leaves a connector evlog.config.ts already names when another is passed', async () => {
    const cwd = await linkedProject('vercel/old')
    const { vercel } = fakeCli({ team: [{ uid: 'vercel/mcp', type: 'api-key' }], onProject: ['vercel/mcp'] })
    const { fetchFn } = fakeVercel([{ events: [] }])

    const result = await runSetupVercel(ctxAt(cwd), { vercel, access, fetchFn, now: NOW, connector: 'vercel/mcp' })

    expect(result.config).toEqual({ file: 'evlog.config.ts', state: 'manual' })
    expect(await readFile(join(cwd, 'evlog.config.ts'), 'utf8')).toBe(`export default { logs: { vercel: { connector: 'vercel/old' } } }\n`)
  })

  it('leaves evlog.config.ts alone with writeConfig: false, for a caller that writes it itself', async () => {
    const cwd = await linkedProject()
    await writeFile(join(cwd, 'evlog.config.ts'), `export default { service: 'agent' }\n`)
    const { vercel, calls } = fakeCli({ team: [], onProject: [] })
    const { fetchFn } = fakeVercel([{ events: [] }])

    const result = await runSetupVercel(ctxAt(cwd), { vercel, access, fetchFn, now: NOW, connector: 'vercel/evlog', create: true, writeConfig: false })

    expect(result).toMatchObject({ connector: 'vercel/evlog', created: true, attached: true })
    expect(result).not.toHaveProperty('config')
    expect(changes(calls)).toEqual(['connect create vercel --name evlog', 'connect attach vercel/evlog --yes --environment production,development'])
    expect(await readFile(join(cwd, 'evlog.config.ts'), 'utf8')).toBe(`export default { service: 'agent' }\n`)
  })

  it('prints the setting when evlog.config.ts computes its config', async () => {
    const cwd = await linkedProject()
    await writeFile(join(cwd, 'evlog.config.ts'), `import base from './base'\nexport default makeConfig(base)\n`)
    const { vercel } = fakeCli({ team: [{ uid: 'vercel/mcp', type: 'api-key' }], onProject: ['vercel/mcp'] })
    const { fetchFn } = fakeVercel([{ events: [] }])

    const result = await runSetupVercel(ctxAt(cwd), { vercel, access, fetchFn, now: NOW, connector: 'vercel/mcp' })

    expect(result.config).toEqual({ file: 'evlog.config.ts', state: 'manual' })
  })

  it('attaches a configured connector without asking, and refuses one the team does not have', async () => {
    const cwd = await linkedProject()
    await writeFile(join(cwd, 'evlog.config.ts'), `export default { logs: { vercel: { connector: 'vercel/ops' } } }\n`)
    const { vercel, calls } = fakeCli({ team: [{ uid: 'vercel/ops', type: 'api-key' }, { uid: 'vercel/mcp', type: 'api-key' }], onProject: [] })
    const { fetchFn } = fakeVercel([{ events: [] }])
    const choose = () => Promise.reject(new Error('asked'))

    const result = await runSetupVercel(ctxAt(cwd), { vercel, access, fetchFn, now: NOW, choose })

    expect(result).toMatchObject({ connector: 'vercel/ops', created: false, attached: true, config: { state: 'unchanged' } })
    expect(changes(calls)).toEqual(['connect attach vercel/ops --yes --environment production,development'])
    await expect(runSetupVercel(ctxAt(cwd), { vercel, access, connector: 'vercel/gone' })).rejects.toThrow('the team has no vercel/gone connector')
  })

  it('grants preview only when asked, and says what the attachment grants before running it', async () => {
    const cwd = await linkedProject('vercel/evlog')
    const { vercel, calls } = fakeCli({ team: [{ uid: 'vercel/evlog', type: 'api-key' }], onProject: [] })
    const { fetchFn } = fakeVercel([{ events: [] }])
    const said: string[] = []

    const result = await runSetupVercel(ctxAt(cwd), { vercel, access, fetchFn, now: NOW, environments: ['production', 'preview'], onStep: step => said.push(step) })

    expect(result).toMatchObject({ attached: true, environments: ['production', 'preview'] })
    expect(changes(calls)).toEqual(['connect attach vercel/evlog --yes --environment production,preview'])
    expect(said.at(-2)).toBe('vercel/evlog gives code deployed to production, preview of prj_1 the authority of the key it stores, whatever that key may read or change on the team')
    expect(said.at(-1)).toBe('vercel connect attach vercel/evlog --yes --environment production,preview')
  })

  it('leaves an existing attachment as it is and does not claim which environments it covers', async () => {
    const cwd = await linkedProject('vercel/evlog')
    const { vercel, calls } = fakeCli({ team: [{ uid: 'vercel/evlog', type: 'api-key' }], onProject: ['vercel/evlog'] })
    const { fetchFn } = fakeVercel([{ events: [] }])

    const result = await runSetupVercel(ctxAt(cwd), { vercel, access, fetchFn, now: NOW, environments: ['preview'] })

    expect(result).toMatchObject({ attached: false })
    expect(result).not.toHaveProperty('environments')
    expect(changes(calls)).toEqual([])
  })

  it('refuses an environment name the Vercel CLI could misread, before changing anything', async () => {
    const cwd = await linkedProject()
    const { vercel, calls } = fakeCli({ team: [], onProject: [] })
    await expect(runSetupVercel(ctxAt(cwd), { vercel, access, environments: ['production', '--project=other'] })).rejects.toMatchObject({ code: 'cli.SETUP_INVALID_ENVIRONMENT' })
    await expect(runSetupVercel(ctxAt(cwd), { vercel, access, environments: [] })).rejects.toMatchObject({ code: 'cli.SETUP_INVALID_ENVIRONMENT' })
    expect(calls).toEqual([])
  })

  it('stops when the attachment fails, without reading', async () => {
    const cwd = await linkedProject()
    const vercel: VercelCli = args => Promise.resolve(args[1] === 'list'
      ? { code: 0, stdout: JSON.stringify(args.includes('--all-projects') ? [{ uid: 'vercel/evlog', type: 'api-key' }] : []), stderr: '' }
      : { code: 1, stdout: '', stderr: '' })
    let read = false
    await expect(runSetupVercel(ctxAt(cwd), { vercel, connector: 'vercel/evlog', access: () => (read = true, access()) }))
      .rejects.toThrow('vercel connect attach vercel/evlog --yes --environment production,development failed: exited 1')
    expect(read).toBe(false)
  })

  it('names the step that failed', async () => {
    const cwd = await linkedProject()
    const vercel: VercelCli = () => Promise.resolve({ code: 1, stdout: '', stderr: 'Error: Not authorized\n' })

    await expect(runSetupVercel(ctxAt(cwd), { vercel, access })).rejects.toThrow('vercel connect list --json --all-projects failed: Error: Not authorized')
  })
})

describe('evlog setup vercel --check', () => {
  const oidc = () => Promise.resolve({ oidc: jwt({ owner_id: 'team_1', project_id: 'prj_1' }), scope: SCOPE })
  function cli(team: Array<{ uid: string, type: string }>, onProject: string[]): { vercel: VercelCli, calls: string[] } {
    const calls: string[] = []
    const vercel: VercelCli = (args) => {
      calls.push(args.join(' '))
      const listed = args.includes('--all-projects') ? team : team.filter(connector => onProject.includes(connector.uid))
      return Promise.resolve({ code: 0, stdout: JSON.stringify(listed), stderr: '' })
    }
    return { vercel, calls }
  }
  /** Connect answers `connect`, the observability API `read`. */
  function vercelApi(connect: number, read: number, events: Array<{ message?: string }> = []): typeof fetch {
    return ((url: string) => Promise.resolve(url.includes('/connect/token/')
      ? (connect === 200 ? new Response(JSON.stringify({ token: 't' })) : new Response('no', { status: connect }))
      : (read === 200 ? new Response(JSON.stringify({ events, pagination: { hasMore: false, nextCursor: null } })) : new Response('forbidden', { status: read })))) as typeof fetch
  }
  const summary = (stages: Array<{ id: string, status: string }>) => stages.map(stage => `${stage.id}:${stage.status}`)

  it('passes every stage and changes nothing', async () => {
    const cwd = await linkedProject('vercel/evlog')
    const { vercel, calls } = cli([{ uid: 'vercel/evlog', type: 'api-key' }], ['vercel/evlog'])
    const stages = await runSetupVercelCheck(ctxAt(cwd), { vercel, oidc, fetchFn: vercelApi(200, 200, [{ message: line('2026-10-01T11:30:00.000Z') }]), now: NOW })
    expect(summary(stages)).toEqual(['linked:ok', 'oidc:ok', 'connector:ok', 'attached:ok', 'token:ok', 'read:ok'])
    expect(stages.at(-1)!.message).toBe('read 1 event from the last hour')
    expect(calls.every(call => call.startsWith('connect list'))).toBe(true)
  })

  it('fails on the read, not the token, when Connect issues one but the stored key may not read logs', async () => {
    const cwd = await linkedProject('vercel/evlog')
    const { vercel } = cli([{ uid: 'vercel/evlog', type: 'api-key' }], ['vercel/evlog'])
    const stages = await runSetupVercelCheck(ctxAt(cwd), { vercel, oidc, fetchFn: vercelApi(200, 403), now: NOW })
    expect(summary(stages)).toEqual(['linked:ok', 'oidc:ok', 'connector:ok', 'attached:ok', 'token:ok', 'read:fail'])
    expect(stages.at(-1)!.fix).toContain('Vercel access token scoped to the team')
  })

  it('tells an empty window from a refused one', async () => {
    const cwd = await linkedProject('vercel/evlog')
    const { vercel } = cli([{ uid: 'vercel/evlog', type: 'api-key' }], ['vercel/evlog'])
    const stages = await runSetupVercelCheck(ctxAt(cwd), { vercel, oidc, fetchFn: vercelApi(200, 200), now: NOW })
    expect(stages.at(-1)).toEqual({ id: 'read', status: 'ok', message: 'allowed; no runtime log lines in the last hour' })
  })

  it('fails the connector stage when evlog.config names no connector, without listing any', async () => {
    const cwd = await linkedProject()
    const { vercel, calls } = cli([{ uid: 'vercel/evlog', type: 'api-key' }], ['vercel/evlog'])
    const stages = await runSetupVercelCheck(ctxAt(cwd), { vercel, oidc, fetchFn: vercelApi(200, 200), now: NOW })
    expect(summary(stages)).toEqual(['linked:ok', 'oidc:ok', 'connector:fail', 'attached:skipped', 'token:skipped', 'read:skipped'])
    expect(stages[2]).toMatchObject({ message: 'evlog.config names no logs.vercel.connector', fix: 'npx evlog setup vercel (offers the team\'s connectors and writes the one you pick to evlog.config.ts)' })
    expect(calls).toEqual([])
  })

  it('stops at the first failing stage and skips the rest', async () => {
    const cwd = await linkedProject('vercel/evlog')
    const { vercel } = cli([{ uid: 'vercel/evlog', type: 'api-key' }], [])
    expect(summary(await runSetupVercelCheck(ctxAt(cwd), { vercel, oidc, fetchFn: vercelApi(200, 200), now: NOW })))
      .toEqual(['linked:ok', 'oidc:ok', 'connector:ok', 'attached:fail', 'token:skipped', 'read:skipped'])
    const noLogin = () => Promise.reject(new Error('No OIDC token for the linked Vercel project: not logged in'))
    expect(summary(await runSetupVercelCheck(ctxAt(cwd), { vercel, oidc: noLogin })))
      .toEqual(['linked:ok', 'oidc:fail', 'connector:skipped', 'attached:skipped', 'token:skipped', 'read:skipped'])
  })

  /* `vercel connect list --json` answers one page of 50 with `pagination.next`; `--next <cursor>` reads the one after. */
  function paged(team: Array<{ uid: string, type: string }>, onProject: string[], size = 2): { vercel: VercelCli, calls: string[] } {
    const calls: string[] = []
    const vercel: VercelCli = (args) => {
      calls.push(args.join(' '))
      const listed = args.includes('--all-projects') ? team : team.filter(connector => onProject.includes(connector.uid))
      const at = args.indexOf('--next')
      const start = at === -1 ? 0 : Number(args[at + 1])
      const next = start + size < listed.length ? String(start + size) : null
      return Promise.resolve({ code: 0, stdout: JSON.stringify({ connectors: listed.slice(start, start + size), cursor: next, pagination: { next } }), stderr: '' })
    }
    return { vercel, calls }
  }
  const team = [{ uid: 'slack/bot', type: 'slack' }, { uid: 'vercel/other', type: 'api-key' }, { uid: 'github/app', type: 'github' }, { uid: 'vercel/evlog', type: 'api-key' }]

  it('finds the connector and its attachment past the first page of the list', async () => {
    const cwd = await linkedProject('vercel/evlog')
    const { vercel, calls } = paged(team, ['slack/bot', 'github/app', 'vercel/evlog'])
    const stages = await runSetupVercelCheck(ctxAt(cwd), { vercel, oidc, fetchFn: vercelApi(200, 200), now: NOW })
    expect(summary(stages)).toEqual(['linked:ok', 'oidc:ok', 'connector:ok', 'attached:ok', 'token:ok', 'read:ok'])
    expect(calls).toContain('connect list --json --all-projects --next 2')
    expect(calls).toContain('connect list --json --next 2')
  })

  it('says the team has no such connector only after the last page', async () => {
    const cwd = await linkedProject('vercel/evlog')
    const { vercel, calls } = paged(team.filter(connector => connector.uid !== 'vercel/evlog'), [])
    const stages = await runSetupVercelCheck(ctxAt(cwd), { vercel, oidc, fetchFn: vercelApi(200, 200), now: NOW })
    expect(stages.find(stage => stage.id === 'connector')).toMatchObject({ status: 'fail', message: 'the team has no vercel/evlog connector' })
    expect(calls.filter(call => call.includes('--all-projects'))).toEqual(['connect list --json --all-projects', 'connect list --json --all-projects --next 2'])
  })

  it('fails the connector stage when a later page cannot be read, or the cursor repeats', async () => {
    const cwd = await linkedProject('vercel/evlog')
    const broken: VercelCli = args => Promise.resolve(args.includes('--next')
      ? { code: 1, stdout: '', stderr: 'Error: rate limited\n' }
      : { code: 0, stdout: JSON.stringify({ connectors: [{ uid: 'slack/bot', type: 'slack' }], pagination: { next: 'c1' } }), stderr: '' })
    expect((await runSetupVercelCheck(ctxAt(cwd), { vercel: broken, oidc })).find(stage => stage.id === 'connector'))
      .toMatchObject({ status: 'fail', message: 'vercel connect list --json --all-projects --next c1 failed: Error: rate limited' })
    const looping: VercelCli = () => Promise.resolve({ code: 0, stdout: JSON.stringify({ connectors: [], pagination: { next: 'same' } }), stderr: '' })
    expect((await runSetupVercelCheck(ctxAt(cwd), { vercel: looping, oidc })).find(stage => stage.id === 'connector'))
      .toMatchObject({ status: 'fail', message: expect.stringContaining('returned the cursor same twice') })
  })

  it('flags an eve agent without trace instrumentation, and evlog setup eve writes it once', async () => {
    const cwd = await linkedProject('vercel/evlog')
    await mkdir(join(cwd, 'agent'))
    const { vercel } = cli([{ uid: 'vercel/evlog', type: 'api-key' }], ['vercel/evlog'])
    const check = () => runSetupVercelCheck(ctxAt(cwd), { vercel, oidc, fetchFn: vercelApi(200, 200), now: NOW })
    expect((await check()).at(-1)).toMatchObject({ id: 'traces', status: 'warn' })
    expect(await runSetupEve(ctxAt(cwd), { check: true })).toEqual([{ file: join('agent', 'instrumentation', 'evlog.ts'), state: 'missing' }])
    expect(await runSetupEve(ctxAt(cwd))).toEqual([{ file: join('agent', 'instrumentation', 'evlog.ts'), state: 'written' }])
    expect(await runSetupEve(ctxAt(cwd))).toMatchObject([{ state: 'present' }])
    expect((await check()).at(-1)).toMatchObject({ id: 'traces', status: 'ok' })
  })

  it('leaves an instrumentation file it did not write alone', async () => {
    const cwd = await linkedProject('vercel/evlog')
    await mkdir(join(cwd, 'agent', 'instrumentation'), { recursive: true })
    await writeFile(join(cwd, 'agent', 'instrumentation', 'evlog.ts'), 'export default {}\n')
    expect(await runSetupEve(ctxAt(cwd))).toMatchObject([{ state: 'conflict' }])
  })

  it('writes into each member of an agent workspace, never a root agent/', async () => {
    const cwd = await linkedProject()
    await mkdir(join(cwd, 'agents', 'support', 'agent'), { recursive: true })
    await mkdir(join(cwd, 'agents', 'research', 'agent'), { recursive: true })
    expect(await runSetupEve(ctxAt(cwd))).toEqual([
      { file: join('agents', 'research', 'agent', 'instrumentation', 'evlog.ts'), state: 'written' },
      { file: join('agents', 'support', 'agent', 'instrumentation', 'evlog.ts'), state: 'written' },
    ])
    expect(existsSync(join(cwd, 'agent'))).toBe(false)
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

describe('the linked project\'s OIDC token', () => {
  const linked = (projectId: string, teamId = 'team_1') => ({ dir: '/nowhere', projectId, teamId })
  const issued = (claims: Record<string, unknown>) => oidcSdk.getVercelOidcToken.mockResolvedValue(jwt({ environment: 'development', ...claims }))

  it('is requested for the linked ids and kept when it names the same team and project', async () => {
    issued({ owner_id: 'team_1', project_id: 'prj_1' })
    await expect(projectOidc(linked('prj_1'))).resolves.toMatchObject({ scope: { teamId: 'team_1', projectId: 'prj_1' } })
    expect(oidcSdk.getVercelOidcToken).toHaveBeenLastCalledWith({ team: 'team_1', project: 'prj_1' })
  })

  it('is never requested for ids that could reshape the refresh request', async () => {
    oidcSdk.getVercelOidcToken.mockClear()
    for (const [projectId, teamId] of [['prj_1/../../v1/teams', 'team_1'], ['prj_1?teamId=other', 'team_1'], ['prj_1', 'team_1#x'], ['', 'team_1']]) {
      await expect(projectOidc(linked(projectId!, teamId))).rejects.toMatchObject({ code: 'cli.LOGS_VERCEL_NO_TOKEN' })
    }
    expect(oidcSdk.getVercelOidcToken).not.toHaveBeenCalled()
  })

  it('is refused when it names another team or project, without repeating the token', async () => {
    issued({ owner_id: 'team_other', project_id: 'prj_1' })
    const wrongTeam = await projectOidc(linked('prj_1')).catch((error: Error) => error)
    expect(wrongTeam).toMatchObject({ code: 'cli.LOGS_VERCEL_NO_TOKEN', message: expect.stringContaining('team_1') })
    issued({ owner_id: 'team_1', project_id: 'prj_stale' })
    const stale = await projectOidc(linked('prj_1')).catch((error: Error) => error)
    expect(stale).toMatchObject({ code: 'cli.LOGS_VERCEL_NO_TOKEN' })
    for (const error of [wrongTeam, stale]) expect(JSON.stringify({ ...error, message: (error as Error).message })).not.toContain('e30.')
  })
})
