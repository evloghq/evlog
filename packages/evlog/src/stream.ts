/**
 * In-process event stream — the foundation for any local consumer (devtools,
 * dashboards, CLIs, SSE/WebSocket bridges) to observe events flowing through
 * the drain pipeline without re-implementing one.
 *
 * @example
 * ```ts
 * import { createStreamDrain } from 'evlog/stream'
 *
 * const stream = createStreamDrain({ buffer: 200 })
 * nitroApp.hooks.hook('evlog:drain', stream.drain)
 *
 * stream.subscribe((event) => {
 *   if (event.level === 'error') notifyOps(event)
 * })
 *
 * for await (const event of stream.events()) {
 *   console.log(event.timestamp, event.action ?? event.message)
 * }
 * ```
 */

import type { DrainContext, WideEvent } from './types'
import { EVLOG_VERSION } from './shared/http'
import { isLoopbackUrl } from './shared/loopback'

/** Configuration accepted by {@link createStreamDrain}. */
export interface StreamDrainOptions {
  /**
   * Number of recent events kept in the ring buffer and replayed to new
   * subscribers via {@link StreamDrain.recent}. Set to `0` to disable
   * replay.
   * @default 500
   */
  buffer?: number
  /**
   * Optional predicate run on each drained event — return `false` to skip
   * the event entirely (it is neither buffered nor delivered).
   */
  filter?: (event: WideEvent) => boolean
  /**
   * Per-subscriber queue size for the {@link StreamDrain.events} async
   * iterator. When the consumer falls behind by more than this many events,
   * the oldest queued events are dropped — the drain is never blocked.
   * @default 1000
   */
  perSubscriberQueue?: number
}

/** Live drain that exposes its events to in-process subscribers. */
export interface StreamDrain {
  /**
   * Drain callback. Pass to `nitroApp.hooks.hook('evlog:drain', stream.drain)`
   * or to a plugin via `drainPlugin('stream', stream.drain)`.
   */
  drain: (ctx: DrainContext | DrainContext[]) => Promise<void>
  /**
   * Register a synchronous listener. Errors thrown by the listener are
   * caught and logged — they never affect other subscribers or the drain.
   * @returns Unsubscribe function.
   */
  subscribe: (listener: (event: WideEvent) => void) => () => void
  /**
   * Async iterator over live events. Each call returns a fresh iterator —
   * past events from the ring buffer are NOT replayed. Combine with
   * {@link StreamDrain.recent} to seed history.
   *
   * Calling `return()` (e.g. via `break`) cleanly unsubscribes.
   */
  events: () => AsyncIterableIterator<WideEvent>
  /**
   * Snapshot of buffered events (oldest first, most recent last). Useful
   * to seed a new connection / UI panel before switching to live updates.
   */
  recent: () => readonly WideEvent[]
  /** Number of currently active subscribers (sync + async iterators). */
  readonly subscriberCount: number
  /** Number of events dropped because the buffer was disabled or wrapped. */
  readonly droppedCount: number
  /**
   * Disconnect all subscribers and end any pending async iterators. The
   * stream itself remains usable — new subscriptions still work.
   */
  close: () => void
}

const DEFAULT_BUFFER = 500
const DEFAULT_QUEUE = 1000

interface AsyncSubscriber {
  push: (event: WideEvent) => void
  end: () => void
}

/**
 * Create an in-process {@link StreamDrain}. Multiple stream drains can
 * coexist in the same process — they are fully independent.
 */
export function createStreamDrain(options: StreamDrainOptions = {}): StreamDrain {
  const bufferSize = Math.max(0, Math.floor(options.buffer ?? DEFAULT_BUFFER))
  const queueLimit = Math.max(1, Math.floor(options.perSubscriberQueue ?? DEFAULT_QUEUE))
  const { filter } = options

  const buffer: WideEvent[] = []
  const syncListeners = new Set<(event: WideEvent) => void>()
  const asyncSubscribers = new Set<AsyncSubscriber>()
  let dropped = 0

  function publish(event: WideEvent): void {
    if (filter && !filter(event)) return

    if (bufferSize > 0) {
      buffer.push(event)
      while (buffer.length > bufferSize) {
        buffer.shift()
        dropped++
      }
    }

    for (const listener of syncListeners) {
      try {
        listener(event)
      } catch (err) {
        console.error('[evlog/stream] subscriber threw:', err)
      }
    }

    for (const sub of asyncSubscribers) {
      sub.push(event)
    }
  }

  const drain: StreamDrain['drain'] = (ctx) => {
    const contexts = Array.isArray(ctx) ? ctx : [ctx]
    for (const c of contexts) {
      if (c?.event) publish(c.event)
    }
    return Promise.resolve()
  }

  const subscribe: StreamDrain['subscribe'] = (listener) => {
    syncListeners.add(listener)
    return () => {
      syncListeners.delete(listener)
    }
  }

  function createAsyncIterator(): AsyncIterableIterator<WideEvent> {
    const queue: WideEvent[] = []
    let pendingResolve: ((result: IteratorResult<WideEvent>) => void) | null = null
    let closed = false

    const subscriber: AsyncSubscriber = {
      push(event) {
        if (closed) return
        if (pendingResolve) {
          const resolve = pendingResolve
          pendingResolve = null
          resolve({ value: event, done: false })
          return
        }
        queue.push(event)
        while (queue.length > queueLimit) {
          queue.shift()
          dropped++
        }
      },
      end() {
        if (closed) return
        closed = true
        if (pendingResolve) {
          const resolve = pendingResolve
          pendingResolve = null
          resolve({ value: undefined, done: true })
        }
      },
    }

    asyncSubscribers.add(subscriber)

    const iterator: AsyncIterableIterator<WideEvent> = {
      [Symbol.asyncIterator]() {
        return iterator
      },
      next(): Promise<IteratorResult<WideEvent>> {
        if (queue.length > 0) {
          return Promise.resolve({ value: queue.shift()!, done: false })
        }
        if (closed) {
          return Promise.resolve({ value: undefined, done: true })
        }
        return new Promise((resolve) => {
          pendingResolve = resolve
        })
      },
      return(): Promise<IteratorResult<WideEvent>> {
        closed = true
        asyncSubscribers.delete(subscriber)
        if (pendingResolve) {
          const resolve = pendingResolve
          pendingResolve = null
          resolve({ value: undefined, done: true })
        }
        return Promise.resolve({ value: undefined, done: true })
      },
    }

    return iterator
  }

  return {
    drain,
    subscribe,
    events: createAsyncIterator,
    recent: () => buffer.slice(),
    get subscriberCount() {
      return syncListeners.size + asyncSubscribers.size
    },
    get droppedCount() {
      return dropped
    },
    close() {
      syncListeners.clear()
      for (const sub of asyncSubscribers) {
        sub.end()
      }
      asyncSubscribers.clear()
    },
  }
}

let defaultStream: StreamDrain | null = null

/**
 * Lazily create / return the process-wide default {@link StreamDrain}.
 *
 * Used by built-in framework integrations (Nuxt SSE bridge, devtools panel)
 * so they share a single buffer. Custom code can subscribe to this stream
 * to observe everything draining through evlog without registering a new
 * drain.
 *
 * @example
 * ```ts
 * import { getDefaultStream } from 'evlog/stream'
 *
 * getDefaultStream().subscribe((event) => console.log(event.action))
 * ```
 */
export function getDefaultStream(options?: StreamDrainOptions): StreamDrain {
  if (!defaultStream) defaultStream = createStreamDrain(options)
  return defaultStream
}

/**
 * Replace or clear the default stream. Pass `null` to reset (mostly useful
 * in tests).
 */
export function setDefaultStream(stream: StreamDrain | null): void {
  defaultStream?.close()
  defaultStream = stream
}

/** Configuration accepted by {@link startStreamServer}. */
export interface StreamServerOptions {
  /**
   * TCP port to listen on. `0` (default) lets the OS pick an ephemeral port —
   * the actual port is exposed on the returned `port` / `url` and printed in
   * the startup banner.
   * @default 0
   */
  port?: number
  /**
   * Listen address. Default `127.0.0.1` — local-only, never exposed to the
   * LAN. Override to `0.0.0.0` only if you understand the security
   * implications.
   * @default '127.0.0.1'
   */
  host?: string
  /**
   * Bearer token. When set, the server requires `Authorization: Bearer
   * <token>` on every request and 401s otherwise. When unset, a request is
   * accepted only when its `Host` is `localhost`, `127.0.0.1` or `[::1]`
   * and its `Origin`, if any, names one of those hosts. Others get 403.
   */
  token?: string
  /**
   * Heartbeat interval (ms) sent as `event: ping` to keep the connection
   * alive through proxies and detect disconnects.
   * @default 15000
   */
  heartbeatMs?: number
  /**
   * Ring buffer size kept on the underlying default stream — replayed for
   * late-joining clients via `?since=<iso>`.
   * @default 500
   */
  buffer?: number
  /**
   * Print `[evlog] Stream → http://...` at startup.
   * @default true
   */
  banner?: boolean
  /**
   * Directory where `stream.url` is written so external tools can discover
   * the server. Set to `false` to disable.
   * @default '.evlog'
   */
  urlFileDir?: string | false
}

/** Return value of {@link startStreamServer}. */
export interface StreamServer {
  /** Listening URL, e.g. `http://127.0.0.1:51203`. */
  readonly url: string
  /** Resolved TCP port (useful when `port: 0`). */
  readonly port: number
  /**
   * Drain function — register on `evlog:drain` (Nitro / Nuxt), pass to
   * `initLogger({ drain })` (Next / standalone), or call directly.
   *
   * Equivalent to the underlying default stream's drain — events flow
   * through and reach every connected SSE client.
   */
  readonly drain: (ctx: DrainContext | DrainContext[]) => Promise<void>
  /** The underlying in-process {@link StreamDrain}. */
  readonly stream: StreamDrain
  /** Stop the server, remove the URL file, and unsubscribe all clients. */
  close: () => Promise<void>
}

const STREAM_DEFAULTS = {
  port: 0,
  host: '127.0.0.1',
  heartbeatMs: 15_000,
  buffer: 500,
  banner: true,
  urlFileDir: '.evlog' as string | false,
}

let activeStreamServer: StreamServer | null = null


/**
 * Start a local HTTP server that exposes the default in-process stream over
 * Server-Sent Events. Framework-agnostic: works in any Node / Bun process
 * (Nuxt, Next.js, Hono, Express, Fastify, raw scripts).
 *
 * The server binds to `127.0.0.1` on an ephemeral port by default — local
 * tools and browser tabs from the same machine can connect, but the LAN
 * cannot reach it.
 *
 * Idempotent: subsequent calls return the same instance until `close()` is
 * called.
 *
 * @example
 * ```ts
 * import { startStreamServer } from 'evlog/stream'
 *
 * const server = await startStreamServer()
 * console.log(server.url) // → http://127.0.0.1:51203
 *
 * // Hook into your drain pipeline (Nitro example):
 * nitroApp.hooks.hook('evlog:drain', server.drain)
 *
 * // Or for a standalone script with initLogger:
 * initLogger({ drain: server.drain })
 * ```
 */
export async function startStreamServer(options: StreamServerOptions = {}): Promise<StreamServer> {
  if (activeStreamServer) return activeStreamServer

  const opts = { ...STREAM_DEFAULTS, ...options }
  const stream = getDefaultStream({ buffer: opts.buffer })

  const { createServer } = await import('node:http')
  const { writeFile, unlink, mkdir } = await import('node:fs/promises')
  const { unlinkSync } = await import('node:fs')
  const { join } = await import('node:path')

  function envelopeFrame(type: 'event' | 'replay' | 'hello', data: unknown): string {
    return `data: ${JSON.stringify({ evlog: '1', type, data })}\n\n`
  }

  function writeCors(res: import('node:http').ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Accept')
  }

  const server = createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      writeCors(res)
      res.writeHead(204)
      res.end()
      return
    }

    if (req.method !== 'GET') {
      res.writeHead(405)
      res.end('method not allowed')
      return
    }

    if (opts.token) {
      if (req.headers.authorization !== `Bearer ${opts.token}`) {
        writeCors(res)
        res.writeHead(401)
        res.end('unauthorized')
        return
      }
    } else {
      // A page whose domain was rebound to 127.0.0.1 sends no Origin on a same-origin GET, so its Host is checked too.
      const { origin, host } = req.headers
      if (!isLoopbackUrl(`http://${host ?? ''}`) || (origin !== undefined && !isLoopbackUrl(origin))) {
        writeCors(res)
        res.writeHead(403)
        res.end('forbidden')
        return
      }
    }

    const url = new URL(req.url ?? '/', 'http://localhost')

    if (url.pathname === '/info') {
      writeCors(res)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        evlogVersion: EVLOG_VERSION,
        bufferSize: opts.buffer,
        heartbeatMs: opts.heartbeatMs,
      }))
      return
    }

    // Only the root path is SSE — stray GETs (e.g. health probes) must not
    // return 200 or tooling that scans stdout for loopback URLs can mis-detect
    // this server as something else (eve/next dev proxy is one real case).
    if (url.pathname !== '/' && url.pathname !== '') {
      writeCors(res)
      res.writeHead(404)
      res.end('not found')
      return
    }

    writeCors(res)
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Evlog-Version': EVLOG_VERSION,
    })

    res.write(envelopeFrame('hello', {
      evlogVersion: EVLOG_VERSION,
      bufferSize: opts.buffer,
      heartbeatMs: opts.heartbeatMs,
    }))

    const since = url.searchParams.get('since')
    const sinceMs = since ? Date.parse(since) : Number.NaN
    if (Number.isFinite(sinceMs)) {
      for (const past of stream.recent()) {
        const ts = typeof past.timestamp === 'string' ? Date.parse(past.timestamp) : Number.NaN
        if (Number.isFinite(ts) && ts >= sinceMs) {
          res.write(envelopeFrame('replay', past))
        }
      }
    }

    let closed = false
    const unsubscribe = stream.subscribe((event) => {
      if (closed) return
      res.write(envelopeFrame('event', event))
    })

    const heartbeat = setInterval(() => {
      if (closed) return
      res.write(`event: ping\ndata: ${JSON.stringify({ evlog: '1', type: 'ping', data: { t: Date.now() } })}\n\n`)
    }, opts.heartbeatMs)

    const cleanup = () => {
      if (closed) return
      closed = true
      clearInterval(heartbeat)
      unsubscribe()
      try {
        res.end()
      } catch {
        // noop
      }
    }

    req.on('close', cleanup)
    req.on('error', cleanup)
    res.on('close', cleanup)
    res.on('error', cleanup)
  })

  const port: number = await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port, opts.host, () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') {
        resolve(addr.port)
      } else {
        reject(new Error('[evlog/stream] failed to determine listening port'))
      }
    })
  })

  const url = `http://${opts.host}:${port}`

  let urlFile: string | undefined
  if (opts.urlFileDir !== false) {
    try {
      await mkdir(opts.urlFileDir, { recursive: true })
      urlFile = join(opts.urlFileDir, 'stream.url')
      await writeFile(urlFile, url, 'utf-8')
    } catch (err) {
      console.warn('[evlog/stream] failed to write stream.url:', err)
    }
  }

  if (opts.banner) {
    console.info(`\n  [evlog] Stream → ${url}\n`)
  }

  const exitHandler = () => {
    if (urlFile) {
      try {
        unlinkSync(urlFile)
      } catch {
        // noop
      }
    }
    server.close()
  }
  process.once('SIGINT', exitHandler)
  process.once('SIGTERM', exitHandler)
  process.once('exit', exitHandler)

  const close = async (): Promise<void> => {
    process.off('SIGINT', exitHandler)
    process.off('SIGTERM', exitHandler)
    process.off('exit', exitHandler)
    if (urlFile) {
      try {
        await unlink(urlFile)
      } catch {
        // noop
      }
    }
    await new Promise<void>((resolve, reject) => {
      server.close(err => err ? reject(err) : resolve())
    })
    if (activeStreamServer === result) activeStreamServer = null
  }

  const result: StreamServer = {
    url,
    port,
    drain: ctx => stream.drain(ctx),
    stream,
    close,
  }

  activeStreamServer = result
  return result
}

/** @internal Used by tests to reset state between specs. */
export function resetStreamServerForTests(): void {
  activeStreamServer = null
}
