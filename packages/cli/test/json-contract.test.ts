import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { version } from '../package.json'
import { run } from '../src/run'

vi.hoisted(() => {
  process.env.EVLOG_TELEMETRY = '0'
  process.env.EVLOG_CLI_ENV = 'test'
})

const EVENTS = [
  { timestamp: '2026-10-01T10:00:00.000Z', level: 'error', service: 'shop', method: 'POST', path: '/api/checkout', status: 402, durationMs: 412, requestId: 'cccccccc-0000-4000-8000-000000000003', error: { name: 'Error', message: 'Payment processing failed', statusCode: 402 } },
  { timestamp: '2026-10-01T11:00:00.000Z', level: 'info', service: 'shop', method: 'GET', path: '/api/health', status: 200, durationMs: 2, requestId: 'bbbbbbbb-0000-4000-8000-000000000002' },
]

let cwd: string

beforeAll(async () => {
  cwd = await realpath(await mkdtemp(join(tmpdir(), 'evlog-cli-json-')))
  await cp(join(import.meta.dirname, 'map/fixtures/hono-basic'), cwd, { recursive: true })
  await mkdir(join(cwd, 'node_modules/evlog'), { recursive: true })
  await writeFile(join(cwd, 'node_modules/evlog/package.json'), JSON.stringify({ name: 'evlog', version: '3.0.0' }))
  await writeFile(join(cwd, 'evlog.config.ts'), `export default {
  service: 'shop',
  sampling: { rates: { info: 50 } },
  map: { minScore: 50 },
}
`)
  await mkdir(join(cwd, '.evlog/logs'), { recursive: true })
  await writeFile(join(cwd, '.evlog/logs/2026-10-01.jsonl'), `${EVENTS.map(e => JSON.stringify(e)).join('\n')}\n`)
})

afterAll(async () => {
  await rm(cwd, { recursive: true, force: true })
})

afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = undefined
})

/** Masks what changes between machines and releases, so the snapshot holds only the shape and the scan. */
function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replaceAll(cwd, '<cwd>')
      .replaceAll(version, '<cli-version>')
      .replaceAll(process.version, '<node-version>')
  }
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === 'generatedAt' ? '<time>' : redact(v)]))
  return value
}

async function json(argv: string[]): Promise<{ exitCode: number, output: unknown }> {
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  await run([...argv, '--cwd', cwd, '--json'])
  const text = stdout.mock.calls.map(([chunk]) => String(chunk)).join('')
  return { exitCode: Number(process.exitCode ?? 0), output: redact(JSON.parse(text)) }
}

describe('--json contract', () => {
  it.each([
    ['map', ['map', '--no-write', '--no-header']],
    ['doctor', ['doctor']],
    ['config', ['config']],
    ['logs', ['logs', '--since', '2026-09-30T00:00:00Z', '--until', '2026-10-02T00:00:00Z']],
  ])('keeps the %s envelope', async (_name, argv) => {
    expect(await json(argv)).toMatchSnapshot()
  })
})
