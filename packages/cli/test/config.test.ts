import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCommand } from 'citty'
import { afterEach, describe, expect, it, vi } from 'vitest'
import configCommand, { configJson, formatConfigReport, runConfig } from '../src/commands/config'
import { runDoctor } from '../src/commands/doctor'
import { runLogs } from '../src/commands/logs'
import map, { formatMapReport, runMap } from '../src/commands/map'
import { createContext } from '../src/core/context'
import type { CliContext } from '../src/core/context'
import { loadCliConfig, RuntimeValue } from '../src/lib/config'
import { cliErrors } from '../src/lib/errors'
import { RULE_OFF_MESSAGE } from '../src/lib/map/rules/index'
import { resolveProject } from '../src/lib/project'

const FIXTURES = join(import.meta.dirname, 'map/fixtures')
const tempDirs: string[] = []

async function makeProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'evlog-cli-config-'))
  tempDirs.push(dir)
  await writeFiles(dir, files)
  return dir
}

async function writeFiles(dir: string, files: Record<string, string>): Promise<void> {
  for (const [path, contents] of Object.entries(files)) {
    const full = join(dir, path)
    await mkdir(join(full, '..'), { recursive: true })
    await writeFile(full, contents, 'utf-8')
  }
}

async function copyFixture(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `evlog-cli-config-${name}-`))
  tempDirs.push(dir)
  await cp(join(FIXTURES, name), dir, { recursive: true })
  return dir
}

function fakeContext(cwd: string): CliContext {
  return createContext({ cwd, env: {}, nodeVersion: 'v22.0.0', tty: false, color: false, columns: 120 })
}

async function load(cwd: string) {
  return loadCliConfig(await resolveProject(cwd))
}

function silence(): { stdout: () => string, stderr: () => string } {
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  return {
    stdout: () => stdout.mock.calls.map(([chunk]) => String(chunk)).join(''),
    stderr: () => stderr.mock.calls.map(([chunk]) => String(chunk)).join(''),
  }
}

const PACKAGE = JSON.stringify({ name: 'shop' })

/** A preset and a config extending it, with the lines the assertions point at. */
const EXTENDED = {
  'package.json': PACKAGE,
  'evlog.preset.ts': `import { defineEvlog } from 'evlog'

export default defineEvlog({
  sampling: { rates: { info: 10, debug: 0 } },
  redact: { paths: ['user.password'] },
  map: { rules: { 'audit': 'off', 'error-catalog': 'off' }, minScore: 90 },
})
`,
  'evlog.config.ts': `import { defineEvlog } from 'evlog'
import preset from './evlog.preset'

export default defineEvlog({
  extends: preset,
  sampling: { rates: { info: 50 } },
  redact: { paths: ['card.number'] },
  map: { rules: { audit: 'on' } },
})
`,
}

afterEach(async () => {
  vi.restoreAllMocks()
  process.exitCode = undefined
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('evlog.config lookup', () => {
  it('returns null when no evlog.config applies', async () => {
    const cwd = await makeProject({ 'package.json': PACKAGE })
    expect(await load(cwd)).toBeNull()
  })

  it('reads map and logs settings from a literal config', async () => {
    const cwd = await makeProject({
      'package.json': PACKAGE,
      'evlog.config.ts': `import { defineEvlog } from 'evlog'

export default defineEvlog({
  service: 'shop',
  map: {
    rules: { 'audit': 'off', 'error-catalog': 'off' },
    ignore: ['server/api/internal/**'],
    minScore: 80,
    baseline: 'git:main',
  },
  logs: { dir: 'var/logs', limit: 20 },
})
`,
    })
    const project = await resolveProject(cwd)
    const config = loadCliConfig(project)

    expect([...config!.map.off]).toEqual(['audit', 'error-catalog'])
    expect(config!.map.ignore).toEqual(['server/api/internal/**'])
    expect(config!.map.minScore).toBe(80)
    expect(config!.map.baseline).toBe('git:main')
    expect(config!.logs).toEqual({ dir: join(project.packageDir, 'var/logs'), limit: 20 })
    expect(config!.resolved.service).toBe('shop')
  })

  it.each([
    ['evlog.config.mjs', 'const config = { map: { minScore: 60 } }\nexport default config\n'],
    ['evlog.config.ts', 'import type { EvlogConfig } from \'evlog\'\n\nexport default { map: { minScore: 60 } } satisfies EvlogConfig\n'],
    ['evlog.config.ts', 'import { defineEvlog } from \'evlog\'\n\nconst config = defineEvlog({ map: { minScore: 60 } })\n\nexport default config\n'],
  ])('reads %s written as %j', async (name, source) => {
    const cwd = await makeProject({ 'package.json': PACKAGE, [name]: source })
    expect((await load(cwd))!.map.minScore).toBe(60)
  })

  it('follows consts and relative imports', async () => {
    const cwd = await makeProject({
      'package.json': PACKAGE,
      'evlog/map.ts': 'export const rules = { audit: \'off\' } as const\nexport const ignore = [\'server/tasks/**\']\n',
      'evlog.config.ts': `import { defineEvlog } from 'evlog'
import { ignore, rules } from './evlog/map'

const minScore = 75

export default defineEvlog({ map: { rules, ignore, minScore } })
`,
    })
    const config = await load(cwd)

    expect([...config!.map.off]).toEqual(['audit'])
    expect(config!.map.ignore).toEqual(['server/tasks/**'])
    expect(config!.map.minScore).toBe(75)
  })

  it('uses the nearest config on its own, without cascading', async () => {
    const root = await makeProject({
      'pnpm-workspace.yaml': 'packages:\n  - apps/*\n',
      'package.json': JSON.stringify({ name: 'mono', private: true }),
      'evlog.config.ts': 'export default { map: { minScore: 90 }, logs: { limit: 5 } }\n',
      'apps/web/package.json': JSON.stringify({ name: 'web' }),
      'apps/web/evlog.config.ts': 'export default { map: { minScore: 70 } }\n',
    })
    const config = await load(join(root, 'apps/web'))

    expect(config!.map.minScore).toBe(70)
    expect(config!.logs.limit).toBeUndefined()
  })

  it('applies a workspace root config to every app, with paths relative to the app', async () => {
    const root = await makeProject({
      'pnpm-workspace.yaml': 'packages:\n  - apps/*\n',
      'package.json': JSON.stringify({ name: 'mono', private: true }),
      'evlog.config.ts': 'export default { logs: { dir: \'.evlog/logs\' } }\n',
      'apps/web/package.json': JSON.stringify({ name: 'web' }),
    })
    const project = await resolveProject(join(root, 'apps/web'))

    expect(loadCliConfig(project)!.logs.dir).toBe(join(project.packageDir, '.evlog/logs'))
  })
})

describe('evlog.config extends', () => {
  it('merges the parent one level deep, the child winning', async () => {
    const cwd = await makeProject(EXTENDED)
    const config = await load(cwd)

    expect(config!.resolved.sampling).toEqual({ rates: { info: 50, debug: 0 } })
    expect(config!.resolved.redact).toEqual({ paths: ['user.password', 'card.number'] })
    expect([...config!.map.off]).toEqual(['error-catalog'])
    expect(config!.map.minScore).toBe(90)
    expect(config!.extends?.specifier).toBe('./evlog.preset')
    expect(config!.sources.get('map.minScore')).toBe('evlog.preset.ts:6')
    expect(config!.sources.get('map.rules.audit')).toBe('evlog.config.ts:8')
  })

  it('extends a preset published as a package', async () => {
    const cwd = await makeProject({
      'package.json': PACKAGE,
      'node_modules/@acme/evlog-preset/package.json': JSON.stringify({
        name: '@acme/evlog-preset',
        type: 'module',
        exports: { '.': { types: './dist/index.d.mts', import: './dist/index.mjs' } },
      }),
      'node_modules/@acme/evlog-preset/dist/index.mjs': `import { defineEvlog } from 'evlog'

const preset = defineEvlog({
  map: { rules: { 'ai-logging': 'off' }, ignore: ['server/tasks/**'] },
})

export { preset as default }
`,
      'evlog.config.ts': `import preset from '@acme/evlog-preset'
import { defineEvlog } from 'evlog'

export default defineEvlog({ extends: preset, map: { minScore: 70 } })
`,
    })
    const config = await load(cwd)

    expect([...config!.map.off]).toEqual(['ai-logging'])
    expect(config!.map.ignore).toEqual(['server/tasks/**'])
    expect(config!.map.minScore).toBe(70)
    expect(config!.extends?.specifier).toBe('@acme/evlog-preset')
    expect(config!.extends?.file.endsWith(join('dist', 'index.mjs'))).toBe(true)
  })

  it('refuses a parent that extends another config', async () => {
    const cwd = await makeProject({
      'package.json': PACKAGE,
      'evlog.base.ts': 'export default { map: { minScore: 50 } }\n',
      'evlog.preset.ts': 'import base from \'./evlog.base\'\n\nexport default { extends: base, map: { minScore: 60 } }\n',
      'evlog.config.ts': 'import preset from \'./evlog.preset\'\n\nexport default { extends: preset }\n',
    })

    await expect(load(cwd)).rejects.toMatchObject({
      code: cliErrors.CONFIG_EXTENDS_DEPTH.code,
      message: './evlog.preset extends another config, so evlog.config.ts:3 cannot extend it',
    })
  })

  it('names the import it cannot resolve', async () => {
    const cwd = await makeProject({
      'package.json': PACKAGE,
      'evlog.config.ts': 'import preset from \'@acme/missing\'\n\nexport default { extends: preset }\n',
    })

    await expect(load(cwd)).rejects.toMatchObject({
      code: cliErrors.CONFIG_EXTENDS_NOT_FOUND.code,
      message: 'Cannot resolve "@acme/missing", extended in evlog.config.ts:3',
    })
  })
})

describe('evlog.config validation', () => {
  it.each([
    ['map: { rules: { \'error-catalogue\': \'off\' } }', 'map.rules.error-catalogue'],
    ['map: { rules: { audit: false } }', 'map.rules.audit'],
    ['map: { rules: { \'wide-event\': \'off\' } }', 'map.ignore'],
    ['map: { minScore: 101 }', 'map.minScore'],
    ['map: { ignore: \'server/**\' }', 'map.ignore'],
    ['map: { baseline: false }', 'map.baseline'],
    ['map: { exclude: [] }', 'map.exclude'],
    ['logs: { limit: 0 }', 'logs.limit'],
  ])('refuses %s', async (body, mentioned) => {
    const cwd = await makeProject({ 'package.json': PACKAGE, 'evlog.config.ts': `export default { ${body} }\n` })

    const error = await load(cwd).catch((thrown: unknown) => thrown)
    expect(error).toMatchObject({ code: cliErrors.CONFIG_INVALID.code })
    expect((error as Error).message).toContain(mentioned)
    expect((error as Error).message).toContain('evlog.config.ts:1')
  })

  it('refuses a map or logs setting computed at runtime', async () => {
    const cwd = await makeProject({
      'package.json': PACKAGE,
      'evlog.config.ts': 'export default {\n  map: { minScore: Number(process.env.MIN_SCORE) },\n}\n',
    })

    await expect(load(cwd)).rejects.toMatchObject({
      code: cliErrors.CONFIG_NOT_STATIC.code,
      message: 'map.minScore in evlog.config.ts:2 is computed at runtime',
    })
  })

  it('keeps settings computed at runtime outside map and logs', async () => {
    const cwd = await makeProject({
      'package.json': PACKAGE,
      'evlog.config.ts': `import { createAxiomDrain } from 'evlog/axiom'
import { defineEvlog } from 'evlog'

export default defineEvlog({
  service: process.env.SERVICE_NAME,
  drain: createAxiomDrain(),
  redact: { patterns: [/acct_\\w+/g] },
  map: { minScore: 50 },
})
`,
    })
    const config = await load(cwd)

    expect(config!.resolved.service).toEqual(new RuntimeValue('process.env.SERVICE_NAME'))
    expect(config!.resolved.drain).toEqual(new RuntimeValue('createAxiomDrain()'))
    expect((config!.resolved.redact as { patterns: RegExp[] }).patterns).toEqual([/acct_\w+/g])
    expect(config!.map.minScore).toBe(50)
  })

  it('refuses a file without a default export', async () => {
    const cwd = await makeProject({ 'package.json': PACKAGE, 'evlog.config.ts': 'export const config = {}\n' })
    await expect(load(cwd)).rejects.toMatchObject({ code: cliErrors.CONFIG_NO_EXPORT.code })
  })

  it('refuses a file that does not parse', async () => {
    const cwd = await makeProject({ 'package.json': PACKAGE, 'evlog.config.ts': 'export default {\n' })
    await expect(load(cwd)).rejects.toMatchObject({ code: cliErrors.CONFIG_PARSE_FAILED.code })
  })
})

describe('evlog map with evlog.config', () => {
  it('turns a check off for every entry point and leaves ignored entry points out', async () => {
    const cwd = await copyFixture('nuxt-basic')
    const before = await runMap(fakeContext(cwd), undefined, { noWrite: true })
    const docs = before.scan.map.routes.filter(route => route.file.startsWith('server/api/docs/'))
    expect(docs.length).toBeGreaterThan(0)
    expect(before.scan.map.routes.some(route => route.checks['structured-errors']?.status === 'fail')).toBe(true)

    await writeFile(join(cwd, 'evlog.config.ts'), `export default {
  map: { rules: { 'structured-errors': 'off' }, ignore: ['server/api/docs/**'] },
}
`)
    const after = await runMap(fakeContext(cwd), undefined, { noWrite: true })

    expect(after.scan.ignored).toBe(docs.length)
    expect(after.scan.map.routes).toHaveLength(before.scan.map.routes.length - docs.length)
    expect(after.scan.map.routes.some(route => route.file.startsWith('server/api/docs/'))).toBe(false)
    for (const route of after.scan.map.routes) {
      if (route.checks['structured-errors']) {
        expect(route.checks['structured-errors']).toEqual({ status: 'n/a', message: RULE_OFF_MESSAGE })
      }
    }
    expect(formatMapReport(fakeContext(cwd), after)).toContain(
      `evlog.config.ts: structured-errors off, ${docs.length} entry point${docs.length === 1 ? '' : 's'} ignored`,
    )
  })

  it('gates on the config minScore, and --min-score wins over it', async () => {
    const cwd = await copyFixture('nuxt-basic')
    await writeFile(join(cwd, 'evlog.config.ts'), 'export default { map: { minScore: 100 } }\n')
    const out = silence()

    await runCommand(map, { rawArgs: ['--cwd', cwd, '--no-header', '--no-write'] })
    expect(process.exitCode).toBe(1)
    expect(out.stderr()).toMatch(/score \d+ is below map\.minScore 100/)

    process.exitCode = undefined
    await runCommand(map, { rawArgs: ['--cwd', cwd, '--no-header', '--no-write', '--min-score', '0'] })
    expect(process.exitCode).toBeUndefined()
    expect(out.stderr()).toMatch(/score \d+ meets --min-score 0/)
  })

  it('names map.minScore in the GitHub annotation it fails on', async () => {
    const cwd = await copyFixture('nuxt-basic')
    await writeFile(join(cwd, 'evlog.config.ts'), 'export default { map: { minScore: 100 } }\n')
    const out = silence()

    await runCommand(map, { rawArgs: ['--cwd', cwd, '--format', 'github', '--no-header', '--no-write'] })

    expect(process.exitCode).toBe(1)
    expect(out.stdout()).toMatch(/^::error title=evlog map::score \d+\/100 .*below map\.minScore 100$/m)
  })

  it('fails on an invalid config before it scans anything', async () => {
    const cwd = await copyFixture('nuxt-basic')
    await writeFile(join(cwd, 'evlog.config.ts'), 'export default { map: { minScore: \'high\' } }\n')
    const out = silence()

    await runCommand(map, { rawArgs: ['--cwd', cwd, '--json', '--no-header'] })

    expect(process.exitCode).toBe(1)
    expect(out.stdout()).toContain('CONFIG_INVALID')
  })
})

describe('evlog logs with evlog.config', () => {
  const line = (index: number): string => JSON.stringify({
    timestamp: `2026-10-01T10:0${index}:00.000Z`,
    level: 'info',
    method: 'GET',
    path: `/api/items/${index}`,
    status: 200,
    durationMs: 5,
    requestId: `00000000-0000-4000-8000-00000000000${index}`,
  })

  it('reads logs.dir and logs.limit, the flags winning', async () => {
    const cwd = await makeProject({
      'package.json': PACKAGE,
      'evlog.config.ts': 'export default { logs: { dir: \'var/events\', limit: 2 } }\n',
      'var/events/2026-10-01.jsonl': `${[1, 2, 3, 4].map(line).join('\n')}\n`,
    })
    const now = new Date('2026-10-01T12:00:00.000Z')

    expect((await runLogs(fakeContext(cwd), {}, { now })).events).toHaveLength(2)
    expect((await runLogs(fakeContext(cwd), { limit: '3' }, { now })).events).toHaveLength(3)
    await expect(runLogs(fakeContext(cwd), {}, { now, dir: join(cwd, 'elsewhere') })).rejects.toThrow()
  })
})

describe('evlog doctor with evlog.config', () => {
  it('names the config and what it extends', async () => {
    const cwd = await makeProject(EXTENDED)
    const result = await runDoctor(fakeContext(cwd))

    expect(result.checks.find(check => check.id === 'config')).toEqual({
      id: 'config',
      status: 'ok',
      message: 'evlog.config.ts',
      hint: 'extends ./evlog.preset',
    })
    expect(result.sections.find(section => section.title === 'EVLOG')?.checks.map(check => check.id)).toContain('config')
  })

  it('fails the check with the reader\'s error and fix', async () => {
    const cwd = await makeProject({ 'package.json': PACKAGE, 'evlog.config.ts': 'export default { logs: { limit: -1 } }\n' })
    const result = await runDoctor(fakeContext(cwd))

    expect(result.checks.find(check => check.id === 'config')).toMatchObject({
      status: 'fail',
      message: 'logs.limit in evlog.config.ts:1 must be a whole number of 1 or more',
    })
    expect(result.summary.fail).toBeGreaterThan(0)
  })

  it('says nothing when there is no config', async () => {
    const cwd = await makeProject({ 'package.json': PACKAGE })
    const result = await runDoctor(fakeContext(cwd))
    expect(result.checks.find(check => check.id === 'config')).toBeUndefined()
  })
})

describe('evlog config', () => {
  it('splits CLI and app settings, each with where it is written', async () => {
    const cwd = await makeProject(EXTENDED)
    const result = await runConfig(fakeContext(cwd))

    expect(result.file).toBe('evlog.config.ts')
    expect(result.extends).toEqual({ specifier: './evlog.preset', file: 'evlog.preset.ts' })
    expect(result.cli).toContainEqual({ path: 'map.minScore', value: 90, source: 'evlog.preset.ts:6' })
    expect(result.cli).toContainEqual({ path: 'map.rules.audit', value: 'on', source: 'evlog.config.ts:8' })
    expect(result.app).toContainEqual({ path: 'sampling.rates.info', value: 50, source: 'evlog.config.ts:6' })
    expect(result.app).toContainEqual({ path: 'sampling.rates.debug', value: 0, source: 'evlog.preset.ts:4' })
    expect(result.app).toContainEqual({ path: 'redact.paths', value: ['user.password', 'card.number'], source: 'evlog.config.ts:7' })
  })

  it('renders the settings in columns under who applies them', async () => {
    const cwd = await makeProject(EXTENDED)
    const report = formatConfigReport(fakeContext(cwd), await runConfig(fakeContext(cwd)))

    expect(report).toContain('evlog.config.ts · extends ./evlog.preset → evlog.preset.ts')
    expect(report).toMatch(/^CLI · applied by evlog map and evlog logs$/m)
    expect(report).toMatch(/^APP · applied by the app at runtime$/m)
    expect(report).toMatch(/^ {2}map\.minScore +90 +evlog\.preset\.ts:6$/m)
  })

  it('writes regexps and runtime values in a JSON-safe form', async () => {
    const cwd = await makeProject({
      'package.json': PACKAGE,
      'evlog.config.ts': 'import { createAxiomDrain } from \'evlog/axiom\'\n\nexport default { drain: createAxiomDrain(), redact: { patterns: [/acct_\\w+/g] } }\n',
    })
    const json = JSON.parse(JSON.stringify(configJson(await runConfig(fakeContext(cwd))))) as { app: { path: string, value: unknown }[] }

    expect(json.app).toContainEqual(expect.objectContaining({ path: 'drain', value: { runtime: 'createAxiomDrain()' } }))
    expect(json.app).toContainEqual(expect.objectContaining({ path: 'redact.patterns', value: [{ regexp: '/acct_\\w+/g' }] }))
  })

  it('says where it looked when there is no config', async () => {
    const cwd = await makeProject({ 'package.json': PACKAGE })
    const result = await runConfig(fakeContext(cwd))

    expect(result.file).toBeNull()
    expect(formatConfigReport(fakeContext(cwd), result)).toContain('No evlog.config from .')
  })

  it('exits 1 with the catalog error on a config it cannot read', async () => {
    const cwd = await makeProject({ 'package.json': PACKAGE, 'evlog.config.ts': 'export default { map: { minScore: 101 } }\n' })
    const out = silence()

    await runCommand(configCommand, { rawArgs: ['--cwd', cwd, '--json', '--no-header'] })

    expect(process.exitCode).toBe(1)
    expect(JSON.parse(out.stdout())).toMatchObject({ error: { code: cliErrors.CONFIG_INVALID.code } })
  })
})
