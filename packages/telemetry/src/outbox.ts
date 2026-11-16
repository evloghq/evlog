import { appendFile, mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RunEvent } from './types'
import { getTelemetryDir } from './paths'

export interface OutboxOptions {
  /** Tool name used to resolve the config directory. */
  toolName: string
  /** Max outbox file size in bytes before oldest events are dropped. Default: 1 MiB. */
  maxBufferBytes?: number
  /** Max age in milliseconds for buffered events. Default: 30 days. */
  maxEventAgeMs?: number
  /** Max age of `outbox.lock` before it is treated as stale. Default: 30s. */
  lockStaleMs?: number
}

interface StoredEvent {
  event: RunEvent
  storedAt: number
}

interface LockMetadata {
  pid: number
  acquiredAt: number
}

const DEFAULT_MAX_BYTES = 1024 * 1024
const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_LOCK_STALE_MS = 30_000
const LOCK_RETRIES = 5
const LOCK_RETRY_DELAY_MS = 25

function isEexist(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as NodeJS.ErrnoException).code === 'EEXIST'
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    const t = setTimeout(resolve, ms)
    ;(t as { unref?: () => void }).unref?.()
  })
}

/** Disk-buffered NDJSON outbox — lockfile serialises all mutating operations. */
export class TelemetryOutbox {
  private readonly dir: string
  private readonly outboxPath: string
  private readonly lastFlushPath: string
  private readonly lockPath: string
  private readonly maxBytes: number
  private readonly maxAgeMs: number
  private readonly lockStaleMs: number
  private lockChain: Promise<void> = Promise.resolve()

  constructor(opts: OutboxOptions) {
    this.dir = getTelemetryDir(opts.toolName)
    this.outboxPath = join(this.dir, 'outbox.ndjson')
    this.lastFlushPath = join(this.dir, 'last-flush')
    this.lockPath = join(this.dir, 'outbox.lock')
    this.maxBytes = opts.maxBufferBytes ?? DEFAULT_MAX_BYTES
    this.maxAgeMs = opts.maxEventAgeMs ?? DEFAULT_MAX_AGE_MS
    this.lockStaleMs = opts.lockStaleMs ?? DEFAULT_LOCK_STALE_MS
  }

  /** Append one event before any network attempt. Never throws. */
  async append(event: RunEvent): Promise<void> {
    try {
      await this.withLock(async () => {
        await mkdir(this.dir, { recursive: true })
        const line = `${JSON.stringify({ event, storedAt: Date.now() } satisfies StoredEvent) }\n`
        await appendFile(this.outboxPath, line, 'utf-8')
        await this.enforceBoundsInLock()
      })
    } catch {
      // never harm the host
    }
  }

  /** Read all valid events in order. Corrupt lines skipped. */
  async readAll(): Promise<RunEvent[]> {
    return (await this.parseStored()).map(s => s.event)
  }

  /** Count and oldest `storedAt` of valid events. */
  async inspect(): Promise<{ count: number, oldestStoredAt?: number }> {
    const stored = await this.parseStored()
    return { count: stored.length, oldestStoredAt: stored[0]?.storedAt }
  }

  /** Epoch ms of the last successful flush, if any. */
  async readLastFlushAt(): Promise<number | undefined> {
    try {
      const n = Number((await readFile(this.lastFlushPath, 'utf-8')).trim())
      if (!Number.isFinite(n) || n <= 0) return undefined
      return n
    } catch {
      return undefined
    }
  }

  /** Persist a successful flush timestamp. Never throws. */
  async markFlushed(at = Date.now()): Promise<void> {
    try {
      await mkdir(this.dir, { recursive: true })
      await writeFile(this.lastFlushPath, String(at), 'utf-8')
    } catch {
      // never harm the host
    }
  }

  /** Remove delivered events by rewriting the outbox. */
  async removeDelivered(keys: Set<string>): Promise<void> {
    if (keys.size === 0) return
    try {
      await this.withLock(async () => {
        const remaining: StoredEvent[] = []
        let raw: string
        try {
          raw = await readFile(this.outboxPath, 'utf-8')
        } catch {
          return
        }

        const now = Date.now()
        for (const line of raw.split('\n')) {
          if (!line.trim()) continue
          try {
            const stored = JSON.parse(line) as StoredEvent
            if (!stored?.event?.idempotencyKey) continue
            if (keys.has(stored.event.idempotencyKey)) continue
            if (now - stored.storedAt > this.maxAgeMs) continue
            remaining.push(stored)
          } catch {
            // skip
          }
        }

        const tmp = `${this.outboxPath}.tmp`
        const body = remaining.map(s => `${JSON.stringify(s) }\n`).join('')
        await writeFile(tmp, body, 'utf-8')
        await rename(tmp, this.outboxPath)
      })
    } catch {
      // silent
    }
  }

  /** Delete the outbox file entirely. */
  async purge(): Promise<void> {
    try {
      await this.withLock(async () => {
        await unlink(this.outboxPath).catch(() => {})
        await unlink(this.lastFlushPath).catch(() => {})
      })
    } catch {
      // absent is fine
    }
  }

  private async parseStored(): Promise<StoredEvent[]> {
    let raw: string
    try {
      raw = await readFile(this.outboxPath, 'utf-8')
    } catch {
      return []
    }

    const stored: StoredEvent[] = []
    const now = Date.now()
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const item = JSON.parse(line) as StoredEvent
        if (item?.event?.event !== 'run') continue
        if (now - item.storedAt > this.maxAgeMs) continue
        stored.push(item)
      } catch {
        // skip corrupt
      }
    }
    return stored
  }

  private async enforceBoundsInLock(): Promise<void> {
    try {
      const fileStat = await stat(this.outboxPath)
      if (fileStat.size <= this.maxBytes) return
      await this.compactByAgeInLock()
    } catch {
      // silent
    }
  }

  private async compactByAgeInLock(): Promise<void> {
    const now = Date.now()
    let raw: string
    try {
      raw = await readFile(this.outboxPath, 'utf-8')
    } catch {
      return
    }

    const kept: StoredEvent[] = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const stored = JSON.parse(line) as StoredEvent
        if (now - stored.storedAt <= this.maxAgeMs) kept.push(stored)
      } catch {
        // skip
      }
    }

    const serialized = kept.map(s => `${JSON.stringify(s)}\n`)
    let totalBytes = serialized.reduce(
      (sum, line) => sum + Buffer.byteLength(line, 'utf-8'),
      0,
    )

    let dropFrom = 0
    while (dropFrom < serialized.length && totalBytes > this.maxBytes) {
      totalBytes -= Buffer.byteLength(serialized[dropFrom]!, 'utf-8')
      dropFrom++
    }

    const tmp = `${this.outboxPath}.tmp`
    await writeFile(tmp, serialized.slice(dropFrom).join(''), 'utf-8')
    await rename(tmp, this.outboxPath)
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T | undefined> {
    let release!: () => void
    const previous = this.lockChain
    this.lockChain = new Promise<void>(resolve => {
      release = resolve
    })
    await previous

    try {
      return await this.withFileLock(fn)
    } finally {
      release()
    }
  }

  private async withFileLock<T>(fn: () => Promise<T>): Promise<T | undefined> {
    await mkdir(this.dir, { recursive: true })

    for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
      let handle
      let acquired = false
      try {
        handle = await open(this.lockPath, 'wx')
        acquired = true
        const meta: LockMetadata = { pid: process.pid, acquiredAt: Date.now() }
        await handle.writeFile(JSON.stringify(meta), 'utf-8')
        return await fn()
      } catch (err) {
        if (isEexist(err)) {
          if (await this.tryRecoverStaleLock()) continue
          await sleep(LOCK_RETRY_DELAY_MS)
          continue
        }
        throw err
      } finally {
        if (acquired) {
          await handle?.close().catch(() => {})
          await unlink(this.lockPath).catch(() => {})
        }
      }
    }

    return undefined
  }

  private async tryRecoverStaleLock(): Promise<boolean> {
    try {
      const raw = await readFile(this.lockPath, 'utf-8')
      const meta = JSON.parse(raw) as LockMetadata
      const staleByAge = Date.now() - meta.acquiredAt > this.lockStaleMs
      const staleByPid = !Number.isFinite(meta.pid) || !isProcessAlive(meta.pid)
      if (staleByAge || staleByPid) {
        await unlink(this.lockPath).catch(() => {})
        return true
      }
    } catch {
      try {
        const lockStat = await stat(this.lockPath)
        if (Date.now() - lockStat.mtimeMs > this.lockStaleMs) {
          await unlink(this.lockPath).catch(() => {})
          return true
        }
      } catch {
        // absent or unreadable
      }
    }
    return false
  }
}
