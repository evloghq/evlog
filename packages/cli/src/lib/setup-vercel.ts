import { spawn } from 'node:child_process'
import type { CliContext } from '../core/context'
import { cliErrors } from './errors'
import { loadCliConfig } from './config'
import { DEFAULT_VERCEL_CONNECTOR, findVercelProject, readVercelLogs, resolveVercelAccess, VercelReadError } from './logs/vercel'
import type { VercelAccess, VercelProject } from './logs/vercel'
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

async function listConnectors(vercel: VercelCli, cwd: string, allProjects: boolean): Promise<ListedConnector[]> {
  const args = ['connect', 'list', '--json', ...(allProjects ? ['--all-projects'] : [])]
  const step = `vercel ${args.join(' ')}`
  const result = await vercel(args, { cwd, capture: true })
  if (result.code !== 0) throw cliErrors.SETUP_VERCEL_FAILED({ step, reason: lastLine(result.stderr) })
  let listed: unknown
  try {
    listed = JSON.parse(result.stdout)
  } catch {
    throw cliErrors.SETUP_VERCEL_FAILED({ step, reason: 'its output is not JSON' })
  }
  const items = Array.isArray(listed) ? listed : (listed as { connectors?: unknown })?.connectors
  if (!Array.isArray(items)) throw cliErrors.SETUP_VERCEL_FAILED({ step, reason: 'its output lists no connectors' })
  return items.flatMap((item: { uid?: unknown, type?: unknown }) => typeof item?.uid === 'string'
    ? [{ uid: item.uid, ...(typeof item.type === 'string' && { type: item.type }) }]
    : [])
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
  /** Called before each step that changes something on Vercel. */
  onStep?: (command: string) => void
}

const HOUR_MS = 3_600_000

/**
 * Lets the linked project read its own runtime logs: links it if needed,
 * settles on a connector (the configured one, the default one, or one the
 * team already has), creates the default one if that is the choice, attaches
 * it to the project for every environment, then reads the last hour through it
 * the way `evlog logs --source vercel` and the agent do. Each step is skipped
 * when already done, so it runs again safely.
 */
export async function runSetupVercel(ctx: CliContext, options: SetupVercelOptions = {}): Promise<SetupVercelResult> {
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
    const args = ['connect', 'attach', connector, '--yes']
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
  return { projectId: linked.projectId, connector, created, attached, reused: !created && connector !== DEFAULT_VERCEL_CONNECTOR && configured === undefined, events }
}
