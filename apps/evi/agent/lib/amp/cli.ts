import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ampThreadUrl } from './route'

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

const LAUNCH_URL = /https:\/\/ampcode\.com\/threads\/(T-[A-Za-z0-9-]+)/

export function parseAmpLaunch(output: string): { readonly threadId: string, readonly threadUrl: string } | null {
  const match = LAUNCH_URL.exec(output)
  if (match && match[1]) return { threadId: match[1], threadUrl: match[0] }
  const stream = parseAmpNdjson(output)
  const threadUrl = ampThreadUrl(stream.threadId)
  if (stream.threadId !== null && threadUrl !== null) return { threadId: stream.threadId, threadUrl }
  return null
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

export function ampLaunchArgs(input: {
  readonly project: string
  readonly title: string
  readonly settingsFile: string
}): string[] {
  return [
    '--execute',
    '--visibility',
    'private',
    '--executor',
    'orb',
    '--project',
    input.project,
    '--title',
    input.title,
    '--mode',
    'high',
    '--no-archive-after-execute',
    '--settings-file',
    input.settingsFile,
    '--label',
    'evi',
  ]
}

export function ampContinueArgs(input: { readonly threadId: string, readonly settingsFile: string }): string[] {
  return [
    'threads',
    'continue',
    input.threadId,
    '--execute',
    '--visibility',
    'private',
    '--executor',
    'orb',
    '--no-archive-after-execute',
    '--settings-file',
    input.settingsFile,
  ]
}

export function ampListArgs(limit = 50): string[] {
  return ['threads', 'list', '--json', '-n', String(limit)]
}

export function ampSearchArgs(query: string, limit = 10): string[] {
  return ['threads', 'search', query, '--json', '-n', String(limit)]
}

export function ampMarkdownArgs(threadId: string): string[] {
  return ['threads', 'markdown', threadId]
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

export interface AmpCliResult {
  readonly cliMissing: boolean
  readonly aborted: boolean
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | null
}

export interface AmpCliInput {
  readonly args: string[]
  readonly stdin?: string
  readonly apiKey: string
  readonly signal?: AbortSignal
  readonly env?: NodeJS.ProcessEnv
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

export async function runAmpCli(input: AmpCliInput, processAmp: AmpProcess = spawnAmpProcess): Promise<AmpCliResult> {
  const env: NodeJS.ProcessEnv = {
    ...input.env ?? process.env,
    AMP_API_KEY: input.apiKey,
    NO_COLOR: '1',
    CI: '1',
  }
  for (const candidate of ampCliCandidates(input.env ?? process.env)) {
    const result = await processAmp({
      command: candidate.command,
      args: [...candidate.prefix, ...input.args],
      stdin: input.stdin ?? '',
      env,
      signal: input.signal,
    })
    if ('enoent' in result) continue
    return {
      cliMissing: false,
      aborted: input.signal?.aborted === true,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    }
  }
  return { cliMissing: true, aborted: false, stdout: '', stderr: '', exitCode: null }
}

export interface AmpLaunchInput {
  readonly prompt: string
  readonly project: string
  readonly title: string
  readonly apiKey: string
  readonly signal?: AbortSignal
  readonly env?: NodeJS.ProcessEnv
}

export interface AmpLaunchResult {
  readonly threadId: string | null
  readonly threadUrl: string | null
  readonly cliMissing: boolean
  readonly aborted: boolean
}

export async function runAmpLaunch(input: AmpLaunchInput, processAmp: AmpProcess = spawnAmpProcess): Promise<AmpLaunchResult> {
  const result = await runAmpCli({
    args: ampLaunchArgs({
      project: input.project,
      title: input.title,
      settingsFile: writeAmpSettingsFile(),
    }),
    stdin: input.prompt,
    apiKey: input.apiKey,
    signal: input.signal,
    env: input.env,
  }, processAmp)
  if (result.cliMissing) return { threadId: null, threadUrl: null, cliMissing: true, aborted: false }
  const launched = parseAmpLaunch(`${result.stdout}\n${result.stderr}`)
  return {
    threadId: launched?.threadId ?? null,
    threadUrl: launched?.threadUrl ?? null,
    cliMissing: false,
    aborted: result.aborted,
  }
}

export async function runAmpContinue(input: {
  readonly threadId: string
  readonly prompt: string
  readonly apiKey: string
  readonly signal?: AbortSignal
  readonly env?: NodeJS.ProcessEnv
}, processAmp: AmpProcess = spawnAmpProcess): Promise<AmpLaunchResult> {
  const result = await runAmpCli({
    args: ampContinueArgs({
      threadId: input.threadId,
      settingsFile: writeAmpSettingsFile(),
    }),
    stdin: input.prompt,
    apiKey: input.apiKey,
    signal: input.signal,
    env: input.env,
  }, processAmp)
  if (result.cliMissing) return { threadId: null, threadUrl: null, cliMissing: true, aborted: false }
  if (result.aborted || (result.exitCode !== null && result.exitCode !== 0)) {
    return { threadId: null, threadUrl: null, cliMissing: false, aborted: result.aborted }
  }
  const launched = parseAmpLaunch(`${result.stdout}\n${result.stderr}`)
  return {
    threadId: launched?.threadId ?? input.threadId,
    threadUrl: launched?.threadUrl ?? ampThreadUrl(input.threadId),
    cliMissing: false,
    aborted: false,
  }
}

export async function runAmpList(input: {
  readonly apiKey: string
  readonly signal?: AbortSignal
  readonly env?: NodeJS.ProcessEnv
}, processAmp: AmpProcess = spawnAmpProcess): Promise<{ readonly cliMissing: boolean, readonly stdout: string }> {
  const result = await runAmpCli({
    args: ampListArgs(),
    apiKey: input.apiKey,
    signal: input.signal,
    env: input.env,
  }, processAmp)
  return { cliMissing: result.cliMissing, stdout: result.stdout }
}

export async function runAmpSearch(input: {
  readonly query: string
  readonly apiKey: string
  readonly signal?: AbortSignal
  readonly env?: NodeJS.ProcessEnv
}, processAmp: AmpProcess = spawnAmpProcess): Promise<{ readonly cliMissing: boolean, readonly stdout: string }> {
  const result = await runAmpCli({
    args: ampSearchArgs(input.query),
    apiKey: input.apiKey,
    signal: input.signal,
    env: input.env,
  }, processAmp)
  return { cliMissing: result.cliMissing, stdout: result.stdout }
}

export async function runAmpMarkdown(input: {
  readonly threadId: string
  readonly apiKey: string
  readonly signal?: AbortSignal
  readonly env?: NodeJS.ProcessEnv
}, processAmp: AmpProcess = spawnAmpProcess): Promise<{ readonly cliMissing: boolean, readonly stdout: string }> {
  const result = await runAmpCli({
    args: ampMarkdownArgs(input.threadId),
    apiKey: input.apiKey,
    signal: input.signal,
    env: input.env,
  }, processAmp)
  return { cliMissing: result.cliMissing, stdout: result.stdout }
}
