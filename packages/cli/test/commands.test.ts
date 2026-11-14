import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withTelemetry } from '@evlog/telemetry'
import { defineCommand, runCommand } from 'citty'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import doctor from '../src/commands/doctor'
import logs from '../src/commands/logs'
import map from '../src/commands/map'
import { subCommands } from '../src/commands/index'
import { COMMON_ARGS } from '../src/lib/command'
import { checkFlags } from '../src/lib/flags'
import { main } from '../src/index'

afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = undefined
})

describe('command registry', () => {
  it('gives every lazy command a description for --help without loading it', () => {
    for (const [name, command] of Object.entries(subCommands)) {
      const meta = command.meta as { name: string, description?: string }
      expect(meta.name).toBe(name)
      expect(meta.description).toBeTruthy()
    }
  })

  it('does not give the telemetry group a run of its own', () => {
    expect(subCommands.telemetry.run).toBeUndefined()
    expect(subCommands.doctor.run).toBeTypeOf('function')
  })

  it('reports a missing telemetry subcommand instead of exiting silently', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await expect(runCommand(main, { rawArgs: ['telemetry', '--no-header'] })).rejects.toThrow(/No command specified/)
  })
})

describe('telemetry status', () => {
  it('lists the string values a run can send, from the allowlist the runs use', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await runCommand(main, { rawArgs: ['telemetry', 'status', '--no-header'] })

    const out = stderr.mock.calls.map(([chunk]) => String(chunk)).join('')
    expect(out).toContain('- `initFramework`: `nuxt`')
    expect(out).toContain('- `mapGrade`: `excellent`')
    expect(out).toContain('- `logsView`: ')
  })
})

describe('telemetry outcome', () => {
  const FIXTURE = join(import.meta.dirname, 'map/fixtures/hono-basic')
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'evlog-cli-outcome-'))
    vi.stubEnv('XDG_CONFIG_HOME', home)
    vi.stubEnv('EVLOG_TELEMETRY', '1')
    vi.stubEnv('EVLOG_TELEMETRY_DEBUG', '1')
    vi.stubEnv('DO_NOT_TRACK', '')
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await rm(home, { recursive: true, force: true })
  })

  /** The event a run would send, read from the debug print: nothing leaves the process. */
  async function eventOf(rawArgs: string[]): Promise<{ command: string, outcome: string, errorCode?: string }> {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const tree = withTelemetry(
      defineCommand({ meta: { name: 'evlog' }, subCommands: { doctor, logs, map } }),
      { name: 'evlog-cli-test', version: '0.0.0' },
    )

    await runCommand(tree, { rawArgs })

    const line = stderr.mock.calls.map(([chunk]) => String(chunk)).find(chunk => chunk.startsWith('[@evlog/telemetry] '))
    return JSON.parse(line!.slice('[@evlog/telemetry] '.length))
  }

  it.each([
    { name: 'a flag the command does not declare', args: ['doctor', '--bogus'], code: 'cli.UNKNOWN_FLAG' },
    { name: 'a map threshold that cannot be read', args: ['map', '--cwd', FIXTURE, '--no-write', '--min-score', 'abc'], code: 'cli.MAP_INVALID_MIN_SCORE' },
    { name: 'logs with nothing to read', args: ['logs', '--dir', 'no-such-dir'], code: 'cli.LOGS_NO_SINK' },
  ])('reports $name as an error with its code', async ({ args, code }) => {
    const event = await eventOf(args)

    expect(event).toMatchObject({ command: args[0], outcome: 'error', errorCode: code })
    expect(process.exitCode).toBeGreaterThan(0)
  })

  it('keeps a gate that failed as a successful run', async () => {
    const event = await eventOf(['map', '--cwd', FIXTURE, '--no-write', '--no-header', '--min-score', '100'])

    expect(event.outcome).toBe('success')
    expect(event.errorCode).toBeUndefined()
    expect(process.exitCode).toBe(1)
  })
})

describe('flags', () => {
  function capture(stream: 'stdout' | 'stderr'): () => string {
    const spy = vi.spyOn(process[stream], 'write').mockImplementation(() => true)
    return () => spy.mock.calls.map(([chunk]) => String(chunk)).join('')
  }

  it('refuses a flag the command does not declare instead of ignoring it', async () => {
    const stderr = capture('stderr')

    await runCommand(doctor, { rawArgs: ['--no-header', '--jsno'] })

    expect(stderr()).toContain('Unknown flag --jsno')
    expect(process.exitCode).toBe(2)
  })

  it('answers an unknown flag in JSON when --json was passed', async () => {
    const stdout = capture('stdout')
    capture('stderr')

    await runCommand(doctor, { rawArgs: ['--json', '--jsno'] })

    expect((JSON.parse(stdout()) as { error: { code: string } }).error.code).toBe('cli.UNKNOWN_FLAG')
    expect(process.exitCode).toBe(2)
  })

  it('refuses a value flag left without its value', async () => {
    const stderr = capture('stderr')

    await runCommand(doctor, { rawArgs: ['--no-header', '--cwd'] })

    expect(stderr()).toContain('--cwd needs a value')
    expect(process.exitCode).toBe(2)
  })

  const args = {
    ...COMMON_ARGS,
    follow: { type: 'boolean', alias: 'f' },
    minScore: { type: 'string' },
    write: { type: 'boolean', default: true },
    baseline: { type: 'string' },
    entry: { type: 'positional', required: false },
  } as const

  it('accepts every spelling citty reads: kebab, camel, negated, short, =value', () => {
    const rawArgs = ['-f', '--min-score', '80', '--minScore=80', '--no-write', '--no-header', '--noHeader', 'entry', '--', '--not-a-flag']
    expect(checkFlags(rawArgs, args)).toEqual(rawArgs)
  })

  it.each(['--min-scor', '--no-minscore', '-x', '-fx', '--entry'])('names %s as unknown', (flag) => {
    expect(() => checkFlags([flag], args)).toThrow(`Unknown flag ${flag.startsWith('-f') ? '-x' : flag}`)
  })

  it('reads a flag declared bare as valueless when another flag follows it', () => {
    expect(checkFlags(['--baseline', '--min-score', '80'], args, ['baseline'])).toEqual(['--baseline=', '--min-score', '80'])
    expect(checkFlags(['--baseline', '--no-write'], args, ['baseline'])).toEqual(['--baseline=', '--no-write'])
    expect(checkFlags(['--min-score', '80', '--baseline'], args, ['baseline'])).toEqual(['--min-score', '80', '--baseline='])
    expect(checkFlags(['--baseline', 'git:main'], args, ['baseline'])).toEqual(['--baseline', 'git:main'])
  })
})
