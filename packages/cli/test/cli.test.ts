import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

function line(path: string): string {
  return `${JSON.stringify({ timestamp: new Date().toISOString(), level: 'info', method: 'GET', path, status: 200, duration: '2ms' })}\n`
}

describe('a reader that closes the pipe early', () => {
  /* `evlog logs -f --json | head -1` and `evlog logs -f 2>&1 | head -1`. */
  it.each([
    { stream: 'stdout', args: ['--json'] },
    { stream: 'stderr', args: ['--no-header'] },
  ] as const)('ends a follow on $stream without a stack trace', async ({ stream, args }) => {
    const cwd = await mkdtemp(join(tmpdir(), 'evlog-cli-pipe-'))
    tempDirs.push(cwd)
    await writeFile(join(cwd, 'package.json'), '{"name":"shop"}')
    await mkdir(join(cwd, '.evlog', 'logs'), { recursive: true })
    const log = join(cwd, '.evlog', 'logs', `${new Date().toISOString().slice(0, 10)}.jsonl`)
    await writeFile(log, line('/first'))

    const other = stream === 'stdout' ? 'stderr' : 'stdout'
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'logs', '-f', ...args, '--cwd', cwd], {
      cwd: packageRoot,
      env: { ...process.env, EVLOG_TELEMETRY: '0', HOME: cwd },
    })
    let rest = ''
    child[other].on('data', (chunk: Buffer) => {
      rest += chunk.toString()
    })
    const closed = once(child, 'close') as Promise<[number | null, NodeJS.Signals | null]>

    await once(child[stream], 'data')
    child[stream].destroy()
    /* The follower polls: keep writing until one of its writes meets the closed pipe. */
    const writer = setInterval(() => void appendFile(log, line('/next')), 100)
    const [code, signal] = await closed.finally(() => clearInterval(writer))

    expect({ code, signal, rest }).toEqual({ code: 0, signal: null, rest: '' })
  }, 30_000)
})
