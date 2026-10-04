import { createReadStream } from 'node:fs'
import { appendFile, mkdir, open, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { createInterface } from 'node:readline'
import type { LogLevel, WideEvent } from '../types'
import type { ConfigField } from '../shared/config'
import { resolveAdapterConfig } from '../shared/config'
import { defineDrain } from '../shared/drain'

export interface FsConfig {
  /** Directory for log files. Default: `.evlog/logs` */
  dir: string
  /** Max number of log files to keep (auto-deletes oldest when exceeded) */
  maxFiles?: number
  /** Max bytes per file before rotating to a new suffixed file */
  maxSizePerFile?: number
  /** Pretty-print JSON instead of compact NDJSON */
  pretty: boolean
}

const FS_FIELDS: ConfigField<FsConfig>[] = [
  { key: 'dir', env: ['NUXT_EVLOG_FS_DIR', 'EVLOG_FS_DIR'] },
  { key: 'maxFiles' },
  { key: 'maxSizePerFile' },
  { key: 'pretty' },
]

const gitignoreWritten = new Set<string>()
const unwritableDirs = new Set<string>()
let warnedFsEdgeRuntime = false

function isEdgeRuntime(): boolean {
  return process.env.NEXT_RUNTIME === 'edge'
}

function warnFsEdgeRuntimeOnce(): void {
  if (warnedFsEdgeRuntime) return
  warnedFsEdgeRuntime = true
  console.warn('[evlog/fs] File system drain is not available on the Edge runtime. Use evlog/memory or an HTTP adapter instead.')
}

/** Read-only or permission-denied, as opposed to a full disk or a real bug. */
function isUnwritableError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return code === 'EROFS' || code === 'EACCES' || code === 'EPERM'
}

/**
 * Record that `dir` cannot be written to, and say so once.
 *
 * Synchronous on purpose: concurrent batches that all fail their first write
 * reach this together, and the check-then-add pair cannot interleave.
 */
function markUnwritable(dir: string): void {
  if (unwritableDirs.has(dir)) return
  unwritableDirs.add(dir)
  console.warn(`[evlog/fs] "${dir}" is not writable, so the file system drain is disabled. This is expected on a serverless host, where only the temp directory is writable and does not outlive the instance — send events to an HTTP adapter instead, or set the drain's \`dir\` to a writable path.`)
}

async function ensureGitignore(dir: string): Promise<void> {
  const normalized = dir.replace(/[\\/]/g, sep)
  const segments = normalized.split(sep)
  const evlogIndex = segments.findIndex(s => s === '.evlog')
  const targetDir = evlogIndex !== -1 ? segments.slice(0, evlogIndex + 1).join(sep) : dir

  if (gitignoreWritten.has(targetDir)) return

  const gitignorePath = join(targetDir, '.gitignore')
  try {
    await stat(gitignorePath)
  } catch {
    await writeFile(gitignorePath, '*\n', 'utf-8')
  }
  gitignoreWritten.add(targetDir)
}

function getDateString(): string {
  return new Date().toISOString().slice(0, 10)
}

async function resolveFilePath(dir: string, maxSizePerFile?: number): Promise<string> {
  const date = getDateString()
  const basePath = join(dir, `${date}.jsonl`)

  if (!maxSizePerFile) return basePath

  try {
    const stats = await stat(basePath)
    if (stats.size < maxSizePerFile) return basePath
  } catch {
    return basePath
  }

  for (let i = 1; i < 1000; i++) {
    const rotatedPath = join(dir, `${date}.${i}.jsonl`)
    try {
      const stats = await stat(rotatedPath)
      if (stats.size < maxSizePerFile) return rotatedPath
    } catch {
      return rotatedPath
    }
  }

  return join(dir, `${date}.999.jsonl`)
}

function parseLogFilename(filename: string): { date: string; index: number } {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.jsonl$/)
  if (!match) return { date: '', index: 0 }
  return { date: match[1], index: match[2] ? Number.parseInt(match[2], 10) : 0 }
}

async function cleanupOldFiles(dir: string, maxFiles: number): Promise<void> {
  const files = await readdir(dir)
  const jsonlFiles = files.filter(f => f.endsWith('.jsonl')).sort((a, b) => {
    const pa = parseLogFilename(a)
    const pb = parseLogFilename(b)
    return pa.date.localeCompare(pb.date) || pa.index - pb.index
  })

  if (jsonlFiles.length <= maxFiles) return

  const toDelete = jsonlFiles.slice(0, jsonlFiles.length - maxFiles)
  await Promise.allSettled(toDelete.map(f => unlink(join(dir, f))))
}

export async function writeToFs(event: WideEvent, config: FsConfig): Promise<void> {
  await writeBatchToFs([event], config)
}

export async function writeBatchToFs(events: WideEvent[], config: FsConfig): Promise<void> {
  if (events.length === 0) return

  await mkdir(config.dir, { recursive: true })
  await ensureGitignore(config.dir)

  const filePath = await resolveFilePath(config.dir, config.maxSizePerFile)
  const lines = `${events
    .map(e => config.pretty ? JSON.stringify(e, null, 2) : JSON.stringify(e))
    .join('\n') }\n`

  await appendFile(filePath, lines, 'utf-8')

  if (config.maxFiles) {
    await cleanupOldFiles(config.dir, config.maxFiles)
  }
}

/**
 * Create a drain function that writes logs to the local file system as NDJSON.
 *
 * Files are organized by date (`2026-03-14.jsonl`) with optional size-based
 * rotation and automatic cleanup of old files.
 *
 * @example
 * ```ts
 * // Default: writes to .evlog/logs/
 * nitroApp.hooks.hook('evlog:drain', createFsDrain())
 *
 * // With options
 * nitroApp.hooks.hook('evlog:drain', createFsDrain({
 *   dir: '.evlog/logs',
 *   maxFiles: 7,
 *   pretty: true,
 * }))
 * ```
 *
 * @remarks
 * A write that fails with `EROFS`, `EACCES` or `EPERM` marks the configured
 * directory unavailable and disables the drain for the rest of the process,
 * after warning once. Attaching it on a host without a writable directory is
 * therefore safe, though the events go nowhere.
 */
export function createFsDrain(overrides?: Partial<FsConfig>) {
  return defineDrain<FsConfig>({
    name: 'fs',
    resolve: async () => {
      if (isEdgeRuntime()) {
        warnFsEdgeRuntimeOnce()
        return null
      }
      const resolved = await resolveAdapterConfig<FsConfig>('fs', FS_FIELDS, overrides)
      const dir = resolved.dir ?? '.evlog/logs'
      if (unwritableDirs.has(dir)) return null
      return {
        dir,
        pretty: resolved.pretty ?? false,
        maxFiles: resolved.maxFiles,
        maxSizePerFile: resolved.maxSizePerFile,
      }
    },
    // The write itself is the probe. `mkdir` is a no-op on a directory that
    // already exists, so it succeeds on a read-only one and proves nothing;
    // only the append tells you whether this host will take the events.
    send: async (events, config) => {
      try {
        await writeBatchToFs(events, config)
      } catch (error) {
        if (!isUnwritableError(error)) throw error
        markUnwritable(config.dir)
      }
    },
  })
}

/** Options accepted by {@link readFsLogs}. */
export interface ReadFsLogsOptions {
  /** Directory to read from. Default: `.evlog/logs` */
  dir?: string
  /** Only yield events with `event.timestamp >= since`. */
  since?: Date | string
  /** Only yield events with `event.timestamp <= until`. */
  until?: Date | string
  /** Filter by event level. */
  level?: LogLevel | LogLevel[]
  /** Custom predicate — return `false` to skip the event. */
  filter?: (event: WideEvent) => boolean
}

/** Options accepted by {@link tailFsLogs}. */
export interface TailFsLogsOptions extends ReadFsLogsOptions {
  /**
   * Polling interval (ms) used to detect new bytes / new files.
   * @default 500
   */
  pollIntervalMs?: number
  /**
   * Skip existing events and only yield events appended after the tailer
   * starts. Useful for "live tail" UX.
   * @default false
   */
  fromEnd?: boolean
  /** Stop tailing when this signal aborts. */
  signal?: AbortSignal
}

interface ParsedFilename {
  date: string
  index: number
}

function isLogFilename(filename: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(\.\d+)?\.jsonl$/.test(filename)
}

function compareLogFiles(a: string, b: string): number {
  const pa = parseLogFilename(a)
  const pb = parseLogFilename(b)
  return pa.date.localeCompare(pb.date) || pa.index - pb.index
}

function normalizeTimestamp(value: Date | string | undefined): number | undefined {
  if (!value) return undefined
  const date = value instanceof Date ? value : new Date(value)
  const ts = date.getTime()
  return Number.isNaN(ts) ? undefined : ts
}

function buildFilter(options: ReadFsLogsOptions): (event: WideEvent) => boolean {
  const since = normalizeTimestamp(options.since)
  const until = normalizeTimestamp(options.until)
  const levels = options.level
    ? new Set<LogLevel>(Array.isArray(options.level) ? options.level : [options.level])
    : undefined
  const custom = options.filter

  return (event: WideEvent) => {
    if (levels && !levels.has(event.level)) return false
    if (since !== undefined || until !== undefined) {
      const ts = typeof event.timestamp === 'string' ? Date.parse(event.timestamp) : Number.NaN
      if (Number.isNaN(ts)) return false
      if (since !== undefined && ts < since) return false
      if (until !== undefined && ts > until) return false
    }
    if (custom && !custom(event)) return false
    return true
  }
}

async function listLogFiles(dir: string): Promise<string[]> {
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return []
  }
  return files.filter(isLogFilename).sort(compareLogFiles)
}

function fileDateMs(filename: string): number {
  const { date } = parseLogFilename(filename)
  return date ? Date.parse(`${date}T00:00:00.000Z`) : Number.NaN
}

function fileWithinRange(filename: string, since?: number, until?: number): boolean {
  if (since === undefined && until === undefined) return true
  const dayStart = fileDateMs(filename)
  if (Number.isNaN(dayStart)) return true
  const dayEnd = dayStart + 24 * 60 * 60 * 1000 - 1
  if (since !== undefined && dayEnd < since) return false
  if (until !== undefined && dayStart > until) return false
  return true
}

/**
 * Turn lines into events, one object per line or one object across lines.
 *
 * `pretty: true` writes each event indented, so its closing brace sits alone
 * at the start of a line while every nested one is indented: that is how an
 * object's end is found without parsing on every line. Anything that does not
 * parse once assembled (a partial write, a manual edit) is dropped silently,
 * the same as a malformed single line.
 */
function createEventAssembler(): (line: string) => WideEvent | undefined {
  let pending: string[] = []
  return (line) => {
    if (pending.length === 0) {
      const trimmed = line.trim()
      if (!trimmed) return undefined
      try {
        return JSON.parse(trimmed) as WideEvent
      } catch {
        if (trimmed === '{') pending.push(trimmed)
        return undefined
      }
    }
    pending.push(line)
    if (line !== '}') return undefined
    const text = pending.join('\n')
    pending = []
    try {
      return JSON.parse(text) as WideEvent
    } catch {
      return undefined
    }
  }
}

async function* iterateFile(filePath: string): AsyncGenerator<WideEvent> {
  const stream = createReadStream(filePath, { encoding: 'utf-8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  const assemble = createEventAssembler()
  try {
    for await (const line of rl) {
      const event = assemble(line)
      if (event) yield event
    }
  } finally {
    rl.close()
    stream.destroy()
  }
}

/**
 * Read past events from the local file system drain (NDJSON). Files are
 * iterated in chronological order; events are yielded as they appear in
 * each file.
 *
 * @example
 * ```ts
 * import { readFsLogs } from 'evlog/fs'
 *
 * for await (const event of readFsLogs({ since: '2026-01-01', level: 'error' })) {
 *   console.log(event)
 * }
 * ```
 */
export async function* readFsLogs(options: ReadFsLogsOptions = {}): AsyncGenerator<WideEvent> {
  const dir = options.dir ?? '.evlog/logs'
  const sinceMs = normalizeTimestamp(options.since)
  const untilMs = normalizeTimestamp(options.until)
  const predicate = buildFilter(options)

  const files = await listLogFiles(dir)
  for (const filename of files) {
    if (!fileWithinRange(filename, sinceMs, untilMs)) continue
    for await (const event of iterateFile(join(dir, filename))) {
      if (predicate(event)) yield event
    }
  }
}

async function safeStatSize(filePath: string): Promise<number> {
  try {
    const s = await stat(filePath)
    return s.size
  } catch {
    return 0
  }
}

async function readAppendedLines(
  filePath: string,
  fromOffset: number,
  carry: string,
): Promise<{ events: string[]; offset: number; carry: string }> {
  const size = await safeStatSize(filePath)
  if (size <= fromOffset) return { events: [], offset: fromOffset, carry }

  const handle = await open(filePath, 'r')
  try {
    const length = size - fromOffset
    const buf = Buffer.alloc(length)
    await handle.read(buf, 0, length, fromOffset)
    const chunk = carry + buf.toString('utf-8')
    const newlineIdx = chunk.lastIndexOf('\n')
    if (newlineIdx === -1) {
      return { events: [], offset: size, carry: chunk }
    }
    const complete = chunk.slice(0, newlineIdx)
    const remainder = chunk.slice(newlineIdx + 1)
    const lines = complete.split('\n').filter(l => l.trim())
    return { events: lines, offset: size, carry: remainder }
  } finally {
    await handle.close()
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer)
        resolve()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

/**
 * Follow the local file system drain in real time. Yields existing events
 * (unless `fromEnd: true`) then keeps yielding new events as they are
 * appended. Automatically picks up newly created daily files.
 *
 * @example
 * ```ts
 * import { tailFsLogs } from 'evlog/fs'
 *
 * const ac = new AbortController()
 * setTimeout(() => ac.abort(), 60_000)
 *
 * for await (const event of tailFsLogs({ signal: ac.signal })) {
 *   console.log('live:', event.action ?? event.message)
 * }
 * ```
 */
export async function* tailFsLogs(options: TailFsLogsOptions = {}): AsyncGenerator<WideEvent> {
  const dir = options.dir ?? '.evlog/logs'
  const interval = Math.max(50, options.pollIntervalMs ?? 500)
  const { signal } = options
  const predicate = buildFilter(options)

  const offsets = new Map<string, number>()
  const carries = new Map<string, string>()
  const assemblers = new Map<string, ReturnType<typeof createEventAssembler>>()
  function assemblerFor(filename: string): ReturnType<typeof createEventAssembler> {
    let assemble = assemblers.get(filename)
    if (!assemble) {
      assemble = createEventAssembler()
      assemblers.set(filename, assemble)
    }
    return assemble
  }

  if (options.fromEnd) {
    const files = await listLogFiles(dir)
    for (const filename of files) {
      offsets.set(filename, await safeStatSize(join(dir, filename)))
      carries.set(filename, '')
    }
  } else {
    for await (const event of readFsLogs(options)) {
      if (signal?.aborted) return
      yield event
    }
    const files = await listLogFiles(dir)
    for (const filename of files) {
      if (!offsets.has(filename)) {
        offsets.set(filename, await safeStatSize(join(dir, filename)))
        carries.set(filename, '')
      }
    }
  }

  while (true) {
    if (signal?.aborted) return
    await delay(interval, signal)
    if (signal?.aborted) return

    const files = await listLogFiles(dir)

    for (const filename of files) {
      if (!offsets.has(filename)) {
        offsets.set(filename, 0)
        carries.set(filename, '')
      }
      const filePath = join(dir, filename)
      const fromOffset = offsets.get(filename)!
      const carry = carries.get(filename) ?? ''
      const { events, offset, carry: newCarry } = await readAppendedLines(filePath, fromOffset, carry)
      offsets.set(filename, offset)
      carries.set(filename, newCarry)

      const assemble = assemblerFor(filename)
      for (const line of events) {
        if (signal?.aborted) return
        const event = assemble(line)
        if (event && predicate(event)) yield event
      }
    }
  }
}
