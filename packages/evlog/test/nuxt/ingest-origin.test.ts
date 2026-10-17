import { createApp, toWebHandler } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initLogger } from '../../src/logger'

vi.mock('nitropack/runtime', () => ({
  useNitroApp: () => ({ hooks: { callHook: vi.fn().mockResolvedValue(undefined) } }),
}))

const { default: ingest } = await import('../../src/runtime/server/routes/_evlog/ingest.post')

const app = createApp()
app.use('/api/_evlog/ingest', ingest)
const handler = toWebHandler(app)

function send(headers: Record<string, string>) {
  return handler(new Request('http://localhost/api/_evlog/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ timestamp: new Date().toISOString(), level: 'info', message: 'hi' }),
  }))
}

describe('client ingest origin check', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    initLogger({ pretty: false })
  })

  it('accepts a same-host origin or referer', async () => {
    expect((await send({ origin: 'http://localhost' })).status).toBe(204)
    expect((await send({ referer: 'http://localhost/page' })).status).toBe(204)
  })

  it('answers 403 to a missing, foreign or malformed origin', async () => {
    const cases: Record<string, string>[] = [
      {},
      { origin: 'https://evil.com' },
      { origin: 'null' },
      { referer: 'not a url' },
    ]
    for (const headers of cases) {
      expect((await send(headers)).status, JSON.stringify(headers)).toBe(403)
    }
  })
})
