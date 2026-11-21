import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CliContext } from '../core/context'
import { cliErrors } from './errors'
import { loadCliConfig, writeLogsConnector } from './config'
import type { ConnectorWrite } from './config'
import { findVercelProject, projectOidc, readVercelLogs, requestConnectToken, resolveVercelAccess, VercelReadError } from './logs/vercel'
import type { VercelAccess, VercelProject, VercelScope } from './logs/vercel'
import { resolveProject } from './project'
import { eveAgentDirs } from './frameworks/eve/mount'
import { inspectEveInstrumentation } from './setup-eve'

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

/**
 * The team's connectors a deployed agent could read its runtime logs through,
 * and which of them the project already has. Read-only: lists, never creates
 * or attaches.
 */
export async function findLogConnectors(linked: VercelProject, vercel: VercelCli = createVercelCli()): Promise<{ reusable: ListedConnector[], attached: Set<string> }> {
  const reusable = reusableConnectors(await listConnectors(vercel, linked.dir, true))
  const attached = new Set((await listConnectors(vercel, linked.dir, false)).map(connector => connector.uid))
  return { reusable, attached }
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
  /** Where `logs.vercel.connector` now names the connector, which reads go through. Absent with `writeConfig: false`. */
  config?: ConnectorWrite
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
  /** Create `connector`, which the team must not have yet, instead of using one it has. */
  create?: boolean
  /**
   * Name the connector in `evlog.config` as `logs.vercel.connector`. Off for a
   * caller that writes the config itself, such as `evlog init`.
   * @default true
   */
  writeConfig?: boolean
  /**
   * Asked when neither `connector` nor `evlog.config` names one, with the
   * team's Vercel API-key connectors (possibly none). Returns the connector
   * to use or create, or `undefined` for none, which stops the setup.
   * Without it, setup stops and lists the connectors `connector` could name.
   */
  choose?: (reusable: ListedConnector[], attached: ReadonlySet<string>) => Promise<ConnectorChoice | undefined>
  /**
   * The environments to attach the connector for. Each one's deployments can
   * exchange their OIDC token for the key the connector stores.
   * @default ['production', 'development']
   */
  environments?: string[]
  /** Called before each step that changes something on Vercel, with what an attachment grants, and with each line `evlog.config` gained. */
  onStep?: (command: string) => void
}

/** A connector to read through, and whether setup creates it. */
export interface ConnectorChoice {
  connector: string
  create: boolean
}

/* The UID `vercel connect create vercel --name <name>` gives a connector. */
const CREATABLE = /^vercel\/[a-z0-9][\w-]*$/i

const HOUR_MS = 3_600_000
/* Production for deployed agents, development for the token `evlog logs` and this check read with. Preview runs any branch's code, so it is asked for by name. */
export const DEFAULT_ATTACH_ENVIRONMENTS = ['production', 'development']
const ENVIRONMENT = /^[a-z0-9][\w-]*$/i

/**
 * Lets the linked project read its own runtime logs: links it if needed,
 * settles on a connector (the one passed, the configured one, or the one
 * `choose` picks), creates it when that is the choice, attaches it to the
 * project for the chosen environments, names it in `evlog.config`, then reads
 * the last hour through it the way `evlog logs --source vercel` and the agent
 * do. No connector is ever assumed. Each step is skipped when already done,
 * so it runs again safely.
 */
export async function runSetupVercel(ctx: CliContext, options: SetupVercelOptions = {}): Promise<SetupVercelResult> {
  const environments = options.environments ?? DEFAULT_ATTACH_ENVIRONMENTS
  const invalid = environments.find(environment => !ENVIRONMENT.test(environment))
  if (environments.length === 0 || invalid !== undefined) throw cliErrors.SETUP_INVALID_ENVIRONMENT({ value: invalid ?? '' })
  if (options.create && !CREATABLE.test(options.connector ?? '')) throw cliErrors.SETUP_INVALID_CONNECTOR({ value: options.connector ?? '' })
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
  let choice: ConnectorChoice | undefined = configured === undefined ? undefined : { connector: configured, create: options.create === true }
  if (!choice) {
    const reusable = reusableConnectors(team)
    choice = await options.choose?.(reusable, onProject)
    if (!choice) throw cliErrors.SETUP_VERCEL_NO_CONNECTOR({ reusable: reusable.map(listed => listed.uid) })
    if (choice.create && !CREATABLE.test(choice.connector)) throw cliErrors.SETUP_INVALID_CONNECTOR({ value: choice.connector })
  }
  const { connector, create } = choice
  const step = 'vercel connect list --json --all-projects'
  if (create && onTeam.has(connector)) {
    throw cliErrors.SETUP_VERCEL_FAILED({ step, reason: `the team already has a ${connector} connector; drop --create to use it` })
  }
  if (!create && !onTeam.has(connector)) {
    throw cliErrors.SETUP_VERCEL_FAILED({ step, reason: `the team has no ${connector} connector; pass --connector ${connector} --create to create it` })
  }

  if (create) {
    const args = ['connect', 'create', 'vercel', '--name', connector.split('/')[1]!]
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

  const config = options.writeConfig === false ? undefined : writeLogsConnector(project, connector)
  if (config?.diff) {
    options.onStep?.(`${config.state === 'created' ? 'wrote' : 'edited'} ${config.file}:`)
    for (const line of config.diff) options.onStep?.(line)
  } else if (config?.state === 'manual') {
    options.onStep?.(`left ${config.file} as it is: it computes its config or names another connector. Set logs: { vercel: { connector: '${connector}' } } in it`)
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
  return { projectId: linked.projectId, connector, created: create, attached, ...(attached && { environments }), ...(config && { config }), events }
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

  const connector = options.connector ?? loadCliConfig(project)?.logs.vercel?.connector
  if (connector === undefined) {
    stages.push({ id: 'connector', status: 'fail', message: 'evlog.config names no logs.vercel.connector', fix: 'npx evlog setup vercel (offers the team\'s connectors and writes the one you pick to evlog.config.ts)' })
    return done()
  }
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
    stages.push({ id: 'connector', status: 'fail', message: `the team has no ${connector} connector`, fix: `npx evlog setup vercel --connector ${connector} --create (asks for a Vercel access token scoped to the team), or name a connector the team has in logs.vercel.connector` })
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

  const traces = tracesStage(project.packageDir)
  if (traces) stages.push(traces)
  return stages
}

/** For an eve agent: whether each agent's `instrumentation/` exports `evlogTraces()`, which puts trace ids on turn events. */
function tracesStage(packageDir: string): PreflightStage | undefined {
  const agents = eveAgentDirs(packageDir)
  if (agents.length === 0) return undefined
  const found = agents.map(agentDir => inspectEveInstrumentation(packageDir, agentDir))
  const missing = found.filter(entry => entry.state !== 'present')
  if (missing.length === 0) return { id: 'traces', status: 'ok', message: `${found.map(entry => entry.file).join(', ')} export${found.length === 1 ? 's' : ''} evlogTraces()` }
  return { id: 'traces', status: 'warn', message: `turn events carry no traceId (${missing.map(entry => entry.file).join(', ')})`, fix: 'npx evlog setup eve (writes instrumentation/evlog.ts in each agent; reads span ids only and exports nothing)' }
}
