/**
 * E2E test for the fs adapter.
 *
 * Fully local and needs no credentials, so unlike the other suites it runs on
 * every pull request (see the `Test` job in `.github/workflows/ci.yml`). It is a
 * true **round-trip**: events go through `initLogger()` and a drain pipeline
 * into real files on disk, then come back through `readFsLogs()` /
 * `tailFsLogs()`. Rotation and `maxFiles` cleanup run against the real file
 * system, which the unit tests mock.
 */
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRequestLogger, initLogger } from '../../src/logger'
import { createDrainPipeline } from '../../src/pipeline'
import type { DrainContext, WideEvent } from '../../src/types'
import type { FsConfig } from '../../src/adapters/fs'
import { createFsDrain, readFsLogs, tailFsLogs } from '../../src/adapters/fs'
import { makeEvent, makeTags } from './_shared'

let root: string
let dir: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'evlog-fs-e2e-'))
  dir = join(root, '.evlog', 'logs')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** A batching pipeline around the fs drain, wired as the global drain the way an app sets it up. */
function initFsLogger(config: Partial<FsConfig> = {}) {
  const drain = createDrainPipeline<DrainContext>({ batch: { size: 1000, intervalMs: 60_000 } })(createFsDrain({ dir, ...config }))
  initLogger({ env: { service: 'evlog-e2e', environment: 'test' }, silent: true, drain })
  return drain
}

async function readAll(options: Parameters<typeof readFsLogs>[0] = {}): Promise<WideEvent[]> {
  const events: WideEvent[] = []
  for await (const event of readFsLogs({ dir, ...options })) events.push(event)
  return events
}

/** Write one event per batch, so a size limit has a chance to rotate between them. */
async function writeOneByOne(config: Partial<FsConfig>, count: number): Promise<string[]> {
  const drain = createFsDrain({ dir, ...config })
  const ids: string[] = []
  for (let index = 0; index < count; index++) {
    const event = makeEvent('fs-rotation', { index, padding: 'x'.repeat(200) })
    ids.push(event.e2e_correlation_id)
    await drain({ event })
  }
  return ids
}

describe('fs e2e (round-trip)', () => {
  it('reads back request wide events drained through the pipeline', async () => {
    const drain = initFsLogger()
    const ok = makeTags('fs-request')
    const failed = makeTags('fs-request')

    const okLog = createRequestLogger({ method: 'GET', path: '/api/orders', requestId: 'req_ok' })
    okLog.set({ ...ok, user: { id: 'user_1', plan: 'pro' }, cart: { items: 3, total: 9999 } })
    okLog.emit({ status: 200 })

    const failedLog = createRequestLogger({ method: 'POST', path: '/api/checkout', requestId: 'req_failed' })
    failedLog.set(failed)
    failedLog.error(new Error('card declined'))
    failedLog.emit({ status: 402 })

    await drain.flush()

    const events = await readAll()
    expect(events.map(event => event.e2e_correlation_id)).toEqual([ok.e2e_correlation_id, failed.e2e_correlation_id])

    const [okEvent, failedEvent] = events
    expect(okEvent).toMatchObject({
      level: 'info',
      service: 'evlog-e2e',
      environment: 'test',
      method: 'GET',
      path: '/api/orders',
      requestId: 'req_ok',
      status: 200,
      user: { id: 'user_1', plan: 'pro' },
      cart: { items: 3, total: 9999 },
    })
    expect(typeof okEvent?.duration).toBe('string')
    expect(failedEvent).toMatchObject({
      level: 'error',
      path: '/api/checkout',
      status: 402,
      error: { message: 'card declined' },
    })

    const errors = await readAll({ level: 'error' })
    expect(errors.map(event => event.e2e_correlation_id)).toEqual([failed.e2e_correlation_id])
  })

  it('writes one NDJSON line per event into a dated file, with a .gitignore at .evlog/', async () => {
    const drain = initFsLogger()
    for (const level of ['info', 'warn'] as const) {
      const log = createRequestLogger({ method: 'GET', path: '/ndjson' })
      log.set(makeTags('fs-ndjson'))
      if (level === 'warn') log.warn('slow upstream')
      log.emit({ status: 200 })
    }
    await drain.flush()

    const today = new Date().toISOString().slice(0, 10)
    expect(await readdir(dir)).toEqual([`${today}.jsonl`])
    const lines = (await readFile(join(dir, `${today}.jsonl`), 'utf8')).trimEnd().split('\n')
    expect(lines.map(line => (JSON.parse(line) as WideEvent).level)).toEqual(['info', 'warn'])
    expect(await readFile(join(root, '.evlog', '.gitignore'), 'utf8')).toBe('*\n')
  })

  it('reads back pretty-printed events, nested objects included', async () => {
    const drain = initFsLogger({ pretty: true })
    const tags = makeTags('fs-pretty')
    const log = createRequestLogger({ method: 'GET', path: '/pretty' })
    log.set({ ...tags, nested: { deep: { list: [1, 2, 3], ok: true } } })
    log.emit({ status: 200 })
    await drain.flush()

    const [event] = await readAll()
    expect(event).toMatchObject({ e2e_correlation_id: tags.e2e_correlation_id, nested: { deep: { list: [1, 2, 3], ok: true } } })
    expect(await readFile(join(dir, `${new Date().toISOString().slice(0, 10)}.jsonl`), 'utf8')).toContain('\n  "nested": {\n')
  })

  it('rotates into suffixed files at maxSizePerFile and reads them back in write order', async () => {
    const maxSizePerFile = 1024
    const ids = await writeOneByOne({ maxSizePerFile }, 12)

    const files = await readdir(dir).then(names => names.filter(name => name.endsWith('.jsonl')))
    const today = new Date().toISOString().slice(0, 10)
    expect(files.length).toBeGreaterThan(1)
    expect(files).toContain(`${today}.jsonl`)
    expect(files).toContain(`${today}.1.jsonl`)

    // A file only rotates once it reaches the limit, so it overshoots by at most one batch.
    for (const file of files) {
      const content = await readFile(join(dir, file), 'utf8')
      const lines = content.trimEnd().split('\n')
      expect(Buffer.byteLength(content) - Buffer.byteLength(`${lines.at(-1)}\n`)).toBeLessThan(maxSizePerFile)
    }

    expect((await readAll()).map(event => event.e2e_correlation_id)).toEqual(ids)
  })

  it('keeps only the newest maxFiles files', async () => {
    const ids = await writeOneByOne({ maxSizePerFile: 512, maxFiles: 2 }, 12)

    const files = (await readdir(dir)).filter(name => name.endsWith('.jsonl'))
    expect(files).toHaveLength(2)

    const kept = (await readAll()).map(event => event.e2e_correlation_id)
    expect(kept.length).toBeGreaterThan(0)
    expect(kept.length).toBeLessThan(ids.length)
    expect(kept).toEqual(ids.slice(-kept.length))
  })

  it('tails events appended after it starts', async () => {
    const before = makeEvent('fs-tail')
    await createFsDrain({ dir })({ event: before })

    const controller = new AbortController()
    const seen: string[] = []
    const tail = (async () => {
      for await (const event of tailFsLogs({ dir, fromEnd: true, pollIntervalMs: 50, signal: controller.signal })) {
        seen.push(event.e2e_correlation_id as string)
        if (seen.length === 2) controller.abort()
      }
    })()
    // Let the tailer record the current end of file before anything is appended.
    await new Promise(resolve => setTimeout(resolve, 200))

    const drain = initFsLogger()
    const appended = [makeTags('fs-tail'), makeTags('fs-tail')]
    for (const tags of appended) {
      const log = createRequestLogger({ method: 'GET', path: '/tail' })
      log.set(tags)
      log.emit({ status: 200 })
    }
    await drain.flush()
    await tail

    expect(seen).toEqual(appended.map(tags => tags.e2e_correlation_id))
  })
})
