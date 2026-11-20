import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const packageRoot = fileURLToPath(new URL('../..', import.meta.url))
const child = fileURLToPath(new URL('../fixtures/shutdown/child.ts', import.meta.url))

describe('pipeline shutdown flush', () => {
  let server: Server
  let batches: Array<Array<{ id: number }>>
  let proc: ChildProcess | undefined

  beforeEach(async () => {
    batches = []
    server = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        batches.push(JSON.parse(body))
        res.end()
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  })

  afterEach(async () => {
    proc?.kill('SIGKILL')
    await new Promise(resolve => server.close(resolve))
  })

  async function start(mode: string): Promise<{ proc: ChildProcess, exit: Promise<{ code: number | null, signal: NodeJS.Signals | null }>, output: () => string }> {
    let output = ''
    proc = spawn(process.execPath, ['--import', 'tsx', child], { cwd: packageRoot, env: { ...process.env, PORT: String((server.address() as AddressInfo).port), MODE: mode } })
    const exit = new Promise<{ code: number | null, signal: NodeJS.Signals | null }>((resolve) => {
      proc!.on('exit', (code, signal) => resolve({ code, signal }))
    })
    await new Promise<void>((resolve) => {
      proc!.stdout!.on('data', (chunk) => {
        output += chunk
        if (output.includes('ready')) resolve()
      })
    })
    return { proc, exit, output: () => output }
  }

  it.each(['SIGTERM', 'SIGINT'] as const)('delivers 20 of 20 buffered events on %s, then exits by the signal', async (signal) => {
    const { proc, exit } = await start('signal')

    proc.kill(signal)

    expect(await exit).toEqual({ code: null, signal })
    expect(batches.flat().map(event => event.id)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
    expect(batches).toHaveLength(1)
  })

  it('delivers buffered events when the process runs out of work', async () => {
    const { exit } = await start('natural')

    expect(await exit).toEqual({ code: 0, signal: null })
    expect(batches.flat()).toHaveLength(20)
  })

  it('exits on a signal right away when no pipeline holds events', async () => {
    const { proc, exit } = await start('idle')

    proc.kill('SIGTERM')

    expect(await exit).toEqual({ code: null, signal: 'SIGTERM' })
    expect(batches).toHaveLength(0)
  })

  it('flushes but leaves the exit to an app that handles the signal itself', async () => {
    const { proc, exit, output } = await start('own-handler')

    proc.kill('SIGTERM')
    const outcome = await Promise.race([exit, new Promise(resolve => setTimeout(() => resolve('alive'), 1_500))])

    expect(outcome).toBe('alive')
    expect(output()).toContain('own handler')
    expect(batches.flat()).toHaveLength(20)
  })
}, 20_000)
