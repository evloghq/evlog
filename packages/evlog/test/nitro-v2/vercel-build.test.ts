import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { build, createNitro, prepare } from 'nitropack'
import { resolve } from 'pathe'
import evlog from '../../src/nitro/module'
import type { VercelFixtureState } from './vercel-fixture/plugins/store'

interface VercelRequestContext {
  waitUntil: (promise: Promise<unknown>) => void
}

/**
 * The shape the Vercel Functions runtime gives a Node function: a request
 * context in AsyncLocalStorage, read through `globalThis[Symbol.for('@vercel/request-context')]`.
 * The Nitro v2 `vercel` preset passes no `waitUntil` to the h3 event.
 */
const requestContext = new AsyncLocalStorage<VercelRequestContext>()
const VERCEL_REQUEST_CONTEXT = Symbol.for('@vercel/request-context')

function state(): VercelFixtureState {
  return (globalThis as { __evlogVercelFixture?: VercelFixtureState }).__evlogVercelFixture as VercelFixtureState
}

// Shelve's deployment: Nitro 2.13 with the `vercel` preset.
describe.sequential('Nitro v2 vercel preset', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'evlog-nitro-vercel-'))
  const registered: Promise<unknown>[] = []
  let server: Server
  let baseURL: string

  beforeAll(async () => {
    vi.stubEnv('VERCEL', '1')
    ;(globalThis as Record<symbol, unknown>)[VERCEL_REQUEST_CONTEXT] = { get: () => requestContext.getStore() }
    const nitro = await createNitro({
      dev: false,
      preset: 'vercel',
      rootDir: resolve(__dirname, './vercel-fixture'),
      output: { dir: outDir },
      modules: [evlog({ silent: true, redact: true })],
    })
    await prepare(nitro)
    await build(nitro)
    await nitro.close()

    const fn = await import(pathToFileURL(join(outDir, 'functions/__fallback.func/index.mjs')).href)
    const handler = fn.default as (req: IncomingMessage, res: ServerResponse) => void
    server = createServer((req, res) => requestContext.run({ waitUntil: promise => registered.push(promise) }, () => handler(req, res)))
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
    baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  }, 120_000)

  afterAll(async () => {
    await new Promise<void>(done => server?.close(() => done()))
    delete (globalThis as Record<symbol, unknown>)[VERCEL_REQUEST_CONTEXT]
    vi.unstubAllEnvs()
    rmSync(outDir, { recursive: true, force: true })
  })

  async function get(path: string, requestId: string): Promise<{ stored: string[] }> {
    const res = await fetch(new URL(path, baseURL), {
      headers: { 'x-request-id': requestId, 'x-forwarded-for': '203.0.113.9', 'user-agent': 'shelve-cli/1' },
    })
    expect(res.status).toBe(200)
    return await res.json() as { stored: string[] }
  }

  it('stores an awaited audit before the response, with the identities the store keeps', async () => {
    const body = await get('/api/awaited', 'req_awaited')

    expect(body.stored).toEqual(['token.create'])
    expect(state().audits[0]).toMatchObject({
      action: 'token.create',
      tenantId: 'team_7',
      actor: { onBehalfOf: { email: 'alice@acme.com' } },
      context: { requestId: 'req_awaited', ip: '203.0.113.9', userAgent: 'shelve-cli/1' },
    })
  })

  it('stores an unawaited audit after the response, kept alive by the Vercel waitUntil', async () => {
    let open!: () => void
    state().gate = new Promise((resolve) => {
      open = resolve
    })
    registered.length = 0

    const body = await get('/api/background', 'req_background')
    expect(body.stored).toEqual(['token.create'])

    // The audit and the request event are both handed to waitUntil, and the audit waits on the store.
    const requestEvent = await vi.waitFor(() => {
      const found = state().requests.find(e => e.requestId === 'req_background')
      expect(found).toBeDefined()
      return found
    })
    expect(requestEvent).toMatchObject({ path: '/api/background', status: 200 })
    expect(requestEvent?.audit).toBeUndefined()
    expect(registered.length).toBeGreaterThanOrEqual(2)
    expect(state().audits.map(r => r.action)).toEqual(['token.create'])

    open()
    await Promise.all(registered)
    expect(state().audits.map(r => r.action)).toEqual(['token.create', 'variables.read'])
    expect(state().audits[1]).toMatchObject({
      actor: { email: 'alice@acme.com' },
      context: { requestId: 'req_background', ip: '203.0.113.9' },
    })
  })
})
