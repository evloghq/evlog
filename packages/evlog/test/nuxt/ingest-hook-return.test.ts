import { createApp, toWebHandler } from 'h3'
import { createHooks } from 'hookable'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DrainContext } from '../../src/types'
import { initLogger } from '../../src/logger'

const mockHooks = createHooks()

vi.mock('nitropack/runtime', () => ({
  useNitroApp: () => ({ hooks: mockHooks }),
}))

const { default: ingest } = await import('../../src/runtime/server/routes/_evlog/ingest.post')

const app = createApp()
app.use('/api/_evlog/ingest', ingest)
const handler = toWebHandler(app)

function send() {
  return handler(new Request('http://localhost/api/_evlog/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'origin': 'http://localhost' },
    body: JSON.stringify({ timestamp: new Date().toISOString(), level: 'info', message: 'client hello' }),
  }))
}

describe('client ingest with a real hookable (callHook may return undefined)', () => {
  beforeEach(() => {
    initLogger({ pretty: false, stringify: false })
    vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    mockHooks.removeAllHooks()
    vi.restoreAllMocks()
  })

  it('returns 204 when no evlog:drain hook is registered', async () => {
    const res = await send()

    expect(res.status).toBe(204)
  })

  it('runs a synchronous evlog:drain hook and returns 204', async () => {
    const drained: DrainContext[] = []
    mockHooks.hook('evlog:drain', (ctx: DrainContext) => {
      drained.push(ctx)
    })

    const res = await send()

    expect(res.status).toBe(204)
    expect(drained).toHaveLength(1)
  })
})
