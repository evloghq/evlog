import { runCommand } from 'citty'
import { afterEach, describe, expect, it, vi } from 'vitest'
import doctor from '../src/commands/doctor'
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
