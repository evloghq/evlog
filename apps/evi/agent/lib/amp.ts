import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** First line of a PR Amp opens on Hugo's behalf. */
export const AMP_PR_DISCLAIMER = 'Written by an AI agent on behalf of @HugoRCD. @HugoRCD has not reviewed it yet.'

/** Linear issue label that always sends the coding work to Amp. */
export const AMP_LINEAR_LABEL = 'amp'

export const AMP_ROUTES = ['label', 'explicit', 'multi-file', 'tests', 'refactor'] as const

export type AmpRoute = (typeof AMP_ROUTES)[number]

export type AmpRouteDecision =
  | { readonly delegate: true, readonly reason: AmpRoute }
  | { readonly delegate: false, readonly reason: 'keep' }

const THREAD_ID = /^T-[A-Za-z0-9-]+$/
const ACCESS_TOKEN_PREFIX = 'sgamp_'
const MULTI_FILE_THRESHOLD = 2

export function ampApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env.AMP_API_KEY
  if (typeof key !== 'string' || key.trim() === '') return null
  return key
}

/** Why Amp must not run: missing key, or a login session token Amp's CLI rejects. */
export function ampApiKeyProblem(key: string | null): 'missing' | 'session-token' | null {
  if (key === null) return 'missing'
  if (!key.startsWith(ACCESS_TOKEN_PREFIX)) return 'session-token'
  return null
}

/**
 * Delegate to Amp for labelled or explicit asks, refactors, work that needs
 * tests, or more than two files. Everything else stays with Evi.
 */
export function decideAmpRoute(input: {
  readonly labels?: readonly string[]
  readonly explicit?: boolean
  readonly filesToChange?: number
  readonly needsTests?: boolean
  readonly isRefactor?: boolean
}): AmpRouteDecision {
  const labels = (input.labels ?? []).map(label => label.toLowerCase())
  if (labels.includes(AMP_LINEAR_LABEL)) return { delegate: true, reason: 'label' }
  if (input.explicit) return { delegate: true, reason: 'explicit' }
  if (input.isRefactor) return { delegate: true, reason: 'refactor' }
  if (input.needsTests) return { delegate: true, reason: 'tests' }
  if ((input.filesToChange ?? 0) > MULTI_FILE_THRESHOLD) return { delegate: true, reason: 'multi-file' }
  return { delegate: false, reason: 'keep' }
}

export function ampThreadUrl(sessionId: string | null): string | null {
  if (sessionId === null || !THREAD_ID.test(sessionId)) return null
  return `https://ampcode.com/threads/${sessionId}`
}

export function ampThreadTitle(brief: string): string {
  const oneLine = brief.replace(/\s+/g, ' ').trim().slice(0, 200)
  const title = oneLine.length === 0 ? 'Evi coding task' : oneLine
  return title.startsWith('-') ? `Evi: ${title}` : title
}

export interface AmpPromptInput {
  readonly brief: string
  readonly repository: string
  readonly branch?: string
  readonly issue?: string
  readonly paths?: readonly string[]
}

/** Prompt Amp sees: the brief, repo context, and the shipping rules Evi already enforces. */
export function buildAmpPrompt(input: AmpPromptInput): string {
  const paths = input.paths && input.paths.length > 0 ? input.paths.join(', ') : 'the paths the brief names'
  const branch = input.branch ?? 'main'
  const issue = input.issue ?? 'none'
  return [
    'You are Amp, running a coding task delegated by Evi, the evlog agent.',
    '',
    '## Task',
    input.brief.trim(),
    '',
    '## Repository',
    `GitHub: ${input.repository}`,
    `Base branch: ${branch}`,
    `Issue: ${issue}`,
    `Prefer these paths: ${paths}`,
    '',
    '## Rules that never bend',
    'Read AGENTS.md at the repository root and follow it. In particular:',
    '',
    '- Never merge a pull request, never enable auto-merge, never push to main or master.',
    '- Never add a Co-authored-by, Signed-off-by, "Generated with", or any signature that names an agent, model, or tool.',
    '- Never use an em dash. Use a comma, a colon, or a period.',
    '- Conventional Commits titles, lowercase subject.',
    '- A pull request body has this shape and nothing else: Why, Proof, Risk, Checks, then a GitHub ELI5 <details> block.',
    `- The first line of the pull request body must be exactly: ${AMP_PR_DISCLAIMER}`,
    '- Stop after the branch is pushed and the pull request is open. Evi will verify (tests, screenshots) and will not merge.',
    '',
    '## Done',
    'Reply with: the branch name, the pull request URL if you opened one, the checks you ran, and anything that failed or could not run.',
  ].join('\n')
}

export interface AmpStreamState {
  readonly threadId: string | null
  readonly summary: string | null
  readonly error: string | null
  readonly isError: boolean
  readonly finished: boolean
  readonly durationMs: number | null
  readonly turns: number | null
}

export function emptyAmpStreamState(): AmpStreamState {
  return {
    threadId: null,
    summary: null,
    error: null,
    isError: false,
    finished: false,
    durationMs: null,
    turns: null,
  }
}

export function foldAmpLine(state: AmpStreamState, line: string): AmpStreamState {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{')) return state
  let message: unknown
  try {
    message = JSON.parse(trimmed)
  } catch {
    return state
  }
  return foldAmpMessage(state, message)
}

function foldAmpMessage(state: AmpStreamState, message: unknown): AmpStreamState {
  if (typeof message !== 'object' || message === null) return state
  const row = message as Record<string, unknown>
  const threadId = typeof row.session_id === 'string' ? row.session_id : state.threadId
  const withThread = threadId === state.threadId ? state : { ...state, threadId }
  if (row.type !== 'result') return withThread
  const durationMs = typeof row.duration_ms === 'number' ? row.duration_ms : null
  const turns = typeof row.num_turns === 'number' ? row.num_turns : null
  if (row.is_error === true || row.subtype === 'error_during_execution' || row.subtype === 'error_max_turns') {
    const error = typeof row.error === 'string' ? row.error : 'Amp execute failed.'
    return { ...withThread, finished: true, isError: true, error, durationMs, turns }
  }
  const summary = typeof row.result === 'string' ? row.result : ''
  return { ...withThread, finished: true, isError: false, summary, error: null, durationMs, turns }
}

export function parseAmpNdjson(output: string): AmpStreamState {
  return output.split(/\r?\n/).reduce(foldAmpLine, emptyAmpStreamState())
}

/** Stops Amp from appending git trailers AGENTS.md forbids. */
export const AMP_CLI_SETTINGS = {
  'amp.git.commit.coauthor.enabled': false,
  'amp.git.commit.ampThread.enabled': false,
} as const

export function writeAmpSettingsFile(dir: string = tmpdir()): string {
  const path = join(dir, 'evi-amp-settings.json')
  writeFileSync(path, `${JSON.stringify(AMP_CLI_SETTINGS, null, 2)}\n`)
  return path
}

export function ampExecuteArgs(input: { readonly project: string, readonly title: string, readonly settingsFile: string }): string[] {
  return [
    '--execute',
    '--stream-json',
    '--visibility', 'private',
    '--executor', 'orb',
    '--project', input.project,
    '--title', input.title,
    '--mode', 'high',
    '--no-archive-after-execute',
    '--settings-file', input.settingsFile,
    '--label', 'evi',
  ]
}

export function ampCliCandidates(env: NodeJS.ProcessEnv = process.env): { command: string, prefix: string[] }[] {
  const configured = env.AMP_CLI?.trim()
  if (configured) return [{ command: configured, prefix: [] }]
  return [
    { command: 'amp', prefix: [] },
    { command: 'npx', prefix: ['--yes', '@ampcode/cli'] },
  ]
}

export interface AmpProcessRequest {
  readonly command: string
  readonly args: string[]
  readonly stdin: string
  readonly env: NodeJS.ProcessEnv
  readonly signal?: AbortSignal
}

export type AmpProcessResult =
  | { readonly enoent: true }
  | { readonly stdout: string, readonly stderr: string, readonly exitCode: number | null }

export type AmpProcess = (request: AmpProcessRequest) => Promise<AmpProcessResult>

export interface AmpRunInput {
  readonly prompt: string
  readonly project: string
  readonly title: string
  readonly apiKey: string
  readonly signal?: AbortSignal
  readonly env?: NodeJS.ProcessEnv
}

export interface AmpRunResult {
  readonly state: AmpStreamState
  readonly cliMissing: boolean
  readonly aborted: boolean
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'ENOENT'
}

export async function spawnAmpProcess(request: AmpProcessRequest): Promise<AmpProcessResult> {
  return await new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(request.command, request.args, {
        env: request.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        signal: request.signal,
      })
    } catch (error) {
      if (isEnoent(error)) {
        resolve({ enoent: true })
        return
      }
      reject(error)
      return
    }

    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.stdin.end(request.stdin, 'utf8')

    child.on('error', (error) => {
      if (isEnoent(error)) {
        resolve({ enoent: true })
        return
      }
      if (request.signal?.aborted) {
        resolve({
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
          exitCode: null,
        })
        return
      }
      reject(error)
    })

    child.on('close', (code) => {
      resolve({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        exitCode: code,
      })
    })
  })
}

export async function runAmpExecute(input: AmpRunInput, processAmp: AmpProcess = spawnAmpProcess): Promise<AmpRunResult> {
  const args = ampExecuteArgs({
    project: input.project,
    title: input.title,
    settingsFile: writeAmpSettingsFile(),
  })
  const env: NodeJS.ProcessEnv = {
    ...input.env ?? process.env,
    AMP_API_KEY: input.apiKey,
    NO_COLOR: '1',
    CI: '1',
  }
  for (const candidate of ampCliCandidates(input.env ?? process.env)) {
    const result = await processAmp({
      command: candidate.command,
      args: [...candidate.prefix, ...args],
      stdin: input.prompt,
      env,
      signal: input.signal,
    })
    if ('enoent' in result) continue
    const state = parseAmpNdjson(result.stdout)
    return {
      state,
      cliMissing: false,
      aborted: input.signal?.aborted === true && !state.finished,
    }
  }
  return { state: emptyAmpStreamState(), cliMissing: true, aborted: false }
}
