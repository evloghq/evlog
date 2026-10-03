import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import doctor, { formatDoctorReport, runDoctor } from '../src/commands/doctor'
import { createContext } from '../src/core/context'
import type { CliContext } from '../src/core/context'
import { SCHEMA_VERSION } from '../src/core/output'
import { resolveCliEnvironment } from '../src/lib/environment'

const tempDirs: string[] = []

async function makeProject(files: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'evlog-cli-doctor-'))
  tempDirs.push(dir)
  for (const [path, contents] of Object.entries(files)) {
    const full = join(dir, path)
    await mkdir(join(full, '..'), { recursive: true })
    await writeFile(full, contents, 'utf-8')
  }
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

describe('runDoctor', () => {
  it('reports a healthy single-package project', async () => {
    const cwd = await makeProject({
      'package.json': JSON.stringify({ name: 'app', dependencies: { evlog: '^2.0.0' } }),
      'node_modules/evlog/package.json': JSON.stringify({ name: 'evlog', version: '2.22.0' }),
      '.evlog/logs/2026-07-17.jsonl': '{"event":"request"}\n',
    })

    const result = await runDoctor(fakeContext(cwd))

    expect(result.summary.fail).toBe(0)
    expect(result.checks.find(c => c.id === 'evlog')?.status).toBe('ok')
    expect(result.checks.find(c => c.id === 'evlog')?.message).toContain('2.22.0')
    expect(result.checks.find(c => c.id === 'logs')?.status).toBe('ok')
    expect(result.project.kind).toBe('single')
  })

  it('resolves evlog from a pnpm workspace root when run in a child package', async () => {
    const root = await makeProject({
      'pnpm-workspace.yaml': 'packages:\n  - apps/*\n',
      'package.json': JSON.stringify({ name: 'monorepo', private: true }),
      'apps/web/package.json': JSON.stringify({
        name: 'web',
        dependencies: { nuxt: '^3.0.0', evlog: 'workspace:*' },
      }),
      'node_modules/evlog/package.json': JSON.stringify({ name: 'evlog', version: '2.22.0' }),
    })
    const cwd = join(root, 'apps/web')

    const result = await runDoctor(fakeContext(cwd))

    expect(result.project.kind).toBe('pnpm')
    expect(result.project.name).toBe('web')
    expect(result.checks.find(c => c.id === 'evlog')?.status).toBe('ok')
    expect(result.checks.find(c => c.id === 'stack')?.message).toContain('nuxt')
  })

  it('finds .evlog/logs at the workspace root from a child cwd', async () => {
    const root = await makeProject({
      'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
      'package.json': JSON.stringify({ name: 'mono', private: true }),
      'packages/app/package.json': JSON.stringify({ name: 'app', dependencies: { evlog: '^2.0.0' } }),
      'node_modules/evlog/package.json': JSON.stringify({ name: 'evlog', version: '2.22.0' }),
      '.evlog/logs/2026-07-17.jsonl': '{"event":"request"}\n',
    })

    const result = await runDoctor(fakeContext(join(root, 'packages/app')))
    const logs = result.checks.find(c => c.id === 'logs')
    expect(logs?.status).toBe('ok')
    expect(logs?.message).toContain('1 file')
  })

  it('reports an empty sink as present once the directory exists', async () => {
    /* The fs drain only writes `.jsonl` files on first emit; an empty sink
       directory is still a sink. */
    const cwd = await makeProject({
      'package.json': JSON.stringify({ name: 'app', dependencies: { evlog: '^2.0.0' } }),
      'node_modules/evlog/package.json': JSON.stringify({ name: 'evlog', version: '2.22.0' }),
    })
    await mkdir(join(cwd, '.evlog', 'logs'), { recursive: true })

    const result = await runDoctor(fakeContext(cwd))
    const logs = result.checks.find(c => c.id === 'logs')
    expect(logs?.status).toBe('ok')
    expect(logs?.message).toContain('empty sink')
  })

  it('treats a wired fs drain as a sink before the first event', async () => {
    /* `evlog init` writes the drain plugin; the fs drain creates `.evlog/logs`
       lazily on first write, so a wired drain is a sink even with no files. */
    const cwd = await makeProject({
      'package.json': JSON.stringify({ name: 'app', dependencies: { evlog: '^2.0.0' } }),
      'node_modules/evlog/package.json': JSON.stringify({ name: 'evlog', version: '2.22.0' }),
      'server/plugins/evlog-drain.ts': `import { createFsDrain } from 'evlog/fs'
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('evlog:drain', createFsDrain())
})
`,
    })

    const result = await runDoctor(fakeContext(cwd))
    const logs = result.checks.find(c => c.id === 'logs')
    expect(logs?.status).toBe('ok')
    expect(logs?.message).toContain('empty sink')
  })

  it('omits the logs check when no local drain is wired', async () => {
    /* The fs drain is optional: a project with no local sink and no drain
       wiring gets no `logs` check, not a warning. */
    const cwd = await makeProject({
      'package.json': JSON.stringify({ name: 'app', dependencies: { evlog: '^2.0.0' } }),
      'node_modules/evlog/package.json': JSON.stringify({ name: 'evlog', version: '2.22.0' }),
    })

    const result = await runDoctor(fakeContext(cwd))
    expect(result.checks.find(c => c.id === 'logs')).toBeUndefined()
    expect(result.summary.warn).toBe(0)
  })

  it('reads the fs drain directory from the environment', async () => {
    const cwd = await makeProject({
      'package.json': JSON.stringify({ name: 'app', dependencies: { evlog: '^2.0.0' } }),
      'node_modules/evlog/package.json': JSON.stringify({ name: 'evlog', version: '2.22.0' }),
    })

    const result = await runDoctor(fakeContext(cwd, { env: { EVLOG_FS_DIR: 'var/evlog' } }))
    const logs = result.checks.find(c => c.id === 'logs')
    expect(logs?.status).toBe('ok')
    expect(logs?.message).toContain('var/evlog')
  })

  it('fails on unsupported Node versions', async () => {
    const cwd = await makeProject({ 'package.json': '{}' })
    const result = await runDoctor(fakeContext(cwd, { nodeVersion: 'v18.19.0' }))

    const node = result.checks.find(c => c.id === 'node')
    expect(node?.status).toBe('fail')
    expect(result.summary.fail).toBeGreaterThan(0)
  })

  it('records steps + catalog findings on the debug logger', async () => {
    const cwd = await makeProject({
      'package.json': JSON.stringify({ name: 'app', devDependencies: { evlog: '^2.0.0' } }),
    })
    const { createCliDebug, createCliLogger, ensureCliDebugLogger } = await import('../src/lib/debug')
    ensureCliDebugLogger({ json: true })
    const raw = createCliLogger({ command: 'doctor' })
    const log = createCliDebug(raw)

    const result = await runDoctor(fakeContext(cwd), log)
    expect(result.checks.find(c => c.id === 'evlog')?.status).toBe('warn')

    const ctx = raw.getContext()
    expect(ctx.steps).toEqual(['resolveProject', 'resolveEvlog', 'detectStack', 'checks', 'done'])
    expect(Array.isArray(ctx.resolveTried)).toBe(true)

    const findings = ctx.findings as Array<{ code: string }> | undefined
    expect(findings?.some(f => f.code === 'cli.EVLOG_DECLARED_NOT_INSTALLED')).toBe(true)
    /* No drain wiring, no local sink required: the logs check stays silent. */
    expect(findings?.some(f => f.code === 'cli.LOGS_SINK_MISSING')).toBe(false)
  })

  it('warns outside a Node project', async () => {
    const cwd = await makeProject()
    const result = await runDoctor(fakeContext(cwd))
    expect(result.checks.find(c => c.id === 'project')?.status).toBe('warn')
    expect(result.summary.fail).toBe(0)
  })

  it('keeps the --json schema contract', async () => {
    const cwd = await makeProject({
      'package.json': JSON.stringify({ name: 'app', dependencies: { evlog: '^2.0.0' } }),
      'node_modules/evlog/package.json': JSON.stringify({ name: 'evlog', version: '2.22.0' }),
      '.evlog/logs/2026-07-17.jsonl': '{"event":"request"}\n',
    })

    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      out.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
      return true
    }) as typeof process.stdout.write)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await doctor.run!({
      args: { _: [] as string[], json: true, noHeader: true, cwd, debug: false },
      rawArgs: [],
      cmd: doctor,
      data: {},
    })

    const raw = JSON.parse(out.join('').trim()) as {
      schemaVersion: number
      environment: string
      project: {
        kind: string
        name: string | null
        stack: string[]
        cwd: string
        root: string
        packageDir: string
      }
      checks: Array<{ id: string, status: string, message: string, hint?: string }>
      summary: { ok: number, warn: number, fail: number }
    }

    expect(raw.schemaVersion).toBe(SCHEMA_VERSION)
    expect(raw.environment).toBe(resolveCliEnvironment())
    expect(raw.project.cwd).toBe(cwd)
    expect(raw.project.root).toBe(cwd)
    expect(raw.project.packageDir).toBe(cwd)

    // Stable contract fields (paths asserted above; node message follows the host).
    expect({
      schemaVersion: raw.schemaVersion,
      environment: raw.environment,
      project: {
        kind: raw.project.kind,
        name: raw.project.name,
        stack: raw.project.stack,
      },
      checks: raw.checks.map(({ id, status, message }) => ({ id, status, message })),
      summary: raw.summary,
    }).toEqual({
      schemaVersion: SCHEMA_VERSION,
      environment: resolveCliEnvironment(),
      project: {
        kind: 'single',
        name: 'app',
        stack: [],
      },
      checks: [
        { id: 'node', message: process.version, status: 'ok' },
        { id: 'project', message: 'app', status: 'ok' },
        { id: 'evlog', message: 'v2.22.0 (^2.0.0)', status: 'ok' },
        { id: 'logs', message: '1 file · .evlog/logs', status: 'ok' },
      ],
      summary: { fail: 0, ok: 4, warn: 0 },
    })
  })
})

describe('formatDoctorReport', () => {
  it('renders sections without ANSI in plain mode', async () => {
    const cwd = await makeProject({
      'package.json': JSON.stringify({ name: 'app', dependencies: { evlog: '^2.0.0' } }),
      'node_modules/evlog/package.json': JSON.stringify({ name: 'evlog', version: '2.22.0' }),
    })
    const ctx = fakeContext(cwd)
    const result = await runDoctor(ctx)
    const out = formatDoctorReport(ctx, result)

    expect(out).not.toContain('\x1B')
    expect(out).toContain('ENVIRONMENT')
    expect(out).toContain('EVLOG')
    expect(out).toContain('docs')
  })
})
