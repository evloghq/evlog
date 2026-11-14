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

  it('prints the usage of the command --help was asked on and exits 0', async () => {
    const stderr = capture('stderr')

    await run(['map', '--min-score', '80', '--help'])

    expect(stderr()).toContain('USAGE  evlog map')
    expect(process.exitCode).toBeUndefined()
  })

  it('prints the version on --version', async () => {
    const stdout = capture('stdout')

    await run(['--version'])

    expect(stdout()).toBe(`${version}\n`)
  })
})
