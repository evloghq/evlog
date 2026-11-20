import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CliContext } from '../core/context'
import { cliErrors } from './errors'
import { loadCliConfig } from './config'
import { DEFAULT_VERCEL_CONNECTOR, findVercelProject, projectOidc, readVercelLogs, requestConnectToken, resolveVercelAccess, VercelReadError } from './logs/vercel'
import type { VercelAccess, VercelProject, VercelScope } from './logs/vercel'
import { resolveProject } from './project'

export interface VercelRun {
  code: number
  stdout: string
  stderr: string
}

/**
 * Runs the Vercel CLI. `capture` reads its output; otherwise it talks to the
 * terminal, so its prompts and browser sign-ins work, with its stdout on our
 * stderr to keep `--json` clean.
 */
export type VercelCli = (args: string[], options: { cwd: string, capture: boolean }) => Promise<VercelRun>

function run(bin: string, args: string[], cwd: string, capture: boolean): Promise<VercelRun | 'missing'> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd, stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['inherit', 2, 'inherit'], shell: process.platform === 'win32' })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (error: NodeJS.ErrnoException) => resolve(error.code === 'ENOENT' ? 'missing' : { code: 1, stdout, stderr: error.message }))
    child.on('close', code => resolve({ code: code ?? 1, stdout, stderr }))
  })
}

/** `vercel` when it is installed, else the latest through npx. */
export function createVercelCli(): VercelCli {
  let viaNpx = false
  return async (args, { cwd, capture }) => {
    if (!viaNpx) {
      const result = await run('vercel', args, cwd, capture)
      if (result !== 'missing') return result
      viaNpx = true
    }
    const result = await run('npx', ['--yes', 'vercel@latest', ...args], cwd, capture)
    return result === 'missing' ? { code: 1, stdout: '', stderr: 'neither vercel nor npx is on PATH' } : result
  }
}

function lastLine(text: string): string {
  return text.split('\n').map(line => line.trim()).filter(Boolean).at(-1) ?? 'no output'
}

/** A connector as `vercel connect list --json` lists it. */
export interface ListedConnector {
  uid: string
  type?: string
}

/* `connect list` answers one page at a time; `pagination.next` (older releases: `cursor`) names the next one. */
async function listConnectors(vercel: VercelCli, cwd: string, allProjects: boolean): Promise<ListedConnector[]> {
  const base = ['connect', 'list', '--json', ...(allProjects ? ['--all-projects'] : [])]
  const connectors: ListedConnector[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  do {
    const args = cursor === undefined ? base : [...base, '--next', cursor]
    const step = `vercel ${args.join(' ')}`
    const result = await vercel(args, { cwd, capture: true })
    if (result.code !== 0) throw cliErrors.SETUP_VERCEL_FAILED({ step, reason: lastLine(result.stderr) })
    let listed: unknown
    try {
      listed = JSON.parse(result.stdout)
    } catch {
      throw cliErrors.SETUP_VERCEL_FAILED({ step, reason: 'its output is not JSON' })
    }
    const page = listed as { connectors?: unknown, cursor?: unknown, pagination?: { next?: unknown } } | null
    const items = Array.isArray(listed) ? listed : page?.connectors
    if (!Array.isArray(items)) throw cliErrors.SETUP_VERCEL_FAILED({ step, reason: 'its output lists no connectors' })
    for (const item of items as Array<{ uid?: unknown, type?: unknown }>) {
      if (typeof item?.uid === 'string') connectors.push({ uid: item.uid, ...(typeof item.type === 'string' && { type: item.type }) })
    }
    const next = Array.isArray(listed) ? undefined : page?.pagination ? page.pagination.next : page?.cursor
    cursor = typeof next === 'string' && next ? next : undefined
    if (cursor !== undefined) {
      if (seen.has(cursor)) throw cliErrors.SETUP_VERCEL_FAILED({ step, reason: `it returned the cursor ${cursor} twice` })
      seen.add(cursor)
    }
  } while (cursor !== undefined)
  return connectors
}

/** Vercel connectors that hold an API key, which is what issues app tokens a read can use. */
export function reusableConnectors(team: ListedConnector[]): ListedConnector[] {
  return team.filter(connector => connector.uid.startsWith('vercel/') && connector.type === 'api-key')
}

async function interactive(vercel: VercelCli, args: string[], cwd: string): Promise<void> {
  const result = await vercel(args, { cwd, capture: false })
  if (result.code !== 0) throw cliErrors.SETUP_VERCEL_FAILED({ step: `vercel ${args.join(' ')}`, reason: `exited ${result.code}` })
}

export interface SetupVercelResult {
  projectId: string
  connector: string
  created: boolean
  attached: boolean
  /**
   * The environments this run attached the connector for. Absent when it was
   * already attached: `vercel connect list` does not say for which environments.
   */
  environments?: string[]
  /** Whether the connector is one the team already had, which `logs.vercel.connector` has to name. */
  reused: boolean
  /** Events the check read back from the last hour of runtime logs. */
  events: number
}

export interface SetupVercelOptions {
  vercel?: VercelCli
  access?: (project: VercelProject, connector: string) => Promise<VercelAccess>
  fetchFn?: typeof fetch
  now?: Date
  /** The connector to use, over `logs.vercel.connector` in `evlog.config`. */
  connector?: string
  /**
   * Asked when the team has Vercel connectors to reuse and none is configured.
   * Returns the one to reuse, or `undefined` to create the default one.
   * Without it, setup creates the default one.
   */
  choose?: (reusable: ListedConnector[], attached: ReadonlySet<string>) => Promise<string | undefined>
  /**
   * The environments to attach the connector for. Each one's deployments can
   * exchange their OIDC token for the key the connector stores.
   * @default ['production', 'development']
   */
  environments?: string[]
  /** Called before each step that changes something on Vercel, and with what an attachment grants. */
  onStep?: (command: string) => void
}

const HOUR_MS = 3_600_000
/* Production for deployed agents, development for the token `evlog logs` and this check read with. Preview runs any branch's code, so it is asked for by name. */
export const DEFAULT_ATTACH_ENVIRONMENTS = ['production', 'development']
const ENVIRONMENT = /^[a-z0-9][\w-]*$/i

/**
 * Lets the linked project read its own runtime logs: links it if needed,
 * settles on a connector (the configured one, the default one, or one the
 * team already has), creates the default one if that is the choice, attaches
 * it to the project for the chosen environments, then reads the last hour through it
 * the way `evlog logs --source vercel` and the agent do. Each step is skipped
 * when already done, so it runs again safely.
 */
export async function runSetupVercel(ctx: CliContext, options: SetupVercelOptions = {}): Promise<SetupVercelResult> {
  const environments = options.environments ?? DEFAULT_ATTACH_ENVIRONMENTS
  const invalid = environments.find(environment => !ENVIRONMENT.test(environment))
  if (environments.length === 0 || invalid !== undefined) throw cliErrors.SETUP_INVALID_ENVIRONMENT({ value: invalid ?? '' })
  const vercel = options.vercel ?? createVercelCli()
  const project = await resolveProject(ctx.cwd)
  let linked = await findVercelProject(project.packageDir, project.root)
  if (!linked) {
    options.onStep?.('vercel link')
    await interactive(vercel, ['link'], project.packageDir)
    linked = await findVercelProject(project.packageDir, project.root)
    if (!linked) throw cliErrors.LOGS_VERCEL_NOT_LINKED({ cwd: ctx.cwd })
  }

  const team = await listConnectors(vercel, linked.dir, true)
  const onProject = new Set((await listConnectors(vercel, linked.dir, false)).map(connector => connector.uid))
  const onTeam = new Set(team.map(connector => connector.uid))
  const configured = options.connector ?? loadCliConfig(project)?.logs.vercel?.connector
  let connector = configured ?? DEFAULT_VERCEL_CONNECTOR
  if (configured === undefined && !onTeam.has(DEFAULT_VERCEL_CONNECTOR)) {
    const reusable = reusableConnectors(team)
    if (reusable.length > 0 && options.choose) connector = await options.choose(reusable, onProject) ?? DEFAULT_VERCEL_CONNECTOR
  }

  const created = !onTeam.has(connector)
  if (created) {
    if (connector !== DEFAULT_VERCEL_CONNECTOR) {
      throw cliErrors.SETUP_VERCEL_FAILED({ step: 'vercel connect list --json --all-projects', reason: `the team has no ${connector} connector` })
    }
    const args = ['connect', 'create', 'vercel', '--name', DEFAULT_VERCEL_CONNECTOR.split('/')[1]!]
    options.onStep?.(`vercel ${args.join(' ')}`)
    await interactive(vercel, args, linked.dir)
    if (!(await listConnectors(vercel, linked.dir, true)).some(listed => listed.uid === connector)) {
      throw cliErrors.SETUP_VERCEL_FAILED({ step: `vercel ${args.join(' ')}`, reason: `the team has no ${connector} connector afterwards` })
    }
  }

  const attached = !onProject.has(connector)
  if (attached) {
    const args = ['connect', 'attach', connector, '--yes', '--environment', environments.join(',')]
    options.onStep?.(`${connector} gives code deployed to ${environments.join(', ')} of ${linked.projectId} the authority of the key it stores, whatever that key may read or change on the team`)
    options.onStep?.(`vercel ${args.join(' ')}`)
    await interactive(vercel, args, linked.dir)
  }

  const { token, scope } = await (options.access ?? resolveVercelAccess)(linked, connector)
  const now = options.now ?? new Date()
  let events = 0
  try {
    for await (const _event of readVercelLogs({ token, scope, since: new Date(now.getTime() - HOUR_MS), until: now, maxLines: 1000, fetchFn: options.fetchFn })) events += 1
  } catch (error) {
    if (error instanceof VercelReadError) throw cliErrors.LOGS_VERCEL_READ_FAILED({ httpStatus: error.status, reason: error.message })
    throw error
  }
  return { projectId: linked.projectId, connector, created, attached, ...(attached && { environments }), reused: !created && connector !== DEFAULT_VERCEL_CONNECTOR && configured === undefined, events }
}

/** One stage of `evlog setup vercel --check`. */
export interface PreflightStage {
  id: 'linked' | 'oidc' | 'connector' | 'attached' | 'token' | 'read' | 'traces'
  status: 'ok' | 'warn' | 'fail' | 'skipped'
  message: string
  /** What to run or change, when the stage did not pass. */
  fix?: string
}

export interface PreflightOptions {
  vercel?: VercelCli
  oidc?: (project: VercelProject) => Promise<{ oidc: string, scope: VercelScope }>
  fetchFn?: typeof fetch
  now?: Date
  connector?: string
}

const PREFLIGHT_ORDER: PreflightStage['id'][] = ['linked', 'oidc', 'connector', 'attached', 'token', 'read']

/**
 * Checks each step `evlog logs --source vercel` and a deployed agent depend
 * on, one at a time, and changes nothing: it lists connectors, asks Connect
 * for a token, and reads the last hour once. A token from Connect does not
 * prove the key behind it may read runtime logs, so the read is its own stage.
 * The stages after the first failure are listed as skipped.
 */
export async function runSetupVercelCheck(ctx: CliContext, options: PreflightOptions = {}): Promise<PreflightStage[]> {
  const vercel = options.vercel ?? createVercelCli()
  const stages: PreflightStage[] = []
  const done = (): PreflightStage[] => {
    for (const id of PREFLIGHT_ORDER.slice(stages.length)) stages.push({ id, status: 'skipped', message: 'not checked: an earlier stage failed' })
    return stages
  }
  const project = await resolveProject(ctx.cwd)
  const linked = await findVercelProject(project.packageDir, project.root)
  if (!linked) {
    stages.push({ id: 'linked', status: 'fail', message: 'no .vercel/project.json', fix: 'vercel link (interactive: asks which project, and can create one)' })
    return done()
  }
  stages.push({ id: 'linked', status: 'ok', message: `${linked.projectId} on ${linked.teamId}` })

  let oidc: string
  let scope: VercelScope
  try {
    ({ oidc, scope } = await (options.oidc ?? projectOidc)(linked))
  } catch (error) {
    stages.push({ id: 'oidc', status: 'fail', message: error instanceof Error ? error.message : String(error), fix: 'vercel login, then run this again' })
    return done()
  }
  stages.push({ id: 'oidc', status: 'ok', message: `token for ${scope.projectId}, reads ${scope.environment}` })

  const connector = options.connector ?? loadCliConfig(project)?.logs.vercel?.connector ?? DEFAULT_VERCEL_CONNECTOR
  let onTeam: ListedConnector | undefined
  let onProject: boolean
  try {
    onTeam = (await listConnectors(vercel, linked.dir, true)).find(listed => listed.uid === connector)
    onProject = (await listConnectors(vercel, linked.dir, false)).some(listed => listed.uid === connector)
  } catch (error) {
    stages.push({ id: 'connector', status: 'fail', message: error instanceof Error ? error.message : String(error), fix: 'vercel login with an account on the team' })
    return done()
  }
  if (!onTeam) {
    stages.push({ id: 'connector', status: 'fail', message: `the team has no ${connector} connector`, fix: 'npx evlog setup vercel (creates it; asks for a Vercel access token scoped to the team)' })
    return done()
  }
  stages.push({ id: 'connector', status: onTeam.type === 'api-key' ? 'ok' : 'warn', message: `${connector} (${onTeam.type ?? 'unknown type'})`, ...(onTeam.type !== 'api-key' && { fix: 'Reads need an API-key connector holding a Vercel access token' }) })
  if (!onProject) {
    stages.push({ id: 'attached', status: 'fail', message: `${connector} is not attached to ${linked.projectId}`, fix: `npx evlog setup vercel (runs vercel connect attach ${connector} --yes --environment ${DEFAULT_ATTACH_ENVIRONMENTS.join(',')})` })
    return done()
  }
  stages.push({ id: 'attached', status: 'ok', message: `attached to ${linked.projectId}; the project's Connect tab lists the environments it covers` })

  let token: string
  try {
    token = await requestConnectToken(oidc, connector, options.fetchFn)
  } catch (error) {
    const status = error instanceof VercelReadError ? error.status : undefined
    stages.push({ id: 'token', status: 'fail', message: `Vercel Connect issued no token${status ? ` (${status})` : ''}`, fix: 'Check the connector is attached for this environment, then run this again' })
    return done()
  }
  stages.push({ id: 'token', status: 'ok', message: 'Vercel Connect issued a token for the OIDC token' })

  const now = options.now ?? new Date()
  let events = 0
  let lines = 0
  try {
    const reader = readVercelLogs({ token, scope, since: new Date(now.getTime() - HOUR_MS), until: now, maxLines: 100, fetchFn: options.fetchFn })
    let step = await reader.next()
    for (; !step.done; step = await reader.next()) events += 1
    ;({ lines } = step.value)
  } catch (error) {
    if (!(error instanceof VercelReadError)) throw error
    stages.push(error.status === 403
      ? { id: 'read', status: 'fail', message: `the key stored in ${connector} may not read runtime logs (403)`, fix: `Replace the key in ${connector} with a Vercel access token scoped to the team (Account Settings → Tokens). An OIDC token or a provider key cannot read runtime logs` }
      : { id: 'read', status: 'fail', message: `Vercel refused the read (${error.status})`, fix: 'Check the plan keeps runtime logs (Hobby 1 hour, Pro 1 day)' })
    return done()
  }
  stages.push(events > 0
    ? { id: 'read', status: 'ok', message: `read ${events} event${events === 1 ? '' : 's'} from the last hour` }
    : { id: 'read', status: 'ok', message: `allowed; ${lines === 0 ? 'no runtime log lines' : `${lines} log lines, none an evlog event,`} in the last hour`, ...(lines > 0 && { fix: 'evlog prints one JSON line per event to stdout; check the deployment runs evlog' }) })

  const traces = await tracesStage(project.packageDir)
  if (traces) stages.push(traces)
  return stages
}

/** For an eve agent: whether `agent/instrumentation` exports `evlogTraces()`, which puts trace ids on turn events. */
async function tracesStage(packageDir: string): Promise<PreflightStage | undefined> {
  if (!existsSync(join(packageDir, 'agent'))) return undefined
  const dir = join(packageDir, 'agent', 'instrumentation')
  const files = existsSync(dir) ? (await readdir(dir)).filter(file => /\.[cm]?[jt]s$/.test(file)) : []
  for (const file of files) {
    if ((await readFile(join(dir, file), 'utf8')).includes('evlogTraces')) return { id: 'traces', status: 'ok', message: `agent/instrumentation/${file} exports evlogTraces()` }
  }
  return { id: 'traces', status: 'warn', message: 'turn events carry no traceId', fix: 'npx evlog setup eve (writes agent/instrumentation/evlog.ts; reads span ids only and exports nothing)' }
}
