import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build, createDevServer, createNitro, prepare } from 'nitropack'
import { toNodeListener } from 'h3'
import { resolve } from 'pathe'
import evlog from '../../src/nitro/module'

const rootDir = resolve(__dirname, './config-fixture')
const out = join(mkdtempSync(join(tmpdir(), 'evlog-config-file-')), 'events.ndjson')

async function readDrained(): Promise<Record<string, unknown>[]> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (existsSync(out)) {
      const lines = readFileSync(out, 'utf8').trim().split('\n').filter(Boolean)
      if (lines.length > 0) return lines.map(line => JSON.parse(line) as Record<string, unknown>)
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`no event was drained to ${out}`)
}

/**
 * Boots a real Nitro v2 dev server whose root holds an `evlog.config.ts`, so
 * the module's virtual plugin, the bundled import of the file and the global
 * hand-off to the evlog plugin are all exercised as an app would run them.
 */
describe.sequential('Nitro v2 app with an evlog.config.ts', () => {
  let nitro: Awaited<ReturnType<typeof createNitro>>
  let devServer: ReturnType<typeof createDevServer>
  let server: Server
  let baseURL: string

  beforeAll(async () => {
    process.env.EVLOG_CONFIG_FIXTURE_OUT = out
    // Passed here rather than imported by nitro.config.ts: c12 would load the
    // module through jiti, and that second copy of src breaks v8 coverage.
    nitro = await createNitro({
      dev: true,
      rootDir,
      modules: [evlog({ env: { environment: 'from-module' }, silent: true })],
    })
    devServer = createDevServer(nitro)
    server = createServer(toNodeListener(devServer.app))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    await prepare(nitro)
    const ready = new Promise<void>((resolve) => {
      nitro.hooks.hook('dev:reload', () => resolve())
    })
    await build(nitro)
    await ready
  }, 120_000)

  afterAll(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
    await devServer?.close()
    await nitro?.close()
  })

  it('registers the file as the first server plugin', () => {
    expect(nitro.options.plugins[0]).toBe('#evlog/config')
    expect(nitro.options.virtual['#evlog/config']).toContain(join(rootDir, 'evlog.config.ts'))
  })

  it('runs the drain and enrich of the file, with the module options layered on top', async () => {
    const res = await fetch(new URL('/works', baseURL), { signal: AbortSignal.timeout(8_000) })
    expect(res.status).toBe(200)

    const [event] = await readDrained()
    expect(event).toMatchObject({
      service: 'from-config-file',
      environment: 'from-module',
      enrichedBy: 'evlog.config.ts',
      method: 'GET',
      path: '/works',
    })
  }, 15_000)
})
