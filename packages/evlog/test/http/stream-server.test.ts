import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetStreamServerForTests, setDefaultStream, startStreamServer, type StreamServer } from '../../src/stream'
import type { WideEvent } from '../../src/types'
import { makeEvent } from '../helpers/events'
import { defined } from '../helpers/defined'

/** Status of a GET sent with raw headers: `fetch` refuses to set `Host`. */
function getStatus(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers }, (res) => {
      resolve(res.statusCode ?? 0)
      req.destroy()
    })
    req.on('error', reject)
    req.end()
  })
}

async function readSSE(url: string, durationMs: number, headers: Record<string, string> = {}): Promise<string[]> {
  const session = await openSSE(url, headers)
  return session.collectFor(durationMs)
}

/**
 * Open an SSE connection and split the lifecycle so callers can synchronize
 * on the `hello` frame instead of polling with `setTimeout`. Used by tests
 * that need to drain events only once subscribers are attached.
 */
async function openSSE(url: string, headers: Record<string, string> = {}): Promise<{
  helloReceived: Promise<void>
  collectFor: (durationMs: number) => Promise<string[]>
}> {
  const res = await fetch(url, { headers })
  expect(res.ok).toBe(true)
  const reader = defined(res.body, 'response body').getReader()
  const decoder = new TextDecoder()
  const frames: string[] = []
  let buffer = ''
  let helloResolve!: () => void
  let helloReject!: (err: Error) => void
  const helloReceived = new Promise<void>((resolve, reject) => {
    helloResolve = resolve
    helloReject = reject
  })

  let helloSeen = false
  let stopped = false

  function processBuffer() {
    let idx
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      frames.push(frame)
      if (helloSeen) continue
      const dataLine = frame.split('\n').find(l => l.startsWith('data:'))
      if (!dataLine) continue
      try {
        const env = JSON.parse(dataLine.slice(5).trim())
        if (env?.type === 'hello') {
          helloSeen = true
          helloResolve()
        }
      } catch {
        // skip malformed
      }
    }
  }

  const pump = (async () => {
    try {
      while (!stopped) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        processBuffer()
      }
    } catch {
      // reader cancelled — expected
    } finally {
      if (!helloSeen) helloReject(new Error('connection closed before hello'))
    }
  })()

  return {
    helloReceived,
    async collectFor(durationMs: number): Promise<string[]> {
      const timer = setTimeout(() => {
        stopped = true
        reader.cancel().catch(() => {})
      }, durationMs)
      try {
        await pump
      } finally {
        clearTimeout(timer)
      }
      return frames
    },
  }
}

function parseDataFrames(frames: string[]) {
  return frames
    .map((frame) => {
      const dataLine = frame.split('\n').find(l => l.startsWith('data:'))
      if (!dataLine) return null
      try {
        return JSON.parse(dataLine.slice(5).trim())
      } catch {
        return null
      }
    })
    .filter((p): p is { evlog: '1'; type: string; data: unknown } => p?.evlog === '1')
}

let server: StreamServer | null = null
let dir: string
let consoleInfoSpy: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  dir = await mkdtemp(join(tmpdir(), 'evlog-stream-server-'))
  setDefaultStream(null)
  resetStreamServerForTests()
})

afterEach(async () => {
  consoleInfoSpy.mockRestore()
  if (server) {
    await server.close()
    server = null
  }
  setDefaultStream(null)
  resetStreamServerForTests()
  await rm(dir, { recursive: true, force: true })
})

describe('startStreamServer', () => {
  it('boots an HTTP server bound to 127.0.0.1', async () => {
    server = await startStreamServer({ urlFileDir: dir, banner: false })
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(server.port).toBeGreaterThan(0)
  })

  it('writes the URL to <urlFileDir>/stream.url', async () => {
    server = await startStreamServer({ urlFileDir: dir, banner: false })
    const written = (await readFile(join(dir, 'stream.url'), 'utf-8')).trim()
    expect(written).toBe(server.url)
  })

  it('prints the banner unless banner: false', async () => {
    server = await startStreamServer({ urlFileDir: dir })
    expect(consoleInfoSpy).toHaveBeenCalledWith(expect.stringContaining('[evlog] Stream'))
  })

  it('returns the same instance on repeated calls (idempotent)', async () => {
    server = await startStreamServer({ urlFileDir: dir, banner: false })
    const again = await startStreamServer({ urlFileDir: dir, banner: false })
    expect(again).toBe(server)
  })

  it('emits a hello frame as the very first message', async () => {
    server = await startStreamServer({ urlFileDir: dir, banner: false, heartbeatMs: 60_000, buffer: 50 })

    const frames = await readSSE(server.url, 200)
    const parsed = parseDataFrames(frames)

    expect(parsed[0]).toMatchObject({ type: 'hello' })
    expect(defined(parsed[0], 'hello frame').data).toMatchObject({ bufferSize: 50, heartbeatMs: 60_000 })
  })

  it('forwards drained events as event frames', async () => {
    server = await startStreamServer({ urlFileDir: dir, banner: false, heartbeatMs: 60_000 })

    const session = await openSSE(server.url)
    await session.helloReceived
    await server.drain({ event: makeEvent(1) })
    await server.drain({ event: makeEvent(2) })

    const parsed = parseDataFrames(await session.collectFor(200))
    const events = parsed.filter(p => p.type === 'event')

    expect(events).toHaveLength(2)
    expect((defined(events[0], 'event 0').data as WideEvent).id).toBe(1)
    expect((defined(events[1], 'event 1').data as WideEvent).id).toBe(2)
  })

  it('replays buffered events when ?since is set', async () => {
    server = await startStreamServer({ urlFileDir: dir, banner: false, heartbeatMs: 60_000, buffer: 10 })

    await server.drain({ event: makeEvent(10, { timestamp: '2026-05-09T11:00:00.000Z' }) })
    await server.drain({ event: makeEvent(11, { timestamp: '2026-05-09T13:00:00.000Z' }) })

    const url = `${server.url}/?since=2026-05-09T12:00:00.000Z`
    const frames = await readSSE(url, 200)
    const parsed = parseDataFrames(frames)
    const replays = parsed.filter(p => p.type === 'replay')

    expect(replays).toHaveLength(1)
    expect((defined(replays[0], 'replay 0').data as WideEvent).id).toBe(11)
  })

  it('exposes /info with version and config', async () => {
    server = await startStreamServer({ urlFileDir: dir, banner: false, heartbeatMs: 7_000, buffer: 42 })

    const res = await fetch(`${server.url}/info`)
    const json = await res.json() as { evlogVersion: string; bufferSize: number; heartbeatMs: number }

    expect(json.bufferSize).toBe(42)
    expect(json.heartbeatMs).toBe(7_000)
    expect(json.evlogVersion).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('rejects requests with an invalid token (401)', async () => {
    server = await startStreamServer({ urlFileDir: dir, banner: false, token: 'secret-1' })

    const res = await fetch(server.url, {
      headers: { Authorization: 'Bearer wrong' },
    })
    expect(res.status).toBe(401)
  })

  it('accepts requests with the correct token', async () => {
    server = await startStreamServer({ urlFileDir: dir, banner: false, token: 'secret-1', heartbeatMs: 60_000 })

    const res = await fetch(server.url, {
      headers: { Authorization: 'Bearer secret-1' },
    })
    expect(res.status).toBe(200)
    res.body?.cancel()
  })

  it('accepts loopback origins without a token', async () => {
    server = await startStreamServer({ urlFileDir: dir, banner: false, heartbeatMs: 60_000 })

    for (const origin of ['http://localhost:3000', 'http://127.0.0.1:5173', 'http://[::1]:3000']) {
      expect(await getStatus(server.url, { origin }), origin).toBe(200)
    }
  })

  it('rejects origins that only start with a loopback name', async () => {
    server = await startStreamServer({ urlFileDir: dir, banner: false, heartbeatMs: 60_000 })

    for (const origin of ['https://localhost.evil.com', 'https://127.0.0.1.evil.com', 'https://evil.com']) {
      expect(await getStatus(server.url, { origin }), origin).toBe(403)
    }
  })

  it('rejects a non-loopback Host without a token, as a DNS-rebound page sends', async () => {
    server = await startStreamServer({ urlFileDir: dir, banner: false, heartbeatMs: 60_000 })
    const { port } = server

    expect(await getStatus(server.url, { host: `rebind.evil.com:${port}` })).toBe(403)
    expect(await getStatus(server.url, { host: `localhost:${port}` })).toBe(200)
  })

  it('accepts any Host when the bearer token matches', async () => {
    server = await startStreamServer({ urlFileDir: dir, banner: false, token: 'secret-1', heartbeatMs: 60_000 })

    expect(await getStatus(server.url, { host: 'stream.internal:4317', authorization: 'Bearer secret-1' })).toBe(200)
  })

  it('removes stream.url and frees the port on close()', async () => {
    server = await startStreamServer({ urlFileDir: dir, banner: false })
    const filePath = join(dir, 'stream.url')

    await server.close()
    server = null

    await expect(readFile(filePath, 'utf-8')).rejects.toThrow()
  })

  it('forbids non-OPTIONS, non-GET methods', async () => {
    server = await startStreamServer({ urlFileDir: dir, banner: false })

    const res = await fetch(server.url, { method: 'POST' })
    expect(res.status).toBe(405)
  })

  it('returns 404 for non-SSE paths so health probes do not get 200', async () => {
    server = await startStreamServer({ urlFileDir: dir, banner: false })

    const res = await fetch(`${server.url}/eve/v1/health`)
    expect(res.status).toBe(404)
  })

  it('handles CORS preflight (OPTIONS)', async () => {
    server = await startStreamServer({ urlFileDir: dir, banner: false })

    const res = await fetch(server.url, { method: 'OPTIONS' })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
})
