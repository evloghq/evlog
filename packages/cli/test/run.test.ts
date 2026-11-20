import { afterEach, describe, expect, it, vi } from 'vitest'
import { version } from '../package.json'
import { run } from '../src/run'

vi.hoisted(() => {
  process.env.EVLOG_TELEMETRY = '0'
})

function capture(stream: 'stdout' | 'stderr'): () => string {
  const spy = vi.spyOn(process[stream], 'write').mockImplementation(() => true)
  return () => spy.mock.calls.map(([chunk]) => String(chunk)).join('')
}

afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = undefined
})

describe('run', () => {
  it('exits 2 on an unknown command, with the usage and the name it did not know', async () => {
    const stderr = capture('stderr')

    await run(['nope'])

    expect(stderr()).toContain('USAGE  evlog <command>')
    expect(stderr()).toMatch(/Unknown command .*nope/)
    expect(process.exitCode).toBe(2)
  })

  it('exits 2 on a group called without a subcommand, with the group usage', async () => {
    const stderr = capture('stderr')

    await run(['telemetry'])

    expect(stderr()).toContain('USAGE  evlog telemetry <command>')
    expect(stderr()).toContain('No command specified.')
    expect(process.exitCode).toBe(2)
  })

  it.each([
    { where: 'before the command', rawArgs: ['--dryrun', 'telemetry', 'status'] },
    { where: 'between a group and its command', rawArgs: ['telemetry', '--dryrun', 'status'] },
  ])('exits 2 on an unknown flag $where, without running the command', async ({ rawArgs }) => {
    const stderr = capture('stderr')

    await run(rawArgs)

    expect(stderr()).toContain('Unknown flag --dryrun')
    expect(stderr()).not.toContain('Telemetry')
    expect(process.exitCode).toBe(2)
  })

  it('leaves the flags after a command to the command, value flags included', async () => {
    const stdout = capture('stdout')
    capture('stderr')

    await run(['doctor', '--cwd', import.meta.dirname, '--json'])

    expect((JSON.parse(stdout()) as { error?: unknown }).error).toBeUndefined()
    expect(process.exitCode).not.toBe(2)
  })

  it('names a nested command from the root and shows the version in its --help', async () => {
    const stdout = capture('stdout')

    await run(['telemetry', 'status', '--help'])

    expect(stdout()).toContain('USAGE  evlog telemetry status')
    expect(stdout()).toContain(`evlog v${version} `)
    expect(process.exitCode ?? 0).toBe(0)
  })

  it('prints the usage of the command --help was asked on to stdout and exits 0', async () => {
    const stdout = capture('stdout')
    const stderr = capture('stderr')

    await run(['map', '--min-score', '80', '--help'])

    expect(stdout()).toContain('USAGE  evlog map')
    expect(stderr()).toBe('')
    expect(process.exitCode).toBeUndefined()
  })

  it('lists flags the way they are typed, with their short form', async () => {
    const stdout = capture('stdout')

    await run(['init', '--help'])

    for (const flag of ['--no-header', '--prod-drain', '--dry-run', '-y, --yes']) expect(stdout()).toMatch(new RegExp(`│ ${flag} `))
    expect(stdout()).not.toMatch(/--(noHeader|prodDrain|dryRun)/)
  })

  it('lists a positional as an argument, not as a flag', async () => {
    const stdout = capture('stdout')

    await run(['logs', '--help'])

    expect(stdout()).toContain('USAGE  evlog logs [what] [options]')
    expect(stdout()).toMatch(/ARGUMENTS\n\n {2}│ what {2,}`errors`, `slow`, `stats`, or a request id/)
    expect(stdout()).toMatch(/│ -f, --follow /)
    expect(stdout()).not.toContain('--what')
  })

  it('prints the version on --version', async () => {
    const stdout = capture('stdout')

    await run(['--version'])

    expect(stdout()).toBe(`${version}\n`)
  })
})
