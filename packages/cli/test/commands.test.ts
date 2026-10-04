import { runCommand } from 'citty'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { subCommands } from '../src/commands/index'
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
