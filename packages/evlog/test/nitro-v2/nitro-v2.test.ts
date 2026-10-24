import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest'
import {
  build,
  createDevServer,
  createNitro,
  prepare,
} from 'nitropack'
import { toNodeListener } from 'h3'
import { resolve } from 'pathe'

const rootDir = resolve(__dirname, './fixture')

/**
 * Regression suite for #374: the v2 error handler used h3 v1's `send()`, which
 * is a no-op once the event is marked handled, so thrown errors never flushed
 * the response and clients hung forever. Unlike the unit tests in
 * `test/nitro/errorHandler.test.ts` (which mock h3), this boots a real Nitro v2
 * dev server so the real h3 v1 / Node response semantics are exercised.
 */
describe.sequential('Nitro v2 server with evlog error handler', () => {
  let nitro: Awaited<ReturnType<typeof createNitro>>
  let devServer: ReturnType<typeof createDevServer>
  let server: Server
  let baseURL: string

  beforeAll(async () => {
    nitro = await createNitro({
      dev: true,
      rootDir,
    })
    devServer = createDevServer(nitro)
    // Bind our own ephemeral port instead of `devServer.listen()` so parallel
    // CI shards never race for listhen's default port.
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

  // A regression of #374 never flushes the response: the request would hang
  // until the test times out, so abort early with an explicit failure instead.
  async function fetchJson(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await fetch(new URL(path, baseURL), {
      signal: AbortSignal.timeout(8_000),
    }).catch((cause) => {
      throw new Error(`response for ${path} was never flushed (regression of #374)`, { cause })
    })
    return { status: res.status, body: await res.json() }
  }

  it('serves non-error routes', async () => {
    const { status, body } = await fetchJson('/works')

    expect(status).toBe(200)
    expect(body).toEqual({ success: true })
  }, 15_000)

  it('flushes thrown EvlogError as a serialized JSON response', async () => {
    const { status, body } = await fetchJson('/throws')

    expect(status).toBe(402)
    expect(body).toMatchObject({
      status: 402,
      message: 'Payment failed',
      url: '/throws',
      error: true,
      data: {
        why: 'Card declined by issuer (insufficient funds)',
        fix: 'Try a different payment method or contact your bank',
        link: 'https://docs.example.com/payments/declined',
      },
    })
    for (const key of ['statusCode', 'statusText', 'statusMessage']) expect(body).not.toHaveProperty(key)
  }, 15_000)

  it('preserves data and message from a deliberate h3 createError', async () => {
    const { status, body } = await fetchJson('/throws-h3-data')

    expect(status).toBe(500)
    expect(body).toMatchObject({
      status: 500,
      url: '/throws-h3-data',
      error: true,
      message: 'Payment provider rejected the charge',
      data: { orderId: 'ord_1', retryable: true },
    })
  }, 15_000)

  it('flushes plain thrown errors with Nitro-compatible JSON', async () => {
    const { status, body } = await fetchJson('/throws-plain')

    expect(status).toBe(500)
    expect(body).toMatchObject({
      status: 500,
      url: '/throws-plain',
      error: true,
      message: expect.any(String),
    })
    expect(body).not.toHaveProperty('data')
  }, 15_000)
  it('answers 500 for an EvlogError with no status', async () => {
    const { status, body } = await fetchJson('/throws-evlog-no-status')

    expect(status).toBe(500)
    expect(body).toMatchObject({
      status: 500,
      url: '/throws-evlog-no-status',
      error: true,
      message: expect.any(String),
    })
  }, 15_000)
})
