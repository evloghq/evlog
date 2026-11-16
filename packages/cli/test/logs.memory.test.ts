import { execFile } from 'node:child_process'
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const run = promisify(execFile)
const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const HEAP_MB = 64
const COUNT = 200_000
const BATCH = 10_000

let cwd: string

/* About 60 MB of events: parsed, they take more than the heap the reader gets. */
beforeAll(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'evlog-cli-logs-big-'))
  await writeFile(join(cwd, 'package.json'), '{"name":"shop"}')
  await mkdir(join(cwd, '.evlog', 'logs'), { recursive: true })
  const start = Date.parse('2026-10-01T00:00:00.000Z')
  for (let from = 0; from < COUNT; from += BATCH) {
    let lines = ''
    for (let index = from; index < from + BATCH; index++) {
      lines += `${JSON.stringify({
        timestamp: new Date(start + index * 10).toISOString(),
        level: 'info',
        service: 'shop',
        environment: 'development',
        method: 'GET',
        path: `/api/items/${index % 4}`,
        status: 200,
        durationMs: index % 1000,
        duration: `${index % 1000}ms`,
        requestId: `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`,
        user: { id: `usr_${index % 5000}`, plan: 'pro' },
        cart: { items: index % 9, total: index % 20_000, currency: 'EUR', coupon: 'WELCOME10' },
      })}\n`
    }
    await appendFile(join(cwd, '.evlog', 'logs', '2026-10-01.jsonl'), lines)
  }
})

afterAll(async () => {
  await rm(cwd, { recursive: true, force: true })
})

async function logs(args: string[]): Promise<Record<string, any>> {
  const { stdout } = await run(
    process.execPath,
    [`--max-old-space-size=${HEAP_MB}`, '--import', 'tsx', 'src/cli.ts', 'logs', ...args, '--json', '--cwd', cwd],
    { cwd: packageRoot, env: { ...process.env, EVLOG_TELEMETRY: '0', HOME: cwd }, maxBuffer: 16 * 1024 * 1024 },
  )
  return JSON.parse(stdout)
}

describe(`a log that does not fit in a ${HEAP_MB} MB heap`, () => {
  it('shows the latest events', async () => {
    const result = await logs(['--limit', '3'])

    expect(result.matched).toBe(COUNT)
    expect(result.events.map((event: { requestId: string }) => event.requestId.slice(0, 8))).toEqual(['00199997', '00199998', '00199999'])
  }, 60_000)

  it('shows the slowest requests, the earliest first among equals', async () => {
    const result = await logs(['slow', '--over', '0', '--limit', '3'])

    expect(result.matched).toBe(COUNT)
    expect(result.events.map((event: { requestId: string, durationMs: number }) => [event.durationMs, event.requestId.slice(0, 8)]))
      .toEqual([[999, '00000999'], [999, '00001999'], [999, '00002999']])
  }, 60_000)

  it('computes the stats', async () => {
    const { matched, stats } = await logs(['stats'])

    expect(matched).toBe(COUNT)
    expect(stats.total).toBe(COUNT)
    expect(stats.byRoute).toHaveLength(4)
    expect(stats.byRoute[0]).toEqual({ route: 'GET /api/items/0', count: COUNT / 4, errors: 0, p50: 496, p95: 948 })
  }, 60_000)
})
