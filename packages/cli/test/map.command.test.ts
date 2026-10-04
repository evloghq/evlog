import { existsSync } from 'node:fs'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runCommand } from 'citty'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { version } from '../package.json'
import map, { formatMapReport, runMap } from '../src/commands/map'
import type { MapResult } from '../src/commands/map'
import type { MapFile, RouteEntry } from '../src/lib/map/types'
import { createContext } from '../src/core/context'
import type { CliContext } from '../src/core/context'
import { SCHEMA_VERSION } from '../src/core/output'
import { resolveCliEnvironment } from '../src/lib/environment'
import { MIN_WIDTH, formatMapInspect } from '../src/lib/map/report'
import { REQUIREMENTS, RULE_SET_VERSION } from '../src/lib/map/rules/index'

const FIXTURES = join(import.meta.dirname, 'map/fixtures')

const tempDirs: string[] = []

async function copyFixture(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `evlog-cli-map-${name}-`))
  tempDirs.push(dir)
  await cp(join(FIXTURES, name), dir, { recursive: true })
  return dir
}

function fakeContext(cwd: string, overrides: Partial<CliContext> = {}): CliContext {
  return createContext({
    cwd,
    env: {},
    nodeVersion: 'v22.0.0',
    tty: false,
    color: false,
    columns: 80,
    ...overrides,
  })
}

afterEach(async () => {
  vi.restoreAllMocks()
  process.exitCode = undefined
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('runMap', () => {
  it('scans a nuxt fixture and scores its routes without writing evlog.map.json', async () => {
    const cwd = join(FIXTURES, 'nuxt-basic')
    const result = await runMap(fakeContext(cwd), undefined, { noWrite: true })

    expect(result.framework).toBe('nuxt')
    expect(result.mapPath).toBeNull()
    expect(result.scan.map.routes.length).toBeGreaterThan(0)
    const checkout = result.scan.map.routes.find(r => r.path === '/api/checkout')
    expect(checkout?.score).toBe(100)
  })

  it('writes evlog.map.json to the project root by default', async () => {
    const cwd = await copyFixture('nuxt-basic')
    const result = await runMap(fakeContext(cwd))

    expect(result.mapPath).toBe(join(cwd, 'evlog.map.json'))
    const written = JSON.parse(await readFile(result.mapPath!, 'utf-8')) as { version: number, routes: unknown[] }
    expect(written.version).toBe(1)
    expect(written.routes.length).toBe(result.scan.map.routes.length)
  })

  it('honors an explicit --framework override', async () => {
    const cwd = join(FIXTURES, 'tanstack-basic')
    const result = await runMap(fakeContext(cwd), undefined, { framework: 'tanstack-start', noWrite: true })
    expect(result.framework).toBe('tanstack-start')
  })

  it('writes the CLI and rule set versions that wrote the map', async () => {
    const cwd = await copyFixture('nuxt-basic')
    const result = await runMap(fakeContext(cwd))

    const written = JSON.parse(await readFile(result.mapPath!, 'utf-8')) as { cliVersion: string, ruleSetVersion: number }
    expect(written.ruleSetVersion).toBe(RULE_SET_VERSION)
    expect(written.cliVersion).toBe(version)
  })

  it('throws a catalog error for an unsupported project', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evlog-cli-map-unsupported-'))
    tempDirs.push(cwd)
    await expect(runMap(fakeContext(cwd), undefined, { noWrite: true })).rejects.toThrow(/no package\.json/i)
  })
})

describe('formatMapReport', () => {
  const nuxt = async (): Promise<{ ctx: CliContext, result: MapResult }> => {
    const cwd = join(FIXTURES, 'nuxt-basic')
    const ctx = fakeContext(cwd)
    return { ctx, result: await runMap(ctx, undefined, { noWrite: true }) }
  }

  it('renders the report without ANSI in plain mode', async () => {
    const { ctx, result } = await nuxt()
    const out = formatMapReport(ctx, result)

    expect(out).not.toContain('\x1B')
    expect(out).toContain('COVERAGE')
    expect(out).toContain('FIX FIRST')
    expect(out).toContain(String(result.scan.map.score))
  })

  it('colors the report only when the context allows it', async () => {
    const { result } = await nuxt()
    const colored = formatMapReport(fakeContext(join(FIXTURES, 'nuxt-basic'), { color: true }), result)
    expect(colored).toContain('\x1B')
  })

  it('names the score and the project in the headline', async () => {
    const { ctx, result } = await nuxt()
    const out = formatMapReport(ctx, result)

    expect(out).toContain('score /100')
    expect(out).toContain(result.scan.map.projectName)
    expect(out).toContain('Nuxt')
  })

  it('presents suggestions as an invitation, never as a failure', async () => {
    const { ctx, result } = await nuxt()
    const out = formatMapReport(ctx, result)
    const section = out.slice(out.indexOf('GOING FURTHER'))

    expect(out).toContain('GOING FURTHER')
    expect(out).toContain('Suggestions never change the score.')
    expect(section).not.toContain('✗')
  })

  it('renders every entry point as a matrix with --all', async () => {
    const { result } = await nuxt()
    const wide = fakeContext(join(FIXTURES, 'nuxt-basic'), { columns: 120 })
    const out = formatMapReport(wide, result, { all: true })

    expect(out).toContain('entry points, worst first')
    expect(out).toContain('covered')
    for (const route of result.scan.map.routes) {
      expect(out).toContain(route.file.split('/').slice(1).join('/'))
    }
  })

  it('fits every view inside the terminal it was given', async () => {
    const { result } = await nuxt()

    for (const columns of [60, 80, 100, 140]) {
      const ctx = fakeContext(join(FIXTURES, 'nuxt-basic'), { columns })
      const views = [
        formatMapReport(ctx, result),
        formatMapReport(ctx, result, { all: true }),
      ]

      for (const view of views) {
        for (const line of view.split('\n')) {
          expect(line.length, `"${line}" at width ${columns}`)
            .toBeLessThanOrEqual(Math.max(columns, MIN_WIDTH))
        }
      }
    }
  })

  it('caps the skyline instead of growing it with the project', async () => {
    const { result } = await nuxt()
    const ctx = fakeContext(join(FIXTURES, 'nuxt-basic'), { columns: 100 })
    const skylineRow = (count: number): string => {
      const { routes } = result.scan.map
      const inflated = Array.from({ length: count }, (_, index) => routes[index % routes.length]!)
      const scan = { ...result.scan, map: { ...result.scan.map, routes: inflated } }
      const [, , third] = formatMapReport(ctx, { ...result, scan }).split('\n')
      return third!
    }

    expect(skylineRow(500).length).toBeLessThanOrEqual(100)
    expect(skylineRow(5000).length).toBe(skylineRow(500).length)
  })

  it('inspects one entry point by route path', async () => {
    const { ctx, result } = await nuxt()
    const out = formatMapReport(ctx, result, { entry: '/api/payments/stripe' })

    expect(out).toContain('WHY THIS FILE IS SCANNED')
    expect(out).toContain('FLAGGED SENSITIVE BECAUSE')
    expect(out).toContain('SUGGESTED SHAPE')
    expect(out).toContain('useLogger(event)')
  })

  it('suggests a hono handler shape for a hono route', async () => {
    const cwd = join(FIXTURES, 'hono-basic')
    const ctx = fakeContext(cwd)
    const result = await runMap(ctx, undefined, { noWrite: true })
    const out = formatMapReport(ctx, result, { entry: '/health' })

    expect(out).toContain('SUGGESTED SHAPE')
    expect(out).toContain('app.get(\'/health\', async (c) => {')
  })

  it('suggests app.on for a hono method that has no shorthand', async () => {
    const cwd = join(FIXTURES, 'hono-basic')
    const ctx = fakeContext(cwd)
    const result = await runMap(ctx, undefined, { noWrite: true })
    const health = result.scan.map.routes.find(route => route.path === '/health')!
    const out = formatMapInspect(ctx, result.scan, { ...health, method: 'PURGE' })

    expect(out).toContain('app.on(\'PURGE\', \'/health\', async (c) => {')
    expect(out).not.toContain('app.purge(')
  })

  it('names the audit action after the route it suggests it for', async () => {
    const { ctx, result } = await nuxt()
    const out = formatMapReport(ctx, result, { entry: '/api/payments/stripe' })

    expect(out).toContain('payments.stripe')
    expect(out).not.toContain('payment.captured')
  })

  it('shows the fix of every failing requirement, whatever the rule', async () => {
    const { ctx, result } = await nuxt()
    const { framework } = result.scan.map

    for (const rule of REQUIREMENTS) {
      if (!rule.suggest) continue
      const [kind] = rule.appliesTo.kinds
      const entry: RouteEntry = {
        id: 'synthetic',
        framework,
        kind: kind!,
        method: 'POST',
        path: '/api/things',
        file: 'server/api/things.post.ts',
        handler: { line: 1, column: 0 },
        checks: { [rule.id]: { status: 'fail', message: 'synthetic failure' } },
        suggestions: {},
        sensitivity: { level: 'none', reasons: [] },
        score: 50,
      }
      const [opening] = rule.suggest({ target: entry, framework, project: result.scan.project })
      const out = formatMapInspect(ctx, result.scan, entry)

      expect(out, `${rule.id} has no fix in the suggested shape`).toContain(opening!.trim())
    }
  })

  it('keeps a page fix inline instead of wrapping it in a server handler', async () => {
    const { ctx, result } = await nuxt()
    const page = result.scan.map.routes.find(route => route.kind === 'page' && route.score < 100)!
    const out = formatMapInspect(ctx, result.scan, page)

    expect(out).toContain('SUGGESTED SHAPE')
    expect(out).toContain('useFetch')
    expect(out).not.toContain('defineEventHandler')
  })

  it('never claims a handler catches or shapes errors it does not have', async () => {
    const { ctx, result } = await nuxt()
    const out = formatMapReport(ctx, result, { entry: '/health' })

    expect(out).not.toContain('failures are caught and logged')
    expect(out).not.toContain('errors carry why and fix')
  })

  it('inspects the same entry point by file path', async () => {
    const { ctx, result } = await nuxt()
    const byPath = formatMapReport(ctx, result, { entry: '/api/payments/stripe' })
    const byFile = formatMapReport(ctx, result, { entry: 'server/api/payments/stripe.post.ts' })

    expect(byFile).toBe(byPath)
  })

  it('accepts the ./ prefix a shell completes', async () => {
    const { ctx, result } = await nuxt()
    const bare = formatMapReport(ctx, result, { entry: 'server/api/payments/stripe.post.ts' })
    const dotted = formatMapReport(ctx, result, { entry: './server/api/payments/stripe.post.ts' })

    expect(dotted).toBe(bare)
  })

  it('still suggests near matches for a ./ prefixed typo', async () => {
    const { ctx, result } = await nuxt()
    const out = formatMapReport(ctx, result, { entry: './server/api/payment' })

    expect(out).toContain('Did you mean')
    expect(out).toContain('/api/payments/stripe')
  })

  it('suggests near matches when the entry point is unknown', async () => {
    const { ctx, result } = await nuxt()
    const out = formatMapReport(ctx, result, { entry: 'payments' })

    expect(out).toContain('No entry point matches payments')
  })

  it('spells out the gate verdict and its exit code', async () => {
    const { ctx, result } = await nuxt()
    const failing = formatMapReport(ctx, result, { minScore: 100 })
    const passing = formatMapReport(ctx, result, { minScore: 0 })

    expect(failing).toContain('is below --min-score 100')
    expect(failing).toContain('exit code 1')
    expect(passing).toContain('meets --min-score 0')
    expect(passing).toContain('exit code 0')
  })
})

describe('map command', () => {
  it('--no-write on real argv actually skips the write (regression: citty negates `write`, not a `noWrite` arg)', async () => {
    const cwd = await copyFixture('nuxt-basic')
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await runCommand(map, { rawArgs: ['--cwd', cwd, '--json', '--no-header', '--no-write'] })

    await expect(readFile(join(cwd, 'evlog.map.json'), 'utf-8')).rejects.toThrow()
  })

  it('writes evlog.map.json by default when no --no-write flag is passed', async () => {
    const cwd = await copyFixture('nuxt-basic')
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await runCommand(map, { rawArgs: ['--cwd', cwd, '--json', '--no-header'] })

    await expect(readFile(join(cwd, 'evlog.map.json'), 'utf-8')).resolves.toContain('"version": 1')
  })

  it('keeps the --json schema contract', async () => {
    const cwd = join(FIXTURES, 'nuxt-basic')

    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      out.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
      return true
    }) as typeof process.stdout.write)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await runCommand(map, { rawArgs: ['--cwd', cwd, '--json', '--no-header', '--no-write'] })

    const raw = JSON.parse(out.join('').trim()) as {
      schemaVersion: number
      environment: string
      map: { version: number, framework: string, routes: unknown[] }
      summary: { instrumented: number, partial: number, dark: number, exempt: number }
      mapPath: string | null
    }

    expect(raw.schemaVersion).toBe(SCHEMA_VERSION)
    expect(raw.environment).toBe(resolveCliEnvironment())
    expect(raw.map.framework).toBe('nuxt')
    expect(raw.mapPath).toBeNull()
    expect(raw.summary.instrumented + raw.summary.partial + raw.summary.dark + raw.summary.exempt)
      .toBe(raw.map.routes.length)
  })

  it('exits 1 when the score is below --min-score', async () => {
    const cwd = join(FIXTURES, 'nuxt-basic')
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await runCommand(map, { rawArgs: ['--cwd', cwd, '--json', '--no-header', '--no-write', '--min-score', '100'] })

    expect(process.exitCode).toBe(1)
  })

  it.each(['abc', '80oops', '-1', '101', '80.5'])('rejects --min-score %s instead of skipping the gate', async (value) => {
    const cwd = join(FIXTURES, 'nuxt-basic')
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await runCommand(map, { rawArgs: ['--cwd', cwd, '--json', '--no-header', '--no-write', '--min-score', value] })

    expect(process.exitCode).toBe(1)
    expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain('MAP_INVALID_MIN_SCORE')
  })

  it('rejects --min-score before it scans anything, so a bad gate costs nothing', async () => {
    const cwd = await copyFixture('nuxt-basic')
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    /* `--write` is on: reaching the writer at all would leave the file behind. */
    await runCommand(map, { rawArgs: ['--cwd', cwd, '--json', '--no-header', '--min-score', 'abc'] })

    expect(existsSync(join(cwd, 'evlog.map.json'))).toBe(false)
  })

  it('refuses a --baseline written by a different rule set (exit 2) instead of diffing', async () => {
    const cwd = await copyFixture('nuxt-basic')
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await writeFile(join(cwd, 'evlog.map.json'), JSON.stringify({
      version: 1,
      generatedAt: '2026-01-01T00:00:00.000Z',
      cliVersion: '0.3.0',
      ruleSetVersion: RULE_SET_VERSION - 1,
      framework: 'nuxt',
      projectName: 'test',
      score: 100,
      routes: [],
    }), 'utf8')

    await runCommand(map, { rawArgs: ['--cwd', cwd, '--json', '--no-header', '--no-write', '--baseline'] })

    /* A stale rule set is a usage error, not a check failure. */
    expect(process.exitCode).toBe(2)
  })

  it('leaves the exit code untouched without --min-score', async () => {
    const cwd = join(FIXTURES, 'nuxt-basic')
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await runCommand(map, { rawArgs: ['--cwd', cwd, '--json', '--no-header', '--no-write'] })

    expect(process.exitCode).toBeUndefined()
  })
})

describe('map --format', () => {
  function captureStdout(): string[] {
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      out.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
      return true
    }) as typeof process.stdout.write)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    return out
  }

  it('github: one warning per failing requirement and a notice with the score', async () => {
    const cwd = join(FIXTURES, 'hono-basic')
    const out = captureStdout()

    await runCommand(map, { rawArgs: ['--cwd', cwd, '--format', 'github', '--no-header', '--no-write'] })

    const lines = out.join('').trim().split('\n')
    expect(lines.filter(line => line.startsWith('::warning file=src/health.ts,line=5,title=evlog map%3A wide-event::'))).toHaveLength(1)
    expect(lines.some(line => line.startsWith('::error'))).toBe(false)
    expect(lines.at(-1)).toMatch(/^::notice title=evlog map::score \d+\/100 \(/)
    expect(process.exitCode).toBeUndefined()
  })

  it('github: without a baseline, the warnings follow the FIX FIRST order and stop at --limit', async () => {
    const cwd = join(FIXTURES, 'nuxt-basic')
    const out = captureStdout()

    await runCommand(map, { rawArgs: ['--cwd', cwd, '--format', 'github', '--limit', '2', '--no-header', '--no-write'] })

    const lines = out.join('').trim().split('\n')
    const warnings = lines.filter(line => line.startsWith('::warning'))
    expect(warnings).toHaveLength(2)
    /* The sensitive payments route outranks every plain dark handler. */
    expect(warnings[0]).toContain('file=server/api/payments/stripe.post.ts,')
    expect(lines.at(-1)).toMatch(/^::notice title=evlog map::score \d+\/100 .*; \d+ more findings not shown$/)
  })

  it('github: keeps ten findings by default, which is what GitHub keeps', async () => {
    const cwd = join(FIXTURES, 'nuxt-basic')
    const out = captureStdout()

    await runCommand(map, { rawArgs: ['--cwd', cwd, '--format', 'github', '--no-header', '--no-write'] })

    expect(out.join('').trim().split('\n').filter(line => line.startsWith('::warning'))).toHaveLength(10)
  })

  it('github: with a baseline, only the regressions are emitted, as errors', async () => {
    const cwd = await copyFixture('nuxt-basic')
    const scanned = captureStdout()
    await runCommand(map, { rawArgs: ['--cwd', cwd, '--json', '--no-header', '--no-write'] })
    const { map: current } = JSON.parse(scanned.join('')) as { map: MapFile }

    /* A baseline in which the health route passed wide-event: the scan now fails it, so that is the one regression. */
    const health = current.routes.find(route => route.file === 'server/routes/health.get.ts')!
    health.checks['wide-event'] = { ...health.checks['wide-event'], status: 'pass' }
    await writeFile(join(cwd, 'evlog.map.json'), JSON.stringify(current))
    vi.restoreAllMocks()
    const out = captureStdout()

    await runCommand(map, { rawArgs: ['--cwd', cwd, '--format', 'github', '--baseline', '--no-header', '--no-write'] })

    const lines = out.join('').trim().split('\n')
    expect(lines.filter(line => line.startsWith('::warning'))).toHaveLength(0)
    expect(lines.filter(line => line.startsWith('::error file='))).toEqual([expect.stringMatching(/^::error file=server\/routes\/health\.get\.ts,line=\d+,title=evlog map%3A wide-event::/),])
    expect(lines.at(-1)).toMatch(/^::error title=evlog map::score .*; regressed against /)
    expect(process.exitCode).toBe(1)
  })

  it.each(['0', 'abc', '2.5'])('rejects --limit %s instead of falling back to the default', async (value) => {
    const cwd = join(FIXTURES, 'hono-basic')
    const out = captureStdout()

    await runCommand(map, { rawArgs: ['--cwd', cwd, '--json', '--limit', value, '--no-header', '--no-write'] })

    expect(JSON.parse(out.join('')).error.code).toBe('cli.MAP_INVALID_LIMIT')
    expect(process.exitCode).toBe(1)
  })

  it('github: paths are rebased on GITHUB_WORKSPACE when the project is a package inside it', async () => {
    const cwd = join(FIXTURES, 'hono-basic')
    vi.stubEnv('GITHUB_WORKSPACE', resolve(FIXTURES, '../../..'))
    const out = captureStdout()

    try {
      await runCommand(map, { rawArgs: ['--cwd', cwd, '--format', 'github', '--no-header', '--no-write'] })
    } finally {
      vi.unstubAllEnvs()
    }

    expect(out.join('')).toMatch(/^::warning file=test\/map\/fixtures\/hono-basic\/src\/health\.ts,line=5,/m)
  })

  it('github: a score under --min-score is an error and exits 1', async () => {
    const cwd = join(FIXTURES, 'hono-basic')
    const out = captureStdout()

    await runCommand(map, { rawArgs: ['--cwd', cwd, '--format', 'github', '--min-score', '100', '--no-header', '--no-write'] })

    expect(out.join('')).toMatch(/^::error title=evlog map::score \d+\/100 .*below --min-score 100$/m)
    expect(process.exitCode).toBe(1)
  })

  it('refuses --json together with another --format', async () => {
    const cwd = join(FIXTURES, 'hono-basic')
    const out = captureStdout()

    await runCommand(map, { rawArgs: ['--cwd', cwd, '--json', '--format', 'github', '--no-header', '--no-write'] })

    expect(JSON.parse(out.join('')).error.code).toBe('cli.MAP_FORMAT_CONFLICT')
    expect(process.exitCode).toBe(1)
  })
})
