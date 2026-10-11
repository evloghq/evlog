import { createApp, toWebHandler } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initLogger } from '../../src/logger'

const callHook = vi.fn().mockResolvedValue(undefined)

vi.mock('nitropack/runtime', () => ({
  useNitroApp: () => ({ hooks: { callHook } }),
}))

const { default: ingest } = await import('../../src/runtime/server/routes/_evlog/ingest.post')

const app = createApp()
app.use('/api/_evlog/ingest', ingest)
const handler = toWebHandler(app)

function send(level: string, message: string) {
  return handler(new Request('http://localhost/api/_evlog/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'origin': 'http://localhost' },
    body: JSON.stringify({ timestamp: new Date().toISOString(), level, message }),
  }))
}

describe('client ingest stdout output', () => {
  let info: ReturnType<typeof vi.spyOn>
  let error: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    callHook.mockClear()
    info = vi.spyOn(console, 'info').mockImplementation(() => {})
    error = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prints a client event to stdout when no drain is configured', async () => {
    initLogger({ pretty: false, stringify: false })

    const res = await send('info', 'client hello')

    expect(res.status).toBe(204)
    expect(info).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0][0]).toMatchObject({ level: 'info', message: 'client hello', source: 'client' })
  })

  it('prints a client error to stdout through the error console method', async () => {
    initLogger({ pretty: false, stringify: false })

    await send('error', 'client boom')

    expect(error).toHaveBeenCalledTimes(1)
    expect(error.mock.calls[0][0]).toMatchObject({ level: 'error', message: 'client boom', source: 'client' })
  })

  it('prints a client event and still runs the drain hook', async () => {
    initLogger({ pretty: false, stringify: false })

    await send('info', 'both')

    expect(info).toHaveBeenCalledTimes(1)
    expect(callHook.mock.calls.filter(([name]) => name === 'evlog:drain')).toHaveLength(1)
  })

  it('redacts a client event before stdout, enrichers and drains', async () => {
    initLogger({ pretty: false, stringify: false, redact: true })

    await handler(new Request('http://localhost/api/_evlog/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'origin': 'http://localhost' },
      body: JSON.stringify({ timestamp: new Date().toISOString(), level: 'info', message: 'checkout', user: { email: 'jane@example.com' }, card: '4242 4242 4242 4242' }),
    }))

    const [[printed]] = info.mock.calls
    expect(printed).toMatchObject({ user: { email: 'j***@***.com' }, card: '****4242' })
    for (const name of ['evlog:enrich', 'evlog:drain']) {
      const ctx = callHook.mock.calls.find(([hook]) => hook === name)?.[1] as { event: Record<string, unknown> }
      expect(ctx.event).toMatchObject({ user: { email: 'j***@***.com' }, card: '****4242' })
    }
  })

  it('does not print when the logger is silent', async () => {
    initLogger({ pretty: false, stringify: false, silent: true })

    await send('info', 'quiet')

    expect(info).not.toHaveBeenCalled()
  })
})
