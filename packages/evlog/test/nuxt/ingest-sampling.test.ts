import { createApp, toWebHandler } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initLogger } from '../../src/logger'
import type { SamplingConfig } from '../../src/types'

const callHook = vi.fn().mockResolvedValue(undefined)

vi.mock('nitropack/runtime', () => ({
  useNitroApp: () => ({ hooks: { callHook } }),
}))

const { default: ingest } = await import('../../src/runtime/server/routes/_evlog/ingest.post')

const app = createApp()
app.use('/api/_evlog/ingest', ingest)
const handler = toWebHandler(app)

function send(level: string) {
  return handler(new Request('http://localhost/api/_evlog/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'origin': 'http://localhost' },
    body: JSON.stringify({ timestamp: new Date().toISOString(), level, message: 'hi' }),
  }))
}

function drainCalls() {
  return callHook.mock.calls.filter(([name]) => name === 'evlog:drain')
}

describe('client ingest sampling', () => {
  beforeEach(() => {
    callHook.mockClear()
  })

  function withRates(rates: SamplingConfig['rates']) {
    initLogger({ pretty: false, sampling: { rates } })
  }

  it('drains client events when no sampling is configured', async () => {
    initLogger({ pretty: false })

    const res = await send('info')

    expect(res.status).toBe(204)
    expect(drainCalls()).toHaveLength(1)
  })

  it('drops client events sampled out by sampling.rates', async () => {
    withRates({ info: 0 })

    const res = await send('info')

    expect(res.status).toBe(204)
    expect(callHook).not.toHaveBeenCalled()
  })

  it('keeps levels the rates keep', async () => {
    withRates({ info: 0, warn: 100 })

    await send('warn')
    await send('error')

    expect(drainCalls()).toHaveLength(2)
  })

  it('always keeps fatal', async () => {
    withRates({ info: 0, warn: 0, error: 0, debug: 0 })

    await send('fatal')

    expect(drainCalls()).toHaveLength(1)
  })
})
