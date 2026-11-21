import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCommand } from 'citty'
import { afterEach, describe, expect, it, vi } from 'vitest'
import init from '../src/commands/init'
import { createContext } from '../src/core/context'
import { VERSION } from '../src/lib/constants'
import type { CliContext } from '../src/core/context'
import { readConfig, RuntimeValue } from '../src/lib/config/read'
import { formatInitReport } from '../src/lib/init/report'
import { configuredService, planWiring } from '../src/lib/init/wiring'
import type { FileAction, WiringPlan } from '../src/lib/init/wiring'
import type { DrainId } from '../src/lib/init/catalog'
import { unifiedDiff } from '../src/lib/init/diff'
import { detectPackageManager, evlogPackageSpec, installCommand } from '../src/lib/init/pm'
import { detectEvlogMajor, detectNitroMajor, runInit } from '../src/lib/init/run'
import { EVE_INSTRUMENTATION } from '../src/lib/setup-eve'
import { parseSource } from '../src/lib/map/parse'

/** Only the spawn is faked; the rest of the skills module stays real. */
const skills = vi.hoisted(() => ({
  spawnResult: null as null | { ok: true } | { ok: false, error: string },
  calls: 0,
}))

vi.mock('../src/lib/agents/skills', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/agents/skills')>()
  return {
    ...actual,
    runSkills: (...args: Parameters<typeof actual.runSkills>) => {
      skills.calls += 1
      return skills.spawnResult ? Promise.resolve(skills.spawnResult) : actual.runSkills(...args)
    },
  }
})

/** Never spawns a package manager: a test that forgot `--no-install` would run a real `npm install` in its scratch project. */
const installs = vi.hoisted(() => ({
  result: { ok: true } as { ok: true } | { ok: false, error: string },
  calls: [] as string[],
  packages: [] as readonly string[],
}))

vi.mock('../src/lib/init/pm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/init/pm')>()
  return {
    ...actual,
    runInstall: (manager: string, _cwd: string, packages: readonly string[] = []) => {
      installs.calls.push(manager)
      installs.packages = packages
      return Promise.resolve(installs.result)
    },
  }
})

const tempDirs: string[] = []

async function project(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'evlog-cli-init-'))
  tempDirs.push(dir)
  for (const [path, contents] of Object.entries(files)) {
    const target = join(dir, path)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, contents, 'utf8')
  }
  return dir
}

/** An empty home, so globally installed skills cannot sway a run. */
function fakeContext(cwd: string): CliContext {
  return createContext({
    cwd,
    home: join(cwd, '__home'),
    env: {},
    nodeVersion: 'v22.0.0',
    tty: false,
    color: false,
    columns: 80,
  })
}


/** Wiring defaults, so each case states only what it is about. */
function wiring(overrides: Partial<Parameters<typeof planWiring>[0]> = {}) {
  return {
    devDrain: 'fs' as const,
    prodDrains: [] as never[],
    extras: [] as never[],
    enrichers: [] as never[],
    sampling: 'all' as const,
    agentLogs: true,
    evlogMajor: 3 as const,
    repeatedErrors: [],
    auditGaps: [],
    ...overrides,
  }
}

function action(plan: WiringPlan, relative: string): FileAction {
  const found = plan.actions.find(candidate => candidate.relative === relative)
  if (!found) throw new Error(`no action for ${relative} in ${plan.actions.map(candidate => candidate.relative).join(', ')}`)
  return found
}

const DEFINE = `import { defineEvlog } from 'evlog'\n\n`

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  process.exitCode = undefined
  skills.spawnResult = null
  skills.calls = 0
  installs.result = { ok: true }
  installs.calls = []
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('planWiring — nuxt', () => {
  it('appends to an existing modules array without touching anything else', async () => {
    const root = await project({
      'package.json': '{"name":"shop"}',
      'nuxt.config.ts': `export default defineNuxtConfig({\n  // keep me\n  modules: ['@nuxt/ui'],\n  devtools: { enabled: true },\n})\n`,
    })

    const plan = await planWiring({ root, framework: 'nuxt', service: 'shop', ...wiring({ devDrain: 'none' }), nitroMajor: 3 })

    expect(plan.actions.map(candidate => candidate.relative)).toEqual(['evlog.config.ts', 'nuxt.config.ts'])
    /* The settings live in evlog.config.ts, so the Nuxt config only gains the module. */
    expect(action(plan, 'nuxt.config.ts').contents).toBe(
      `export default defineNuxtConfig({\n  // keep me\n  modules: ['@nuxt/ui', 'evlog/nuxt'],\n  devtools: { enabled: true },\n})\n`,
    )
  })

  it('adds the modules key when the config has none, after a last property with a trailing comma', async () => {
    const root = await project({
      'package.json': '{"name":"shop"}',
      'nuxt.config.ts': `export default defineNuxtConfig({\n  devtools: { enabled: true },\n})\n`,
    })

    const plan = await planWiring({ root, framework: 'nuxt', service: 'shop', ...wiring({ devDrain: 'none' }), nitroMajor: 3 })

    expect(action(plan, 'nuxt.config.ts').contents).toBe(
      `export default defineNuxtConfig({\n  devtools: { enabled: true },\n  modules: ['evlog/nuxt'],\n})\n`,
    )
  })

  it('adds the modules key when the config has none, after a last property without a trailing comma', async () => {
    const root = await project({
      'package.json': '{"name":"shop"}',
      'nuxt.config.ts': `export default defineNuxtConfig({\n  devtools: { enabled: true }\n})\n`,
    })

    const plan = await planWiring({ root, framework: 'nuxt', service: 'shop', ...wiring({ devDrain: 'none' }), nitroMajor: 3 })

    expect(action(plan, 'nuxt.config.ts').contents).toBe(
      `export default defineNuxtConfig({\n  devtools: { enabled: true },\n  modules: ['evlog/nuxt']\n})\n`,
    )
  })

  it('creates the Nuxt config when there is none', async () => {
    const root = await project({ 'package.json': '{"name":"shop"}' })

    const plan = await planWiring({ root, framework: 'nuxt', service: 'shop', ...wiring({ devDrain: 'none' }), nitroMajor: 3 })

    expect(action(plan, 'nuxt.config.ts')).toMatchObject({
      kind: 'create',
      contents: `export default defineNuxtConfig({\n  modules: ['evlog/nuxt'],\n})\n`,
    })
  })

  it('leaves a registered module and its evlog block alone, and says which one wins', async () => {
    const root = await project({
      'package.json': '{"name":"shop"}',
      'nuxt.config.ts': `export default defineNuxtConfig({\n  modules: ['evlog/nuxt'],\n  evlog: { env: { service: 'shop' } },\n})\n`,
    })

    const plan = await planWiring({ root, framework: 'nuxt', service: 'shop', ...wiring({ devDrain: 'none' }), nitroMajor: 3 })

    expect(plan.actions.map(candidate => candidate.relative)).toEqual(['evlog.config.ts'])
    expect(plan.already).toContain('nuxt.config.ts already registers evlog/nuxt')
    expect(plan.already).toContain('nuxt.config.ts already has an evlog block, and what it sets overrides evlog.config.ts')
  })

  it('hands back a snippet rather than guessing at a computed modules list', async () => {
    const root = await project({
      'package.json': '{"name":"shop"}',
      'nuxt.config.ts': `const mods = ['@nuxt/ui']\nexport default defineNuxtConfig({\n  modules: mods,\n})\n`,
    })

    const plan = await planWiring({ root, framework: 'nuxt', service: 'shop', ...wiring({ devDrain: 'none' }), nitroMajor: 3 })

    expect(plan.manual[0]).toMatchObject({ file: 'nuxt.config.ts', snippet: `'evlog/nuxt'` })
    expect(plan.actions.map(candidate => candidate.relative)).toEqual(['evlog.config.ts'])
  })
})

describe('planWiring — nitro', () => {
  it('adds the import alongside the module entry', async () => {
    const root = await project({
      'package.json': '{"name":"api"}',
      'nitro.config.ts': `import { defineConfig } from 'nitro'\n\nexport default defineConfig({\n  compatibilityDate: '2025-01-01',\n})\n`,
    })

    const plan = await planWiring({ root, framework: 'nitro', service: 'api', ...wiring({ devDrain: 'none' }), nitroMajor: 3 })
    const { contents } = action(plan, 'nitro.config.ts')

    expect(contents).toContain(`import evlog from 'evlog/nitro'`)
    expect(contents).toContain('modules: [evlog()]')
    expect(contents).not.toContain('service')
  })

  it('adds the default import to a config that imports something else from the module', async () => {
    const root = await project({
      'package.json': '{"name":"api"}',
      'nitro.config.ts': `import { defineConfig } from 'nitro'\nimport { evlogErrorHandler } from 'evlog/nitro'\n\nexport default defineConfig({\n  errorHandler: evlogErrorHandler,\n})\n`,
    })

    const plan = await planWiring({ root, framework: 'nitro', service: 'api', ...wiring({ devDrain: 'none' }), nitroMajor: 3 })
    const { contents } = action(plan, 'nitro.config.ts')

    expect(contents).toContain('modules: [evlog()]')
    expect(contents).toContain(`import evlog from 'evlog/nitro'`)
    expect(contents).toContain(`import { evlogErrorHandler } from 'evlog/nitro'`)
  })

  it('uses the v2 subpath and factory when the project is on nitropack', async () => {
    const root = await project({ 'package.json': '{"name":"api"}' })

    const plan = await planWiring({ root, framework: 'nitro', service: 'api', ...wiring({ devDrain: 'none' }), nitroMajor: 2 })
    const { contents } = action(plan, 'nitro.config.ts')

    expect(contents).toContain(`import evlog from 'evlog/nitro/v2'`)
    expect(contents).toContain('defineNitroConfig')
    expect(contents).toContain('modules: [evlog()]')
  })

  it('writes the evlog 2 subpaths when the project is on evlog 2', async () => {
    const root = await project({ 'package.json': '{"name":"api"}' })

    const nitro3 = await planWiring({ root, framework: 'nitro', service: 'api', ...wiring({ devDrain: 'none', evlogMajor: 2 }), nitroMajor: 3 })
    const nitropack = await planWiring({ root, framework: 'nitro', service: 'api', ...wiring({ devDrain: 'none', evlogMajor: 2 }), nitroMajor: 2 })

    expect(action(nitro3, 'nitro.config.ts').contents).toContain(`import evlog from 'evlog/nitro/v3'\n`)
    expect(action(nitropack, 'nitro.config.ts').contents).toContain(`import evlog from 'evlog/nitro'\n`)
  })

  it('says the module options win when the module is already registered', async () => {
    const root = await project({
      'package.json': '{"name":"api"}',
      'nitro.config.ts': `import { defineConfig } from 'nitro'\nimport evlog from 'evlog/nitro'\n\nexport default defineConfig({\n  modules: [evlog({ env: { service: 'api' } })],\n})\n`,
    })

    const plan = await planWiring({ root, framework: 'nitro', service: 'api', ...wiring({ devDrain: 'none' }), nitroMajor: 3 })

    expect(plan.actions.map(candidate => candidate.relative)).toEqual(['evlog.config.ts'])
    expect(plan.already).toContain('nitro.config.ts already registers the evlog module, and the options passed to it override evlog.config.ts')
  })

  it('turns on async context for tanstack start and asks for the error middleware', async () => {
    const root = await project({
      'package.json': '{"name":"start-app"}',
      'nitro.config.ts': `import { defineConfig } from 'nitro'\n\nexport default defineConfig({\n  experimental: {},\n})\n`,
    })

    const plan = await planWiring({ root, framework: 'tanstack-start', service: 'start-app', ...wiring({ devDrain: 'none' }), nitroMajor: 3 })

    expect(action(plan, 'nitro.config.ts').contents).toContain('asyncContext: true')
    expect(plan.manual[0]!.snippet).toContain(`import { evlogErrorHandler } from 'evlog/nitro'\n`)
  })

  it('imports the tanstack start error middleware from evlog/nitro/v3 on evlog 2', async () => {
    const root = await project({ 'package.json': '{"name":"start-app"}' })

    const plan = await planWiring({ root, framework: 'tanstack-start', service: 'start-app', ...wiring({ devDrain: 'none', evlogMajor: 2 }), nitroMajor: 3 })

    expect(plan.manual[0]!.snippet).toContain(`import { evlogErrorHandler } from 'evlog/nitro/v3'\n`)
  })
})

describe('planWiring — next', () => {
  it('writes instrumentation next to the app directory, not at the root', async () => {
    const root = await project({
      'package.json': '{"name":"web"}',
      'src/app/page.tsx': 'export default function Page() { return null }',
    })

    const files = (await planWiring({ root, framework: 'next', service: 'web', ...wiring({}), nitroMajor: 3 })).actions.map(a => a.relative)

    expect(files).toEqual(['evlog.config.ts', join('src', 'lib', 'evlog.ts'), join('src', 'instrumentation.ts')])
  })

  it('builds the instrumentation and the handler factory from the config', async () => {
    const root = await project({ 'package.json': '{"name":"web"}' })

    const plan = await planWiring({ root, framework: 'next', service: 'web', ...wiring({}), nitroMajor: 3 })
    const lib = action(plan, join('lib', 'evlog.ts')).contents

    expect(lib).toContain(`import config from '../evlog.config'`)
    expect(lib).toContain('...toLoggerConfig(config),')
    expect(lib).toContain('createEvlog(config)')
    /* The config can pull Node-only drains, so the Edge runtime never loads it. */
    expect(action(plan, 'instrumentation.ts').contents).toContain(`defineNodeInstrumentation(() => import('./lib/evlog'))`)
  })

  it('points the instrumentation at the lib file that is already there', async () => {
    const root = await project({
      'package.json': '{"name":"web"}',
      'app/lib/evlog.ts': `import config from '../../evlog.config'\n`,
    })

    const plan = await planWiring({ root, framework: 'next', service: 'web', ...wiring({ devDrain: 'none' }), nitroMajor: 3 })

    expect(action(plan, 'instrumentation.ts').contents).toContain(`import('./app/lib/evlog')`)
    expect(plan.manual.map(step => step.title)).not.toContain(`Read evlog.config.ts in ${join('app', 'lib', 'evlog.ts')}`)
  })

  it('leaves an existing instrumentation file alone and asks for it to load the config', async () => {
    const root = await project({
      'package.json': '{"name":"web"}',
      'instrumentation.ts': 'export function register() {}',
    })

    const plan = await planWiring({ root, framework: 'next', service: 'web', ...wiring({ devDrain: 'none' }), nitroMajor: 3 })

    expect(plan.actions.map(a => a.relative)).toEqual(['evlog.config.ts', join('lib', 'evlog.ts')])
    expect(plan.already).toContain('instrumentation.ts already exists')
    expect(plan.manual.find(step => step.title === 'Start the logger from evlog.config.ts')).toMatchObject({
      file: 'instrumentation.ts',
      snippet: expect.stringContaining(`import('./lib/evlog')`),
    })
  })

  it('stays quiet about an instrumentation file that already loads the lib', async () => {
    const root = await project({
      'package.json': '{"name":"web"}',
      'instrumentation.ts': `import { defineNodeInstrumentation } from 'evlog/next/instrumentation'\n\nexport const { register } = defineNodeInstrumentation(() => import('./lib/evlog'))\n`,
    })

    const plan = await planWiring({ root, framework: 'next', service: 'web', ...wiring({ devDrain: 'none' }), nitroMajor: 3 })

    expect(plan.manual.map(step => step.title)).not.toContain('Start the logger from evlog.config.ts')
  })
})

describe('runInit', () => {
  it('writes nothing under dry run and reports what it would do', async () => {
    const cwd = await project({
      'package.json': '{"name":"@acme/shop","dependencies":{"nuxt":"^4.0.0"}}',
      'nuxt.config.ts': 'export default defineNuxtConfig({})\n',
    })

    const result = await runInit(fakeContext(cwd), undefined, { agentGuide: false, dryRun: true, yes: true })

    expect(result.answers.framework).toBe('nuxt')
    /* The scope is noise once every event carries the service name. */
    expect(result.answers.service).toBe('shop')
    expect(result.written.length).toBeGreaterThan(0)
    expect(await readFile(join(cwd, 'nuxt.config.ts'), 'utf8')).toBe('export default defineNuxtConfig({})\n')
    expect(existsSync(join(cwd, 'evlog.config.ts'))).toBe(false)
  })

  it('defaults to the service an existing evlog.config.ts sets', async () => {
    const cwd = await project({
      'package.json': '{"name":"evlog-nuxt-try","dependencies":{"nuxt":"^4.0.0"}}',
      'nuxt.config.ts': 'export default defineNuxtConfig({})\n',
      'evlog.config.ts': `${DEFINE}export default defineEvlog({\n  service: 'review',\n})\n`,
    })

    const result = await runInit(fakeContext(cwd), undefined, { agentGuide: false, dryRun: true, yes: true })

    expect(result.answers.service).toBe('review')
    expect(formatInitReport(fakeContext(cwd), result)).toContain('service review')
  })

  it('is safe to run twice — the second run changes nothing', async () => {
    const cwd = await project({
      'package.json': '{"name":"shop","dependencies":{"nuxt":"^4.0.0"}}',
      'nuxt.config.ts': 'export default defineNuxtConfig({})\n',
    })

    await runInit(fakeContext(cwd), undefined, { agentGuide: false, install: false, yes: true })
    const afterFirst = await readFile(join(cwd, 'nuxt.config.ts'), 'utf8')
    const configAfterFirst = await readFile(join(cwd, 'evlog.config.ts'), 'utf8')
    const second = await runInit(fakeContext(cwd), undefined, { agentGuide: false, install: false, yes: true })

    expect(second.written).toHaveLength(0)
    expect(second.manual).toHaveLength(0)
    expect(await readFile(join(cwd, 'nuxt.config.ts'), 'utf8')).toBe(afterFirst)
    expect(await readFile(join(cwd, 'evlog.config.ts'), 'utf8')).toBe(configAfterFirst)
  })

  it('puts the settings in evlog.config.ts and writes no server plugin', async () => {
    const cwd = await project({
      'package.json': '{"name":"shop","dependencies":{"nuxt":"^5.0.0"}}',
      'nuxt.config.ts': 'export default defineNuxtConfig({})\n',
    })

    await runInit(fakeContext(cwd), undefined, { agentGuide: false, install: false, yes: true })

    const config = await readFile(join(cwd, 'evlog.config.ts'), 'utf8')
    expect(config).toContain(`import { defineEvlog } from 'evlog'`)
    expect(config).toContain(`service: 'shop',`)
    expect(await readFile(join(cwd, 'nuxt.config.ts'), 'utf8')).not.toContain('evlog:')
    expect(existsSync(join(cwd, 'server/plugins'))).toBe(false)
  })

  it('writes a config the CLI reads without running it', async () => {
    const cwd = await project({
      'package.json': '{"name":"shop","dependencies":{"nuxt":"^4.0.0"}}',
      'nuxt.config.ts': 'export default defineNuxtConfig({})\n',
    })

    await runInit(fakeContext(cwd), undefined, { agentGuide: false, install: false, yes: true })

    const { config, parent } = readConfig(join(cwd, 'evlog.config.ts'), path => path)
    expect(parent).toBeNull()
    expect(config.value.service).toBe('shop')
    expect(config.value.drain).toBeInstanceOf(RuntimeValue)
  })

  it('gates the local sink on development rather than shipping a file writer', async () => {
    const cwd = await project({
      'package.json': '{"name":"shop","dependencies":{"nuxt":"^4.0.0"}}',
      'nuxt.config.ts': 'export default defineNuxtConfig({})\n',
    })

    await runInit(fakeContext(cwd), undefined, { agentGuide: false, install: false, yes: true })

    const config = await readFile(join(cwd, 'evlog.config.ts'), 'utf8')
    expect(config).toContain(`import { createFsDrain } from 'evlog/fs'`)
    expect(config).toContain('drain: process.env.NODE_ENV === \'production\' ? undefined : createFsDrain(),')
  })

  it('honours --no-sink', async () => {
    const cwd = await project({
      'package.json': '{"name":"shop","dependencies":{"nuxt":"^4.0.0"}}',
      'nuxt.config.ts': 'export default defineNuxtConfig({})\n',
    })

    await runInit(fakeContext(cwd), undefined, { agentGuide: false, install: false, devDrain: 'none', yes: true })

    const config = await readFile(join(cwd, 'evlog.config.ts'), 'utf8')
    expect(config).not.toContain('drain')
    expect(config).not.toContain('createFsDrain')
  })

  it('reports the install command without running it when told not to', async () => {
    const cwd = await project({
      'package.json': '{"name":"shop","dependencies":{"nuxt":"^4.0.0"}}',
      'pnpm-lock.yaml': '',
      'nuxt.config.ts': 'export default defineNuxtConfig({})\n',
    })

    const result = await runInit(fakeContext(cwd), undefined, { agentGuide: false, install: false, yes: true })

    expect(result.install).toMatchObject({ status: 'skipped', command: `pnpm add ${evlogPackageSpec(VERSION)}` })
  })
})

describe('dry-run diff', () => {
  it('diffs a changed line with its context, the removal before the addition', () => {
    // Expected output copied from GNU `diff -u` on the same two files.
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'm'].join('\n')
    const after = ['a', 'b', 'c', 'd', 'E', 'f', 'g', 'h', 'i', 'j', 'k', 'm', 'l'].join('\n')

    expect(unifiedDiff(`${before}\n`, `${after}\n`)).toEqual([
      '@@ -2,7 +2,7 @@',
      ' b',
      ' c',
      ' d',
      '-e',
      '+E',
      ' f',
      ' g',
      ' h',
      '@@ -10,3 +10,4 @@',
      ' j',
      ' k',
      ' m',
      '+l',
    ])
  })

  it('shows a new file as additions and an unchanged one as nothing', () => {
    expect(unifiedDiff('', 'one\ntwo\n')).toEqual(['@@ -0,0 +1,2 @@', '+one', '+two'])
    expect(unifiedDiff('same\n', 'same\n')).toEqual([])
  })

  it('shows what each edit would change in a file that exists, and leaves it as it was', async () => {
    const config = `export default defineNuxtConfig({\n  modules: ['@nuxt/ui'],\n  devtools: { enabled: true },\n})\n`
    const cwd = await project({ 'package.json': '{"name":"shop","dependencies":{"nuxt":"^4.0.0"}}', 'nuxt.config.ts': config })

    const result = await runInit(fakeContext(cwd), undefined, { agentGuide: false, install: false, dryRun: true, yes: true })

    expect(result.preview.find(file => file.file === 'nuxt.config.ts')).toEqual({
      file: 'nuxt.config.ts',
      kind: 'patch',
      lines: [
        '@@ -1,4 +1,4 @@',
        ' export default defineNuxtConfig({',
        '-  modules: [\'@nuxt/ui\'],',
        '+  modules: [\'@nuxt/ui\', \'evlog/nuxt\'],',
        '   devtools: { enabled: true },',
        ' })',
      ],
    })
    expect(result.preview.find(file => file.file === 'evlog.config.ts')?.lines[0]).toMatch(/^@@ -0,0 \+1,\d+ @@$/)
    expect(await readFile(join(cwd, 'nuxt.config.ts'), 'utf8')).toBe(config)
    expect(formatInitReport(fakeContext(cwd), result)).toContain('   -  modules: [\'@nuxt/ui\'],\n   +  modules: [\'@nuxt/ui\', \'evlog/nuxt\'],')
  })

  it('shows the package.json the install would leave, in its own indentation', async () => {
    const pkg = '{\n    "name": "agent",\n    "dependencies": {\n        "eve": "1.0.2"\n    }\n}\n'
    const cwd = await project({ 'package.json': pkg, 'agent/agent.ts': '', 'pnpm-lock.yaml': '' })
    const tag = VERSION.includes('-') ? 'beta' : 'latest'

    const result = await runInit(fakeContext(cwd), undefined, { agentGuide: false, dryRun: true, yes: true })

    expect(result.preview[0]).toEqual({
      file: 'package.json',
      kind: 'patch',
      by: `pnpm add ${evlogPackageSpec(VERSION)} ${evlogPackageSpec(VERSION, '@evlog/eve')}`,
      lines: [
        '@@ -1,6 +1,8 @@',
        ' {',
        '     "name": "agent",',
        '     "dependencies": {',
        '-        "eve": "1.0.2"',
        `+        "@evlog/eve": "${tag}",`,
        '+        "eve": "1.0.2",',
        `+        "evlog": "${tag}"`,
        '     }',
        ' }',
      ],
    })
    expect(await readFile(join(cwd, 'package.json'), 'utf8')).toBe(pkg)
    expect(installs.calls).toEqual([])
  })

  it('previews nothing on a run that writes', async () => {
    const cwd = await project({ 'package.json': '{"name":"shop","dependencies":{"nuxt":"^4.0.0"}}' })

    const result = await runInit(fakeContext(cwd), undefined, { agentGuide: false, install: false, yes: true })

    expect(result.written.length).toBeGreaterThan(0)
    expect(result.preview).toEqual([])
  })
})

describe('detectNitroMajor', () => {
  const pkg = (deps: Record<string, string>) => ({ name: 'app', dependencies: deps })

  it('reads the nuxt major, including npm: aliases for nightlies', () => {
    expect(detectNitroMajor(pkg({ nuxt: '^4.4.2' }), 'nuxt')).toBe(2)
    expect(detectNitroMajor(pkg({ nuxt: '^5.0.0' }), 'nuxt')).toBe(3)
    expect(detectNitroMajor(pkg({ nuxt: 'npm:nuxt-nightly@5.0.0-29847385.3fde4d62' }), 'nuxt')).toBe(3)
  })

  it('lets nitropack decide for the nitro framework', () => {
    expect(detectNitroMajor(pkg({ nitropack: '^2.11.0' }), 'nitro')).toBe(2)
    expect(detectNitroMajor(pkg({ nitro: '^3.0.0' }), 'nitro')).toBe(3)
  })

  it('tanstack-start is always Nitro v3', () => {
    expect(detectNitroMajor(pkg({}), 'tanstack-start')).toBe(3)
  })
})

describe('detectEvlogMajor', () => {
  it('reads the installed evlog major', () => {
    expect(detectEvlogMajor('2.33.1')).toBe(2)
    expect(detectEvlogMajor('3.0.0-beta.2')).toBe(3)
  })

  it('targets evlog 3 when init installs it', () => {
    expect(detectEvlogMajor(undefined)).toBe(3)
  })
})

describe('evlogPackageSpec', () => {
  it('installs the beta evlog from a prerelease CLI and the latest one from a release', () => {
    expect(evlogPackageSpec('1.0.0-beta.3')).toBe('evlog@beta')
    expect(evlogPackageSpec('1.0.0')).toBe('evlog')
  })
})

describe('runInit — agent guidelines', () => {
  async function nuxtProject(files: Record<string, string> = {}): Promise<string> {
    return await project({
      'package.json': '{"name":"shop","dependencies":{"nuxt":"^4.0.0"}}',
      'nuxt.config.ts': 'export default defineNuxtConfig({})\n',
      ...files,
    })
  }

  it('writes the guidelines alongside the wiring, in one plan', async () => {
    /* The skills are already there, so the run never spawns anything — the
       block is what `init` itself is responsible for. */
    const cwd = await nuxtProject({ '.claude/skills/review-logging-patterns/SKILL.md': '# x\n' })

    const result = await runInit(fakeContext(cwd), undefined, { agentGuide: true, install: false, yes: true })

    expect(result.agentGuide).toMatchObject({
      status: 'already',
      found: ['review-logging-patterns'],
      dirs: ['.claude/skills'],
    })
    /* Reported, not silent: doing nothing quietly reads as a forgotten step. */
    expect(result.already).toContain('evlog skills already installed · .claude/skills')
    expect(result.written.map(action => action.relative)).toEqual(
      expect.arrayContaining(['AGENTS.md']),
    )
    /* The wiring and the guidelines land in the same plan, not two runs. */
    expect(await readFile(join(cwd, 'nuxt.config.ts'), 'utf8')).toContain('evlog/nuxt')
    expect(await readFile(join(cwd, 'AGENTS.md'), 'utf8')).toContain('## Logging with evlog')
  })

  it('names the already-installed skills once in the report', async () => {
    const cwd = await nuxtProject({ '.claude/skills/review-logging-patterns/SKILL.md': '# x\n' })

    const result = await runInit(fakeContext(cwd), undefined, { agentGuide: true, install: false, yes: true })
    const report = formatInitReport(fakeContext(cwd), result)

    /* The plan entry and the skills status describe the same fact: one line each would repeat it. */
    expect(report.match(/skills already installed/g)).toHaveLength(1)
    expect(report).toContain('npx skills update')
  })

  it('never writes skill files itself', async () => {
    const cwd = await nuxtProject({ '.claude/skills/analyze-logs/SKILL.md': '# x\n' })

    const result = await runInit(fakeContext(cwd), undefined, { agentGuide: true, install: false, yes: true })

    /* `npx skills add` owns them: a copy we wrote is one it could never update. */
    expect(result.written.every(action => !action.relative.includes('skills'))).toBe(true)
  })

  it('does nothing at all under --no-agents', async () => {
    const cwd = await nuxtProject()

    const result = await runInit(fakeContext(cwd), undefined, { agentGuide: false, install: false, yes: true })

    expect(result.agentGuide).toBeNull()
    expect(existsSync(join(cwd, 'AGENTS.md'))).toBe(false)
    expect(skills.calls).toBe(0)
  })

  it('installs the skills when none are on disk — the common case', async () => {
    skills.spawnResult = { ok: true }
    const cwd = await nuxtProject()

    const result = await runInit(fakeContext(cwd), undefined, { agentGuide: true, install: false, yes: true })

    /* `pending` is the value the step starts at; leaving it there would mean
       the skills execution never ran. */
    expect(result.agentGuide).toMatchObject({ status: 'installed', found: [] })
    expect(skills.calls).toBe(1)
    /* The files land before the spawn, so a dead subprocess cannot cost them. */
    expect(await readFile(join(cwd, 'AGENTS.md'), 'utf8')).toContain('## Logging with evlog')
    expect(existsSync(join(cwd, 'CLAUDE.md'))).toBe(false)
  })

  it('keeps the wiring and the block when the skills install fails', async () => {
    skills.spawnResult = { ok: false, error: 'npx: command not found' }
    const cwd = await nuxtProject()

    const result = await runInit(fakeContext(cwd), undefined, { agentGuide: true, install: false, yes: true })

    expect(result.agentGuide).toMatchObject({ status: 'failed', error: 'npx: command not found' })
    expect(await readFile(join(cwd, 'nuxt.config.ts'), 'utf8')).toContain('evlog/nuxt')
    expect(existsSync(join(cwd, 'AGENTS.md'))).toBe(true)
  })

  it('does not leave the block promising a skill the failed install never wrote', async () => {
    skills.spawnResult = { ok: false, error: 'npx: command not found' }
    const cwd = await nuxtProject()

    await runInit(fakeContext(cwd), undefined, { agentGuide: true, install: false, yes: true })

    const contents = await readFile(join(cwd, 'AGENTS.md'), 'utf8')
    expect(contents).not.toContain('review-logging-patterns')
    expect(contents).toContain('https://evlog.dev/learn/wide-events')
  })

  it('exits 1 when the skills install fails, with the outcome in the JSON', async () => {
    skills.spawnResult = { ok: false, error: 'npx: command not found' }
    const cwd = await nuxtProject()
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      out.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
      return true
    }) as typeof process.stdout.write)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    vi.stubEnv('HOME', join(cwd, '__home'))

    await runCommand(init, { rawArgs: ['--cwd', cwd, '--json', '--no-header', '--no-install'] })

    expect(JSON.parse(out.join('')).agentGuide).toMatchObject({ status: 'failed', error: 'npx: command not found' })
    expect(process.exitCode).toBe(1)
  })

  it('names the file it could not write and the files written before it', async () => {
    /* A link into a directory that is not there fails the write for any user, root included. */
    const cwd = await nuxtProject({ '.claude/skills/review-logging-patterns/SKILL.md': '# x\n' })
    await symlink(join(cwd, 'missing', 'AGENTS.md'), join(cwd, 'AGENTS.md'))

    await expect(runInit(fakeContext(cwd), undefined, { agentGuide: true, install: false, yes: true })).rejects.toMatchObject({
      code: 'cli.WRITE_FAILED',
      message: 'Could not write AGENTS.md (ENOENT). Written before it: evlog.config.ts, nuxt.config.ts',
    })
    expect(await readFile(join(cwd, 'nuxt.config.ts'), 'utf8')).toContain('evlog/nuxt')
    expect(existsSync(join(cwd, 'evlog.config.ts'))).toBe(true)
  })

  it('previews the skills command under --dry-run without running it', async () => {
    const cwd = await nuxtProject()

    const result = await runInit(fakeContext(cwd), undefined, { agentGuide: true, install: false, dryRun: true, yes: true })

    expect(result.agentGuide?.status).toBe('pending')
    expect(result.agentGuide?.command).toContain('npx --yes skills add')
    expect(skills.calls).toBe(0)
    expect(existsSync(join(cwd, 'AGENTS.md'))).toBe(false)
  })
})

describe('catalog files seeded from the scan', () => {
  function parses(file: FileAction): boolean {
    return parseSource(file.path, file.contents)?.errors.length === 0
  }

  it('writes audit actions that parse for a route that starts with a digit or holds a wildcard', async () => {
    const root = await project({ 'package.json': '{"name":"api"}' })

    const plan = await planWiring({
      root,
      framework: 'nitro',
      service: 'api',
      ...wiring({
        devDrain: 'none',
        extras: ['audit-catalog'],
        auditGaps: [
          { path: '/api/2fa/password', method: 'POST', file: 'server/api/2fa/password.post.ts', reasons: ['auth'] },
          { path: '/api/files/*/share', method: 'POST', file: 'server/api/files/[...path]/share.post.ts', reasons: ['pii'] },
        ],
      }),
      nitroMajor: 3,
    })
    const file = action(plan, 'server/utils/audit.ts')

    expect(parses(file)).toBe(true)
    expect(file.contents).toContain(`export const _2FA_PASSWORD_CREATED = defineAuditAction('2fa.password.created', {`)
    expect(file.contents).toContain(`export const FILES_SHARE_CREATED = defineAuditAction('files.share.created', {`)
    expect(file.contents).toContain('log.audit(_2FA_PASSWORD_CREATED({')
  })

  it('writes an error catalog that parses for a service that starts with a digit', async () => {
    const root = await project({ 'package.json': '{"name":"@acme/3d-shop"}' })

    const plan = await planWiring({
      root,
      framework: 'nitro',
      service: '3d-shop',
      ...wiring({
        devDrain: 'none',
        extras: ['error-catalog'],
        repeatedErrors: [{ key: 'CARD_DECLINED', status: 402, message: 'Card declined', files: ['server/api/a.ts', 'server/api/b.ts'] }],
      }),
      nitroMajor: 3,
    })
    const file = action(plan, 'server/utils/errors.ts')

    expect(parses(file)).toBe(true)
    expect(file.contents).toContain(`export const _3dShopErrors = defineErrorCatalog('3d-shop', {`)
    expect(file.contents).toContain(`'3d-shop': typeof _3dShopErrors`)
  })
})

describe('detectPackageManager', () => {
  it('reads the lockfile nearest the package first', async () => {
    const root = await project({ 'package.json': '{}', 'bun.lock': '' })

    expect(detectPackageManager([root])).toBe('bun')
  })

  it('falls back to npm when nothing says otherwise', async () => {
    const root = await project({ 'package.json': '{}' })

    expect(detectPackageManager([root])).toBe('npm')
    expect(installCommand('npm')).toBe(`npm install ${evlogPackageSpec(VERSION)}`)
  })
})

describe('evlog.config.ts drains', () => {
  it('leaves a hosted drain running in production', async () => {
    const root = await project({ 'package.json': '{"name":"api"}' })

    const plan = await planWiring({
      root,
      framework: 'nitro',
      service: 'api',
      ...wiring({ devDrain: 'none', prodDrains: ['axiom'] }),
      nitroMajor: 3,
    })
    const { contents } = action(plan, 'evlog.config.ts')

    expect(contents).toContain(`import { createAxiomDrain } from 'evlog/axiom'`)
    expect(contents).toContain('  drain: createAxiomDrain(),')
    expect(contents).not.toContain('const drains')
    /* Nothing gates it: a hosted destination is the one you picked to receive
       production traffic. */
    expect(contents).not.toContain('import.meta.dev')
  })

  it('wires Sazabi from its catalog entry', async () => {
    const root = await project({ 'package.json': '{"name":"api"}' })

    const plan = await planWiring({
      root,
      framework: 'nitro',
      service: 'api',
      ...wiring({ devDrain: 'none', prodDrains: ['sazabi'] }),
      nitroMajor: 3,
    })
    const { contents } = action(plan, 'evlog.config.ts')

    expect(contents).toContain(`import { createSazabiDrain } from 'evlog/sazabi'`)
    expect(contents).toContain('  drain: createSazabiDrain(),')
  })

  it('wires Loki from its catalog entry', async () => {
    const root = await project({ 'package.json': '{"name":"api"}' })

    const plan = await planWiring({
      root,
      framework: 'nitro',
      service: 'api',
      ...wiring({ devDrain: 'none', prodDrains: ['loki'] }),
      nitroMajor: 3,
    })
    const { contents } = action(plan, 'evlog.config.ts')

    expect(contents).toContain(`import { createLokiDrain } from 'evlog/loki'`)
    expect(contents).toContain('  drain: createLokiDrain(),')
  })

  it('wires ClickHouse from its catalog entry', async () => {
    const root = await project({ 'package.json': '{"name":"api"}' })

    const plan = await planWiring({
      root,
      framework: 'nitro',
      service: 'api',
      ...wiring({ devDrain: 'none', prodDrains: ['clickhouse'] }),
      nitroMajor: 3,
    })
    const { contents } = action(plan, 'evlog.config.ts')

    expect(contents).toContain(`import { createClickHouseDrain } from 'evlog/clickhouse'`)
    expect(contents).toContain('  drain: createClickHouseDrain(),')
  })

  it('sends to every production destination when there are several', async () => {
    const root = await project({ 'package.json': '{"name":"api"}' })

    const plan = await planWiring({
      root,
      framework: 'nitro',
      service: 'api',
      ...wiring({ devDrain: 'none', prodDrains: ['axiom', 'sentry'] }),
      nitroMajor: 3,
    })
    const { contents } = action(plan, 'evlog.config.ts')

    expect(contents).toContain('const drains = [createAxiomDrain(), createSentryDrain()]')
    expect(contents).toContain('drain: async ctx => void await Promise.all(drains.map(drain => drain(ctx))),')
  })

  it('picks the drain with a ternary when each side has one', async () => {
    const root = await project({ 'package.json': '{"name":"api"}' })

    const plan = await planWiring({
      root,
      framework: 'nuxt',
      service: 'api',
      ...wiring({ devDrain: 'fs', prodDrains: ['axiom'] }),
      nitroMajor: 3,
    })
    const { contents } = action(plan, 'evlog.config.ts')

    expect(contents).toContain('  drain: process.env.NODE_ENV === \'production\' ? createAxiomDrain() : createFsDrain(),')
    expect(contents).not.toContain('const drains')
    expect(contents).not.toContain('Promise.all')
  })

  it('branches on NODE_ENV for the Nitro-based frameworks', async () => {
    const root = await project({ 'package.json': '{"name":"api"}' })

    const plan = await planWiring({
      root,
      framework: 'nitro',
      service: 'api',
      ...wiring({ devDrain: 'fs', prodDrains: ['axiom', 'sentry'] }),
      nitroMajor: 3,
    })
    const { contents } = action(plan, 'evlog.config.ts')

    expect(contents).toContain('const drains = process.env.NODE_ENV === \'production\'\n  ? [createAxiomDrain(), createSentryDrain()]\n  : [createFsDrain()]')
    expect(contents).toContain('drain: async ctx => void await Promise.all(drains.map(drain => drain(ctx))),')
  })

  it('never reads import.meta.dev, which is untyped until nuxi prepare runs', async () => {
    /* Nitro inlines NODE_ENV as a literal in its production build, so the same
       condition holds in every Nitro-based framework and type-checks in a fresh
       project, before nuxi prepare has generated the ImportMeta augmentation. */
    for (const framework of ['nuxt', 'nitro', 'tanstack-start'] as const) {
      const cases: { prodDrains: DrainId[], expected: string[] }[] = [
        {
          prodDrains: ['axiom'],
          expected: [`  drain: process.env.NODE_ENV === 'production' ? createAxiomDrain() : createFsDrain(),`],
        },
        {
          prodDrains: ['axiom', 'sentry'],
          expected: ['const drains = process.env.NODE_ENV === \'production\'\n  ? [createAxiomDrain(), createSentryDrain()]\n  : [createFsDrain()]'],
        },
        {
          prodDrains: [],
          expected: [`  drain: process.env.NODE_ENV === 'production' ? undefined : createFsDrain(),`],
        },
      ]

      for (const { prodDrains, expected } of cases) {
        const root = await project({ 'package.json': '{"name":"api"}' })
        const plan = await planWiring({
          root,
          framework,
          service: 'api',
          ...wiring({ devDrain: 'fs', prodDrains }),
          nitroMajor: 3,
        })
        const { contents } = action(plan, 'evlog.config.ts')

        for (const line of expected) expect(contents, `${framework}: ${line}`).toContain(line)
        expect(contents, framework).not.toContain('import.meta.dev')
      }
    }
  })

  it('branches on NODE_ENV where there is no import.meta.dev', async () => {
    const root = await project({ 'package.json': '{"name":"api"}', 'src/index.ts': '' })

    const plan = await planWiring({ root, framework: 'hono', service: 'api', ...wiring({ prodDrains: ['axiom'] }), nitroMajor: 3 })
    const { contents } = action(plan, 'evlog.config.ts')

    expect(contents).toContain(`  drain: process.env.NODE_ENV === 'production' ? createAxiomDrain() : createFsDrain(),`)
    expect(contents).not.toContain('import.meta.dev')
  })

  it('batches the network sends and never the local file write', async () => {
    /* Buffering a local write adds latency to the one loop where you want the
       event on screen immediately. */
    const root = await project({ 'package.json': '{"name":"api"}' })

    const plan = await planWiring({
      root,
      framework: 'nitro',
      service: 'api',
      ...wiring({ devDrain: 'fs', prodDrains: ['axiom'], extras: ['pipeline'] }),
      nitroMajor: 3,
    })
    const { contents } = action(plan, 'evlog.config.ts')

    expect(contents).toContain('createDrainPipeline<DrainContext>')
    expect(contents).toContain('  drain: process.env.NODE_ENV === \'production\' ? pipeline(createAxiomDrain()) : createFsDrain(),')
  })

  it('scopes the filesystem drain to development', async () => {
    /* It writes files on whatever box serves the request — that is a decision,
       and init does not make it for you. */
    const nitro = await project({ 'package.json': '{"name":"api"}' })
    const hono = await project({ 'package.json': '{"name":"api"}', 'src/index.ts': '' })

    const nitroPlan = await planWiring({ root: nitro, framework: 'nitro', service: 'api', ...wiring(), nitroMajor: 3 })
    const honoPlan = await planWiring({ root: hono, framework: 'hono', service: 'api', ...wiring(), nitroMajor: 3 })

    expect(action(nitroPlan, 'evlog.config.ts').contents).toContain('drain: process.env.NODE_ENV === \'production\' ? undefined : createFsDrain(),')
    expect(action(honoPlan, 'evlog.config.ts').contents).toContain(`drain: process.env.NODE_ENV === 'production' ? undefined : createFsDrain(),`)
  })

  it('writes no drain for the console-only choice', async () => {
    const root = await project({ 'package.json': '{"name":"api"}' })

    const plan = await planWiring({ root, framework: 'nitro', service: 'api', ...wiring({ devDrain: 'none' }), nitroMajor: 3 })

    expect(action(plan, 'evlog.config.ts').contents).not.toContain('drain')
  })

  it('names the variables the drains read', async () => {
    const root = await project({ 'package.json': '{"name":"web"}' })

    const plan = await planWiring({
      root,
      framework: 'next',
      service: 'web',
      ...wiring({ devDrain: 'none', prodDrains: ['sentry'] }),
      nitroMajor: 3,
    })

    expect(action(plan, 'evlog.config.ts').contents).toContain(' * Reads SENTRY_DSN from the environment.')
    /* The lib file only reads the config, so a drain change never touches it. */
    expect(action(plan, join('lib', 'evlog.ts')).contents).not.toContain('Sentry')
  })

  it('collects the enrichers into one enrich function', async () => {
    const root = await project({ 'package.json': '{"name":"web"}' })

    const plan = await planWiring({
      root,
      framework: 'next',
      service: 'web',
      ...wiring({ extras: ['enrichers', 'sampling'], enrichers: ['user-agent'], sampling: 'very-high' }),
      nitroMajor: 3,
    })
    const { contents } = action(plan, 'evlog.config.ts')

    expect(contents).toContain('createUserAgentEnricher()')
    expect(contents).toContain('enrich: async (ctx) =>')
    expect(contents).toContain('rates: { info: 1')
  })
})

describe('sampling tiers', () => {
  it('never names debug, whatever the tier', async () => {
    /* An unspecified level is kept at 100%. Debug events exist because somebody
       turned them on to chase something, so a 5% sample of them is a 5% chance
       of seeing the line you switched them on for. */
    const root = await project({
      'package.json': '{"name":"shop"}',
      'nuxt.config.ts': 'export default defineNuxtConfig({})\n',
    })

    for (const tier of ['low', 'medium', 'high', 'very-high'] as const) {
      const plan = await planWiring({
        root,
        framework: 'nuxt',
        service: 'shop',
        ...wiring({ extras: ['sampling'], sampling: tier }),
        nitroMajor: 3,
      })
      const config = action(plan, 'evlog.config.ts')

      expect(config.contents, tier).toContain('error: 100')
      expect(config.contents, tier).not.toContain('debug:')
    }
  })

  it('writes no sampling block for the everything tier', async () => {
    const root = await project({
      'package.json': '{"name":"shop"}',
      'nuxt.config.ts': 'export default defineNuxtConfig({})\n',
    })

    const plan = await planWiring({
      root,
      framework: 'nuxt',
      service: 'shop',
      ...wiring({ extras: ['sampling'], sampling: 'all' }),
      nitroMajor: 3,
    })

    expect(action(plan, 'evlog.config.ts').contents).not.toContain('sampling:')
  })
})

describe('the service a config already sets', () => {
  it('reads it at the top level or under env', async () => {
    for (const setting of [`service: 'review'`, `env: { service: 'review' }`]) {
      const root = await project({
        'package.json': '{"name":"shop"}',
        'evlog.config.ts': `${DEFINE}export default defineEvlog({\n  ${setting},\n})\n`,
      })

      expect(configuredService({ root }), setting).toBe('review')
    }
  })

  it('reads it from the config an existing one extends', async () => {
    const root = await project({
      'package.json': '{"name":"shop"}',
      'presets/base.ts': `${DEFINE}export default defineEvlog({\n  service: 'review',\n})\n`,
      'evlog.config.ts': `import base from './presets/base'\n${DEFINE}export default defineEvlog({\n  extends: base,\n  redact: true,\n})\n`,
    })

    expect(configuredService({ root })).toBe('review')
  })

  it('reads it from a workspace config the package cannot extend', async () => {
    const workspace = await project({
      'presets/org.ts': `${DEFINE}export default defineEvlog({\n  service: 'review',\n})\n`,
      'evlog.config.ts': `import org from './presets/org'\n${DEFINE}export default defineEvlog({\n  extends: org,\n})\n`,
      'apps/shop/package.json': '{"name":"shop"}',
    })

    expect(configuredService({ root: join(workspace, 'apps', 'shop'), workspaceRoot: workspace })).toBe('review')
  })

  it('has none for a config init writes, which names the service itself', async () => {
    const workspace = await project({
      'evlog.config.ts': `${DEFINE}export default defineEvlog({\n  service: 'acme',\n})\n`,
      'apps/shop/package.json': '{"name":"shop"}',
    })

    expect(configuredService({ root: join(workspace, 'apps', 'shop'), workspaceRoot: workspace })).toBeNull()
  })

  it('has none when the config computes it at runtime', async () => {
    const root = await project({
      'package.json': '{"name":"shop"}',
      'evlog.config.ts': `${DEFINE}export default defineEvlog({\n  service: process.env.SERVICE,\n})\n`,
    })

    expect(configuredService({ root })).toBeNull()
  })
})

describe('a config that is already there', () => {
  it('never rewrites it, and hands back the settings it lacks', async () => {
    const root = await project({
      'package.json': '{"name":"shop"}',
      'nuxt.config.ts': 'export default defineNuxtConfig({})\n',
      'evlog.config.ts': `${DEFINE}export default defineEvlog({\n  service: 'shop',\n})\n`,
    })

    const plan = await planWiring({ root, framework: 'nuxt', service: 'shop', ...wiring(), nitroMajor: 3 })

    expect(plan.actions.map(candidate => candidate.relative)).toEqual(['nuxt.config.ts'])
    expect(plan.already).toContain('evlog.config.ts already exists')
    expect(plan.manual.find(step => step.title === 'Add drain to evlog.config.ts')).toMatchObject({
      file: 'evlog.config.ts',
      snippet: expect.stringContaining('createFsDrain()'),
      reason: 'init does not rewrite a config you wrote',
    })
  })

  it('asks for nothing when it already sets what the run picked', async () => {
    const root = await project({
      'package.json': '{"name":"shop"}',
      'nuxt.config.ts': `export default defineNuxtConfig({\n  modules: ['evlog/nuxt'],\n})\n`,
      'evlog.config.mjs': `import { createFsDrain } from 'evlog/fs'\n${DEFINE}export default defineEvlog({\n  drain: createFsDrain(),\n})\n`,
    })

    const plan = await planWiring({ root, framework: 'nuxt', service: 'shop', ...wiring(), nitroMajor: 3 })

    expect(plan.actions).toHaveLength(0)
    expect(plan.manual).toHaveLength(0)
    expect(plan.already).toContain('evlog.config.mjs already exists')
  })

  it('says why when the config cannot be read without running it', async () => {
    const root = await project({
      'package.json': '{"name":"shop"}',
      'evlog.config.ts': `${DEFINE}export default defineEvlog(build())\n`,
    })

    const plan = await planWiring({ root, framework: 'nuxt', service: 'shop', ...wiring(), nitroMajor: 3 })

    expect(plan.manual.find(step => step.file === 'evlog.config.ts')?.reason).toContain('is not a plain defineEvlog')
  })
})

describe('a config in a directory above', () => {
  it('extends the workspace config', async () => {
    const workspace = await project({
      'evlog.config.ts': `${DEFINE}export default defineEvlog({\n  redact: true,\n})\n`,
      'apps/shop/package.json': '{"name":"shop"}',
    })
    const root = join(workspace, 'apps', 'shop')

    const plan = await planWiring({ root, workspaceRoot: workspace, framework: 'nuxt', service: 'shop', ...wiring(), nitroMajor: 3 })
    const { contents } = action(plan, 'evlog.config.ts')

    expect(contents).toContain(`import base from '../../evlog.config'`)
    expect(contents).toContain('  extends: base,\n  service: \'shop\',')
    expect(contents).toContain('createFsDrain()')
  })

  it('inherits a setting the workspace config already makes rather than replacing it', async () => {
    const workspace = await project({
      'evlog.config.ts': `import { createAxiomDrain } from 'evlog/axiom'\n${DEFINE}export default defineEvlog({\n  drain: createAxiomDrain(),\n})\n`,
      'apps/shop/package.json': '{"name":"shop"}',
    })
    const root = join(workspace, 'apps', 'shop')

    const plan = await planWiring({ root, workspaceRoot: workspace, framework: 'nuxt', service: 'shop', ...wiring(), nitroMajor: 3 })

    expect(action(plan, 'evlog.config.ts').contents).not.toContain('drain')
    expect(plan.already).toContain(`${join('..', '..', 'evlog.config.ts')} sets drain, so evlog.config.ts inherits it`)
  })

  it('writes nothing over a workspace config that already extends one', async () => {
    const workspace = await project({
      'presets/org.ts': `${DEFINE}export default defineEvlog({\n  redact: true,\n})\n`,
      'evlog.config.ts': `import org from './presets/org'\n${DEFINE}export default defineEvlog({\n  extends: org,\n})\n`,
      'apps/shop/package.json': '{"name":"shop"}',
    })
    const root = join(workspace, 'apps', 'shop')

    const plan = await planWiring({ root, workspaceRoot: workspace, framework: 'nuxt', service: 'shop', ...wiring(), nitroMajor: 3 })

    expect(plan.actions.some(candidate => candidate.relative === 'evlog.config.ts')).toBe(false)
    expect(plan.manual.find(step => step.title === 'Add the settings for shop')).toMatchObject({
      snippet: expect.stringContaining(`service: 'shop',`),
      reason: expect.stringContaining('a config extends one level'),
    })
  })

  it('never looks above the workspace root', async () => {
    const workspace = await project({
      'evlog.config.ts': `${DEFINE}export default defineEvlog({\n  redact: true,\n})\n`,
      'apps/shop/package.json': '{"name":"shop"}',
    })
    const root = join(workspace, 'apps', 'shop')

    const plan = await planWiring({ root, framework: 'nuxt', service: 'shop', ...wiring(), nitroMajor: 3 })

    expect(action(plan, 'evlog.config.ts').contents).not.toContain('extends')
  })
})

describe('drain and enricher plugins from an earlier init', () => {
  it('keeps a drain plugin that already sends everywhere, and leaves drain out of the config', async () => {
    const root = await project({
      'package.json': '{"name":"shop"}',
      'server/plugins/evlog-drain.ts': `import { createFsDrain } from 'evlog/fs'\n\nexport default defineNitroPlugin(() => createFsDrain())\n`,
    })

    const plan = await planWiring({ root, framework: 'nuxt', service: 'shop', ...wiring(), nitroMajor: 2 })

    expect(action(plan, 'evlog.config.ts').contents).not.toContain('drain')
    expect(plan.already).toContain(`${join('server', 'plugins', 'evlog-drain.ts')} already drains events, so evlog.config.ts leaves drain out`)
    expect(plan.manual).toHaveLength(0)
  })

  it('asks for the destinations a drain plugin is missing', async () => {
    const root = await project({
      'package.json': '{"name":"shop"}',
      'server/plugins/evlog-drain.ts': `import { createFsDrain } from 'evlog/fs'\n\nexport default defineNitroPlugin(() => createFsDrain())\n`,
    })

    const plan = await planWiring({ root, framework: 'nuxt', service: 'shop', ...wiring({ prodDrains: ['axiom'] }), nitroMajor: 2 })

    expect(plan.manual.find(step => step.title === 'Send events to the filesystem and Axiom' || step.title.startsWith('Send events to'))).toMatchObject({
      file: join('server', 'plugins', 'evlog-drain.ts'),
      snippet: expect.stringContaining('createAxiomDrain()'),
    })
  })

  it('keeps an enricher plugin and leaves enrich out of the config', async () => {
    const root = await project({
      'package.json': '{"name":"shop"}',
      'server/plugins/evlog-enrich.ts': 'export default defineNitroPlugin(() => {})\n',
    })

    const plan = await planWiring({ root, framework: 'nuxt', service: 'shop', ...wiring({ extras: ['enrichers'], enrichers: ['user-agent'] }), nitroMajor: 2 })

    expect(action(plan, 'evlog.config.ts').contents).not.toContain('enrich')
    expect(plan.already).toContain(`${join('server', 'plugins', 'evlog-enrich.ts')} already enriches events, so evlog.config.ts leaves enrich out`)
  })
})

describe('a lib/evlog.ts that is already there (Next.js)', () => {
  it('leaves it alone and says how it reads the config', async () => {
    const root = await project({
      'package.json': '{"name":"web"}',
      'lib/evlog.ts': `import { createEvlog } from 'evlog/next'\n\nexport const { withEvlog } = createEvlog({\n  service: 'web',\n})\n`,
    })

    const plan = await planWiring({
      root,
      framework: 'next',
      service: 'web',
      ...wiring({ prodDrains: ['axiom'], extras: ['sampling'], sampling: 'medium' }),
      nitroMajor: 3,
    })

    expect(plan.actions.some(candidate => candidate.relative === join('lib', 'evlog.ts'))).toBe(false)
    expect(plan.already).toContain(`${join('lib', 'evlog.ts')} already exists`)
    expect(plan.manual.find(step => step.title === `Read evlog.config.ts in ${join('lib', 'evlog.ts')}`)).toMatchObject({
      snippet: expect.stringContaining(`import config from '../evlog.config'`),
    })
    /* The instrumentation.ts init writes loads this file, so the one step also carries its hooks. */
    expect(plan.manual.find(step => step.title === `Read evlog.config.ts in ${join('lib', 'evlog.ts')}`)?.snippet)
      .toContain('export const { register, onRequestError } = createInstrumentation({')
    expect(plan.manual.filter(step => step.file === join('lib', 'evlog.ts'))).toHaveLength(1)
    /* The answers still land, in the config. */
    expect(action(plan, 'evlog.config.ts').contents).toContain('createAxiomDrain()')
    expect(action(plan, 'evlog.config.ts').contents).toContain('rates: { info: 25')
  })

  it('does not ask for the config import when it is already there', async () => {
    const root = await project({
      'package.json': '{"name":"web"}',
      'lib/evlog.ts': `import { createEvlog } from 'evlog/next'\nimport config from '../evlog.config'\n\nexport const { withEvlog } = createEvlog(config)\n`,
    })

    const plan = await planWiring({ root, framework: 'next', service: 'web', ...wiring(), nitroMajor: 3 })

    expect(plan.manual.map(step => step.title)).not.toContain(`Read evlog.config.ts in ${join('lib', 'evlog.ts')}`)
  })

  it('asks for the hooks the generated instrumentation calls on it', async () => {
    const root = await project({
      'package.json': '{"name":"web"}',
      'lib/evlog.ts': `import { createEvlog } from 'evlog/next'\nimport config from '../evlog.config'\n\nexport const { withEvlog } = createEvlog(config)\n`,
    })

    const plan = await planWiring({ root, framework: 'next', service: 'web', ...wiring(), nitroMajor: 3 })
    const step = plan.manual.find(candidate => candidate.title === `Export register and onRequestError from ${join('lib', 'evlog.ts')}`)

    expect(action(plan, 'instrumentation.ts').contents).toContain(`import('./lib/evlog')`)
    expect(step?.file).toBe(join('lib', 'evlog.ts'))
    expect(step?.snippet).toContain(`import { createInstrumentation } from 'evlog/next/instrumentation/create'`)
    expect(step?.snippet).toContain('export const { register, onRequestError } = createInstrumentation({')
    expect(step?.snippet).not.toContain('createEvlog(')
  })

  it('adds only the hook that is missing', async () => {
    const root = await project({
      'package.json': '{"name":"web"}',
      'lib/evlog.ts': `import config from '../evlog.config'\n\nexport async function register() {}\n`,
    })

    const plan = await planWiring({ root, framework: 'next', service: 'web', ...wiring(), nitroMajor: 3 })

    expect(plan.manual.find(step => step.title === `Export onRequestError from ${join('lib', 'evlog.ts')}`)?.snippet)
      .toContain('export const { onRequestError } = createInstrumentation({')
  })

  it('stays quiet when it exports both hooks, and only points the instrumentation at it', async () => {
    const root = await project({
      'package.json': '{"name":"web"}',
      'instrumentation.ts': 'export function register() {}\n',
      'lib/evlog.ts': `import { toLoggerConfig } from 'evlog'\nimport { createInstrumentation } from 'evlog/next/instrumentation/create'\nimport config from '../evlog.config'\n\nexport const { register, onRequestError } = createInstrumentation({\n  ...toLoggerConfig(config),\n})\n`,
    })

    const plan = await planWiring({ root, framework: 'next', service: 'web', ...wiring(), nitroMajor: 3 })
    const instrumentation = plan.manual.find(step => step.title === 'Start the logger from evlog.config.ts')

    expect(plan.manual.filter(step => step.file === join('lib', 'evlog.ts'))).toEqual([])
    expect(instrumentation?.snippet).toContain(`defineNodeInstrumentation(() => import('./lib/evlog'))`)
    expect(instrumentation?.snippet).not.toContain('createInstrumentation(')
  })

  it('does not ask for the hooks when the instrumentation reads the config itself', async () => {
    const root = await project({
      'package.json': '{"name":"web"}',
      'instrumentation.ts': `import { toLoggerConfig } from 'evlog'\nimport { createInstrumentation } from 'evlog/next/instrumentation/create'\nimport config from './evlog.config'\n\nexport const { register, onRequestError } = createInstrumentation(toLoggerConfig(config))\n`,
      'lib/evlog.ts': `import { createEvlog } from 'evlog/next'\nimport config from '../evlog.config'\n\nexport const { withEvlog } = createEvlog(config)\n`,
    })

    const plan = await planWiring({ root, framework: 'next', service: 'web', ...wiring(), nitroMajor: 3 })

    expect(plan.manual.filter(step => step.file === join('lib', 'evlog.ts'))).toEqual([])
  })

  it('does not ask for the hooks when the instrumentation loads it its own way', async () => {
    const root = await project({
      'package.json': '{"name":"web"}',
      'instrumentation.ts': `export async function register() {\n  if (process.env.NEXT_RUNTIME === 'nodejs') await import('./lib/evlog')\n}\n`,
      'lib/evlog.ts': `import { createEvlog } from 'evlog/next'\nimport config from '../evlog.config'\n\nexport const { withEvlog } = createEvlog(config)\n`,
    })

    const plan = await planWiring({ root, framework: 'next', service: 'web', ...wiring(), nitroMajor: 3 })

    expect(plan.manual.filter(step => step.file === join('lib', 'evlog.ts'))).toEqual([])
    expect(plan.manual.map(step => step.title)).not.toContain('Start the logger from evlog.config.ts')
  })
})

describe('planWiring — hono', () => {
  it('creates src/evlog.ts from the config and asks for the app.use line', async () => {
    const root = await project({
      'package.json': '{"name":"shop","dependencies":{"hono":"^4.0.0"}}',
      'src/index.ts': 'import { Hono } from \'hono\'\nconst app = new Hono()\nexport default app\n',
    })

    const plan = await planWiring({ root, framework: 'hono', service: 'api', ...wiring(), nitroMajor: 3 })
    const file = action(plan, join('src', 'evlog.ts')).contents

    expect(file).toContain(`import { evlog } from 'evlog/hono'`)
    expect(file).toContain(`import config from '../evlog.config'`)
    expect(file).toContain('initLogger(toLoggerConfig(config))')
    expect(file).toContain('export const evlogMiddleware = evlog(toMiddlewareOptions(config))')
    expect(action(plan, 'evlog.config.ts').contents).toContain('createFsDrain')
    expect(plan.manual.map(step => step.title)).toContain('Register the middleware on your app')
    expect(plan.manual[0]?.snippet).toContain('app.use(evlogMiddleware)')
  })

  it('keeps every setting in the config rather than the middleware module', async () => {
    const root = await project({
      'package.json': '{"name":"shop","dependencies":{"hono":"^4.0.0"}}',
      'src/index.ts': 'export {}\n',
    })

    const plan = await planWiring({
      root,
      framework: 'hono',
      service: 'api',
      ...wiring({ prodDrains: ['axiom'], extras: ['sampling'], sampling: 'medium' }),
      nitroMajor: 3,
    })

    expect(action(plan, 'evlog.config.ts').contents).toContain('sampling:')
    expect(action(plan, 'evlog.config.ts').contents).toContain('createAxiomDrain')
    expect(action(plan, join('src', 'evlog.ts')).contents).not.toContain('createAxiomDrain')
  })

  it('falls back to the package root when there is no src directory', async () => {
    const root = await project({
      'package.json': '{"name":"shop","dependencies":{"hono":"^4.0.0"}}',
      'index.ts': 'export {}\n',
    })

    const plan = await planWiring({ root, framework: 'hono', service: 'api', ...wiring(), nitroMajor: 3 })

    expect(action(plan, 'evlog.ts').contents).toContain(`import config from './evlog.config'`)
    expect(plan.manual[0]?.file).toBe('index.ts')
  })

  it('reports an existing evlog.ts instead of overwriting it', async () => {
    const root = await project({
      'package.json': '{"name":"shop","dependencies":{"hono":"^4.0.0"}}',
      'src/evlog.ts': 'export const evlogMiddleware = null\n',
    })

    const plan = await planWiring({ root, framework: 'hono', service: 'api', ...wiring(), nitroMajor: 3 })

    expect(plan.actions.map(candidate => candidate.relative)).not.toContain(join('src', 'evlog.ts'))
    expect(plan.already).toContain(`${join('src', 'evlog.ts')} already exists`)
    expect(plan.manual.find(step => step.title === `Read evlog.config.ts in ${join('src', 'evlog.ts')}`)?.snippet)
      .toContain(`import config from '../evlog.config'`)
  })
})

describe('runInit — hono', () => {
  it('wires a hono project end to end', async () => {
    const cwd = await project({
      'package.json': '{"name":"shop","dependencies":{"hono":"^4.0.0"}}',
      'src/index.ts': 'import { Hono } from \'hono\'\nconst app = new Hono()\nexport default app\n',
    })

    const result = await runInit(fakeContext(cwd), undefined, { agentGuide: false, install: false, yes: true })

    expect(result.answers.framework).toBe('hono')
    expect(result.written.map(action => action.relative)).toEqual(expect.arrayContaining(['evlog.config.ts', join('src', 'evlog.ts')]))
    expect(await readFile(join(cwd, 'src', 'evlog.ts'), 'utf8')).toContain('export const evlogMiddleware')
  })
})

describe('planWiring — effect', () => {
  it('creates src/evlog.ts with the evlog/effect layers and asks for the Layer.provide lines', async () => {
    const root = await project({
      'package.json': '{"name":"shop","dependencies":{"effect":"^4.0.0"}}',
      'src/index.ts': 'export {}\n',
    })

    const plan = await planWiring({ root, framework: 'effect', service: 'api', ...wiring({ prodDrains: ['axiom'] }), nitroMajor: 3 })
    const file = action(plan, join('src', 'evlog.ts')).contents

    expect(file).toContain(`import { initLoggerLayer, routerLayer } from 'evlog/effect'`)
    expect(file).toContain(`import config from '../evlog.config'`)
    expect(file).toContain('export const EvlogInit = initLoggerLayer(toLoggerConfig(config))')
    expect(file).toContain('export const EvlogRouter = routerLayer(toMiddlewareOptions(config))')
    expect(file).not.toContain('createAxiomDrain')
    expect(action(plan, 'evlog.config.ts').contents).toContain('createAxiomDrain')
    expect(plan.manual.find(step => step.title === 'Provide the layers to your server')?.snippet).toContain('Layer.provide(EvlogRouter)')
  })
})

describe('runInit — effect', () => {
  it('wires an Effect project end to end', async () => {
    const cwd = await project({
      'package.json': '{"name":"shop","dependencies":{"effect":"^4.0.0","@effect/platform-node":"^4.0.0"}}',
      'src/index.ts': 'export {}\n',
    })

    const result = await runInit(fakeContext(cwd), undefined, { agentGuide: false, install: false, yes: true })

    expect(result.answers.framework).toBe('effect')
    expect(result.written.map(action => action.relative)).toEqual(expect.arrayContaining(['evlog.config.ts', join('src', 'evlog.ts')]))
  })
})

describe('eve agents', () => {
  const EVE = {
    'package.json': JSON.stringify({ name: 'support-agent', dependencies: { eve: '^1.0.2' } }),
    'agent/agent.ts': 'export default {}\n',
    'agent/tools/lookup_order.ts': 'export default {}\n',
  }
  const run = (cwd: string, options: Parameters<typeof runInit>[2] = {}) =>
    runInit(fakeContext(cwd), undefined, { agentGuide: false, install: false, yes: true, ...options })
  const plan = (root: string, overrides: Partial<Parameters<typeof planWiring>[0]> = {}) =>
    planWiring({ root, framework: 'eve', service: 'agent', ...wiring(), nitroMajor: 3, ...overrides })
  const files = (result: { written: FileAction[] } | WiringPlan) =>
    ('written' in result ? result.written : result.actions).map(file => file.relative).sort()

  it('mounts @evlog/eve from evlog.config.ts in a standalone agent, and adds the trace instrumentation', async () => {
    const cwd = await project(EVE)

    const result = await run(cwd)

    expect(result.answers.framework).toBe('eve')
    expect(result.host).toBeNull()
    expect(files(result)).toEqual([join('agent', 'extensions', 'evlog.ts'), join('agent', 'instrumentation', 'evlog.ts'), 'evlog.config.ts'])
    const extension = await readFile(join(cwd, 'agent', 'extensions', 'evlog.ts'), 'utf8')
    expect(extension).toContain(`import config from '../../evlog.config'`)
    expect(extension).toContain('export default evlog(config)')
    expect(result.agentServices).toEqual([])
    expect(await readFile(join(cwd, 'agent', 'instrumentation', 'evlog.ts'), 'utf8')).toBe(EVE_INSTRUMENTATION)
    expect(result.install.command).toBe(`npm install ${evlogPackageSpec(VERSION)} ${evlogPackageSpec(VERSION, '@evlog/eve')}`)
    expect(result.manual.find(step => step.title === 'Run the agent on Node 24 or later')?.snippet).toBe(`"engines": { "node": ">=24" }`)
    expect(result.notes).toContain('The agent reads its own events with evlog__logs: a signed-in caller its own session, a schedule every turn. Locally it reads .evlog/logs')
  })

  it('changes nothing on a second run', async () => {
    const cwd = await project(EVE)
    await run(cwd)

    const second = await run(cwd)

    expect(second.written).toEqual([])
    expect(second.already).toEqual(expect.arrayContaining([
      `${join('agent', 'extensions', 'evlog.ts')} already mounts @evlog/eve`,
      `${join('agent', 'instrumentation', 'evlog.ts')} already exports evlogTraces()`,
      'evlog.config.ts already exists',
    ]))
  })

  it('wires the Next app the agent ships in from the same config, the agent under its own service', async () => {
    const cwd = await project({ ...EVE, 'package.json': JSON.stringify({ name: 'web', dependencies: { eve: '1.3.0', next: '^16.0.0' } }), 'app/page.tsx': 'export default () => null\n' })

    const result = await run(cwd)

    expect(result.host).toBe('next')
    expect(files(result)).toEqual([join('agent', 'extensions', 'evlog.ts'), join('agent', 'instrumentation', 'evlog.ts'), 'evlog.config.ts', 'instrumentation.ts', join('lib', 'evlog.ts')])
    expect(await readFile(join(cwd, 'lib', 'evlog.ts'), 'utf8')).toContain(`import config from '../evlog.config'`)
    expect(await readFile(join(cwd, 'evlog.config.ts'), 'utf8')).toContain(`service: 'web',`)
    expect(await readFile(join(cwd, 'agent', 'extensions', 'evlog.ts'), 'utf8')).toContain(`  ...config,\n  // The agent's own service, apart from the project's.\n  service: 'web-agent',\n})`)
    expect(result.agentServices).toEqual(['web-agent'])
    expect(formatInitReport(fakeContext(cwd), result)).toMatch(/eve \+ next.*service web.*agent web-agent/)
  })

  it('adds only the agent to a Next app evlog already reaches, leaving its files alone', async () => {
    const libEvlog = `import { createEvlog } from 'evlog/next'\nimport config from '../evlog.config'\n\nexport const { withEvlog, useLogger } = createEvlog(config)\n`
    const config = `${DEFINE}export default defineEvlog({\n  service: 'web',\n  sampling: { rates: { info: 10 } },\n})\n`
    const cwd = await project({
      ...EVE,
      'package.json': JSON.stringify({ name: 'web', dependencies: { eve: '1.3.0', next: '^16.0.0' } }),
      'evlog.config.ts': config,
      'lib/evlog.ts': libEvlog,
      'instrumentation.ts': `export { register, onRequestError } from './lib/evlog'\n`,
    })

    const result = await run(cwd)

    expect(files(result)).toEqual([join('agent', 'extensions', 'evlog.ts'), join('agent', 'instrumentation', 'evlog.ts')])
    expect(result.answers.service).toBe('web')
    expect(await readFile(join(cwd, 'agent', 'extensions', 'evlog.ts'), 'utf8')).toContain(`service: 'web-agent',`)
    expect(await readFile(join(cwd, 'evlog.config.ts'), 'utf8')).toBe(config)
    expect(await readFile(join(cwd, 'lib', 'evlog.ts'), 'utf8')).toBe(libEvlog)
  })

  it('hands back the service line for a mount beside an app that has none, and leaves one with a service alone', async () => {
    const webApp = { ...EVE, 'package.json': JSON.stringify({ name: 'web', dependencies: { eve: '1.3.0', next: '^16.0.0' } }) }
    const shared = `import evlog from '@evlog/eve'\nimport config from '../../evlog.config'\n\nexport default evlog(config)\n`
    const own = `import evlog from '@evlog/eve'\nimport config from '../../evlog.config'\n\nexport default evlog({ ...config, service: 'support' })\n`

    const withShared = await run(await project({ ...webApp, 'agent/extensions/evlog.ts': shared }), { dryRun: true })
    const withOwn = await run(await project({ ...webApp, 'agent/extensions/evlog.ts': own }), { dryRun: true })

    expect(withShared.manual.find(step => step.file === join('agent', 'extensions', 'evlog.ts'))).toMatchObject({ title: 'Give the agent its own service, web-agent', snippet: `service: 'web-agent',` })
    expect(files(withShared)).not.toContain(join('agent', 'extensions', 'evlog.ts'))
    expect(withOwn.manual.filter(step => step.file === join('agent', 'extensions', 'evlog.ts'))).toEqual([])
  })

  it('sets up only the agent under --framework eve, and only the app under --framework next', async () => {
    const webApp = { ...EVE, 'package.json': JSON.stringify({ name: 'web', dependencies: { eve: '1.3.0', next: '^16.0.0' } }) }

    const agent = await run(await project(webApp), { framework: 'eve', dryRun: true })
    const app = await run(await project(webApp), { framework: 'next', dryRun: true })

    expect(agent.host).toBeNull()
    expect(files(agent)).not.toContain(join('lib', 'evlog.ts'))
    expect(files(app)).not.toContain(join('agent', 'extensions', 'evlog.ts'))
  })

  it('registers evlog/nuxt beside the agent, and says the nuxt.config evlog block configures the app only', async () => {
    const nuxtConfig = `export default defineNuxtConfig({\n  modules: ['eve/nuxt'],\n  evlog: { env: { service: 'shop' } },\n})\n`
    const cwd = await project({ ...EVE, 'package.json': JSON.stringify({ name: 'shop', dependencies: { eve: '1.3.0', nuxt: '^4.0.0' } }), 'nuxt.config.ts': nuxtConfig })

    const result = await run(cwd, { dryRun: true })

    expect(result.host).toBe('nuxt')
    expect(result.written.find(file => file.relative === 'nuxt.config.ts')?.contents).toContain(`modules: ['eve/nuxt', 'evlog/nuxt'],`)
    expect(result.notes).toContain('The evlog block in nuxt.config.ts configures the Nuxt app only. evlog.config.ts is shared: the Nuxt app and the agent both read it')
  })

  it('mounts in every member of an agent workspace, not in a root agent/ or a member with its own package', async () => {
    const cwd = await project({
      'package.json': JSON.stringify({ name: 'ops', dependencies: { eve: '1.3.0' } }),
      'agents/support/agent/agent.ts': '',
      'agents/research/agent/agent.ts': '',
      'agents/billing/package.json': '{"name":"billing"}',
      'agents/billing/agent/agent.ts': '',
    })

    const result = await run(cwd)

    expect(files(result)).toEqual([
      join('agents', 'research', 'agent', 'extensions', 'evlog.ts'),
      join('agents', 'research', 'agent', 'instrumentation', 'evlog.ts'),
      join('agents', 'support', 'agent', 'extensions', 'evlog.ts'),
      join('agents', 'support', 'agent', 'instrumentation', 'evlog.ts'),
      'evlog.config.ts',
    ])
    const support = await readFile(join(cwd, 'agents', 'support', 'agent', 'extensions', 'evlog.ts'), 'utf8')
    expect(support).toContain(`import config from '../../../../evlog.config'`)
    expect(support).toContain(`service: 'ops-support',`)
    expect(result.agentServices).toEqual(['ops-research', 'ops-support'])
    expect(existsSync(join(cwd, 'agent'))).toBe(false)
  })

  it('counts a mount under another name or as a directory, and says which tool it gives', async () => {
    const cwd = await project({
      ...EVE,
      'agent/extensions/crm.ts': `export { default } from '@acme/crm'\n`,
      'agent/extensions/observability/extension.ts': `import evlog from '@evlog/eve'\n\nexport default evlog({ service: 'agent' })\n`,
    })

    const result = await plan(cwd)

    expect(files(result)).toEqual([join('agent', 'instrumentation', 'evlog.ts'), 'evlog.config.ts'])
    expect(result.already).toContain(`${join('agent', 'extensions', 'observability', 'extension.ts')} already mounts @evlog/eve, so its logs tool is observability__logs`)
  })

  it('hands back the lines to add when evlog.ts and the instrumentation file hold other code', async () => {
    const cwd = await project({
      ...EVE,
      'agent/extensions/evlog.ts': `import { useLogger } from '@evlog/eve/logger'\n`,
      'agent/instrumentation/evlog.ts': 'export default {}\n',
    })

    const result = await plan(cwd)

    expect(files(result)).toEqual(['evlog.config.ts'])
    expect(result.manual.find(step => step.title === 'Mount @evlog/eve')?.snippet).toContain('export default evlog(config)')
    expect(result.manual.find(step => step.title === 'Put trace ids on each turn\'s event')?.file).toBe(join('agent', 'instrumentation', 'evlog-traces.ts'))
  })

  it('hides the logs tool in the mount when asked, keeping the config\'s logs settings', async () => {
    const cwd = await project(EVE)

    const result = await plan(cwd, { agentLogs: false })

    const mount = action(result, join('agent', 'extensions', 'evlog.ts')).contents
    expect(mount).toContain('...config,')
    expect(mount).toContain('logs: { ...config.logs, access: () => false },')
    expect(result.notes.some(note => note.includes('evlog__logs'))).toBe(false)
  })

  it('says the logs tool finds nothing locally when no local files are written', async () => {
    const result = await plan(await project(EVE), { devDrain: 'none' })

    expect(result.notes[0]).toBe('The agent reads its own events with evlog__logs, but --drain none writes no local files, so in development it finds nothing')
  })

  it('warns when the config keeps the deployed agent on local files', async () => {
    const config = `${DEFINE}export default defineEvlog({\n  service: 'agent',\n  logs: { source: 'files' },\n})\n`
    const cwd = await project({ ...EVE, 'evlog.config.ts': config })

    const result = await plan(cwd)

    expect(result.notes).toContain('evlog.config.ts sets logs.source to files, which keeps the deployed agent reading local files instead of its Vercel runtime logs')
    expect(await readFile(join(cwd, 'evlog.config.ts'), 'utf8')).toBe(config)
  })

  it('names a chosen Vercel connector in a new config, and hands it back for an existing one', async () => {
    const fresh = await plan(await project(EVE), { vercelProject: 'prj_1', logsConnector: 'vercel/mcp' })
    const existing = await plan(await project({ ...EVE, 'evlog.config.ts': `${DEFINE}export default defineEvlog({ service: 'agent' })\n` }), { vercelProject: 'prj_1', logsConnector: 'vercel/mcp' })

    expect(action(fresh, 'evlog.config.ts').contents).toContain(`  logs: { vercel: { connector: 'vercel/mcp' } },`)
    expect(existing.manual.find(step => step.title === 'Read the agent\'s Vercel logs through vercel/mcp')?.snippet).toBe(`logs: { vercel: { connector: 'vercel/mcp' } },`)
  })

  it('points a linked project at evlog setup vercel without contacting Vercel under --yes', async () => {
    const cwd = await project({ ...EVE, '.vercel/project.json': '{"projectId":"prj_1","orgId":"team_1"}' })

    const result = await run(cwd, { dryRun: true })

    expect(result.vercel).toBeNull()
    expect(result.notes).toContain('Vercel project prj_1 is linked. The deployed agent reads its runtime logs once a connector is chosen: npx evlog setup vercel lists the team\'s connectors and asks which to use')
  })

  it.each([
    ['allows an older Node', { engines: { node: '>=22 || >=24' } }, {}, 'engines.node allows >=22 || >=24'],
    ['pins an older Node in .nvmrc', {}, { '.nvmrc': 'v22.11.0\n' }, '.nvmrc allows 22.11.0'],
  ])('names Node 24 when the project %s', async (_, pkg, extra, reason) => {
    const cwd = await project({ ...EVE, 'package.json': JSON.stringify({ name: 'agent', dependencies: { eve: '1.0.2' }, ...pkg }), ...extra })

    const result = await plan(cwd)

    expect(result.manual.find(step => step.title === 'Run the agent on Node 24 or later')?.reason).toContain(reason)
  })

  it('takes Node 24 from .node-version when engines is not set', async () => {
    const result = await plan(await project({ ...EVE, '.node-version': '24.4.0\n' }))

    expect(result.already).toContain('.node-version already requires Node 24.4.0')
  })

  it('installs only @evlog/eve when evlog is already there', async () => {
    const cwd = await project({
      ...EVE,
      'package.json': JSON.stringify({ name: 'agent', dependencies: { eve: '1.0.2', evlog: '^3.0.0-beta.4' } }),
      'node_modules/evlog/package.json': JSON.stringify({ name: 'evlog', version: '3.0.0-beta.4' }),
      'pnpm-lock.yaml': '',
    })

    const result = await run(cwd, { install: true })

    expect(result.install).toEqual({ status: 'installed', command: `pnpm add ${evlogPackageSpec(VERSION, '@evlog/eve')}` })
    expect(installs.packages).toEqual(['@evlog/eve'])
  })

  it('sets up the Next app and says why when the agent is on eve before 1.0', async () => {
    const cwd = await project({ ...EVE, 'package.json': JSON.stringify({ name: 'app', dependencies: { eve: '^0.74.0', next: '^16.0.0' } }) })

    const result = await run(cwd, { dryRun: true })

    expect(result.answers.framework).toBe('next')
    expect(result.notes).toContain('The agent here is on eve ^0.74.0: @evlog/eve needs eve 1.0 or later, so init set up Next.js only')
  })

  it('stops with a reason on an agent on eve before 1.0 with nothing else to set up', async () => {
    const cwd = await project({ ...EVE, 'package.json': JSON.stringify({ name: 'agent', dependencies: { eve: '0.74.0' } }) })

    await expect(run(cwd, { dryRun: true })).rejects.toMatchObject({ code: 'cli.INIT_EVE_TOO_OLD' })
  })

  it('points a web app at the agent its eveRoot names', async () => {
    const cwd = await project({
      'package.json': JSON.stringify({ name: 'web', dependencies: { eve: '1.3.0', next: '^16.0.0' } }),
      'next.config.ts': `import { withEve } from 'eve/next'\n\nexport default withEve({}, { eveRoot: '../agent-service' })\n`,
    })

    const result = await run(cwd, { dryRun: true })

    expect(result.answers.framework).toBe('next')
    expect(result.notes).toContain('eve runs this app\'s agent from ../agent-service. Set it up with evlog init --cwd ../agent-service')
  })

  it('detects an agent whose eve range names no version', async () => {
    const cwd = await project({ ...EVE, 'package.json': JSON.stringify({ name: 'agent', dependencies: { eve: 'workspace:*' } }) })

    const result = await run(cwd, { dryRun: true })

    expect(result.answers.framework).toBe('eve')
    expect(existsSync(join(cwd, 'agent', 'extensions'))).toBe(false)
  })
})

describe('env guidance', () => {
  it('puts the missing drain variables in front of the manual steps', async () => {
    const root = await project({ 'package.json': '{"name":"shop"}' })

    const plan = await planWiring({
      root,
      framework: 'nuxt',
      service: 'shop',
      ...wiring({ prodDrains: ['sentry'] }),
      nitroMajor: 2,
    })

    const [step] = plan.manual
    expect(step).toMatchObject({ title: 'Set the Sentry environment variables', file: '.env' })
    expect(step!.snippet).toContain('SENTRY_DSN=')
    expect(step!.reason).toContain('.env')
    expect(step!.reason).toContain('https://evlog.dev/integrate/adapters/cloud/sentry')
  })

  it('stays out of the manual steps when every variable is set', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://example.ingest.sentry.io/1')
    const root = await project({ 'package.json': '{"name":"shop"}' })

    const plan = await planWiring({
      root,
      framework: 'nuxt',
      service: 'shop',
      ...wiring({ prodDrains: ['sentry'] }),
      nitroMajor: 2,
    })

    expect(plan.manual.map(step => step.title)).not.toContain('Set the Sentry environment variables')
    /* The keys are still documented, whatever the environment holds. */
    expect(plan.actions.some(action => action.relative === '.env.example')).toBe(true)
  })

  it('reads the project .env before declaring a variable missing', async () => {
    const root = await project({
      'package.json': '{"name":"shop"}',
      '.env': 'SENTRY_DSN=https://example.ingest.sentry.io/1\n',
    })

    const plan = await planWiring({
      root,
      framework: 'nuxt',
      service: 'shop',
      ...wiring({ prodDrains: ['sentry'] }),
      nitroMajor: 2,
    })

    expect(plan.manual.map(step => step.title)).not.toContain('Set the Sentry environment variables')
  })

  it('reports the run without a separate env block when a drain needs credentials', async () => {
    const cwd = await project({ 'package.json': '{"name":"shop"}' })

    const result = await runInit(fakeContext(cwd), undefined, {
      agentGuide: false,
      install: false,
      yes: true,
      framework: 'nuxt',
      prodDrains: ['sentry'],
    })
    const report = formatInitReport(fakeContext(cwd), result)

    expect(report).toContain('Set the Sentry environment variables')
    expect(report).toContain('YOUR TURN')
    expect(report).not.toContain('SET BEFORE ANYTHING IS RECEIVED')
  })
})

describe('planWiring — express and fastify', () => {
  it('writes the middleware module for express and leaves the registration to you', async () => {
    const root = await project({ 'src/index.ts': '' })
    const plan = await planWiring({ root, framework: 'express', service: 'api', ...wiring(), nitroMajor: 3 })

    expect(plan.actions.map(candidate => candidate.relative)).toEqual(['evlog.config.ts', join('src', 'evlog.ts')])
    expect(action(plan, join('src', 'evlog.ts')).contents).toContain('import { evlog } from \'evlog/express\'')
    expect(action(plan, join('src', 'evlog.ts')).contents).toContain('export const evlogMiddleware = evlog(toMiddlewareOptions(config))')
    expect(plan.manual.map(step => step.file)).toEqual([join('src', 'index.ts')])
    expect(plan.manual[0]!.snippet).toContain('app.use(evlogMiddleware)')
  })

  it('exports the plugin and its options for fastify', async () => {
    const root = await project({ 'src/index.ts': '' })
    const plan = await planWiring({ root, framework: 'fastify', service: 'api', ...wiring({ prodDrains: ['axiom'] }), nitroMajor: 3 })

    const { contents } = action(plan, join('src', 'evlog.ts'))
    expect(contents).toContain('import type { EvlogFastifyOptions } from \'evlog/fastify\'')
    expect(contents).toContain('export const evlogOptions: EvlogFastifyOptions = toMiddlewareOptions(config)')
    expect(action(plan, 'evlog.config.ts').contents).toContain('createAxiomDrain')
    expect(plan.manual.map(step => step.snippet).join('\n')).toContain('await app.register(evlog, evlogOptions)')
  })
})

describe('init command', () => {
  const NUXT = {
    'package.json': JSON.stringify({ name: 'shop', dependencies: { nuxt: '^4.0.0', evlog: '^2.35.1' } }),
    'nuxt.config.ts': 'export default defineNuxtConfig({})\n',
    'server/api/health.get.ts': 'export default defineEventHandler(() => ({ ok: true }))\n',
  }

  /** Runs `evlog init` from its raw arguments, the way a shell hands them over. */
  async function run(cwd: string, rawArgs: string[]): Promise<{ stdout: string, stderr: string, json: () => Record<string, any> }> {
    const chunks = { stdout: [] as string[], stderr: [] as string[] }
    for (const stream of ['stdout', 'stderr'] as const) {
      vi.spyOn(process[stream], 'write').mockImplementation(((chunk: string | Uint8Array) => {
        chunks[stream].push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
        return true
      }) as typeof process.stdout.write)
    }
    vi.stubEnv('HOME', join(cwd, '__home'))
    vi.stubEnv('USERPROFILE', join(cwd, '__home'))

    await runCommand(init, { rawArgs: ['--cwd', cwd, '--no-header', ...rawArgs] })

    const stdout = chunks.stdout.join('')
    return { stdout, stderr: chunks.stderr.join(''), json: () => JSON.parse(stdout) }
  }

  it('carries every choice flag into the plan', async () => {
    const cwd = await project(NUXT)

    const choices = '--service checkout-api --drain none --prod-drain axiom,sentry --extras pipeline,enrichers,sampling --enrichers geo --sampling high'
    const { json } = await run(cwd, ['--json', '--dry-run', '--no-agents', ...choices.split(' ')])

    expect(json()).toMatchObject({
      framework: 'nuxt',
      service: 'checkout-api',
      devDrain: 'none',
      prodDrains: ['axiom', 'sentry'],
      extras: ['pipeline', 'enrichers', 'sampling'],
      enrichers: ['geo'],
      sampling: 'high',
      agentGuide: null,
      dryRun: true,
    })
    expect(process.exitCode).toBeUndefined()
  })

  it('writes nothing and runs nothing under --dry-run', async () => {
    const cwd = await project({ ...NUXT, 'package.json': JSON.stringify({ name: 'shop', dependencies: { nuxt: '^4.0.0' } }) })

    const { json } = await run(cwd, ['--json', '--dry-run'])

    expect(json().install).toMatchObject({ status: 'skipped', command: `npm install ${evlogPackageSpec(VERSION)}` })
    expect(json().agentGuide).toMatchObject({ status: 'pending' })
    expect(json().preview).toContainEqual({ file: 'evlog.config.ts', kind: 'create', diff: expect.stringMatching(/^@@ -0,0 \+1,\d+ @@\n\+import \{ defineEvlog \} from 'evlog'\n/) })
    expect(json().preview[0]).toMatchObject({ file: 'package.json', by: `npm install ${evlogPackageSpec(VERSION)}` })
    expect(installs.calls).toEqual([])
    expect(skills.calls).toBe(0)
    expect(existsSync(join(cwd, 'evlog.config.ts'))).toBe(false)
    expect(existsSync(join(cwd, 'AGENTS.md'))).toBe(false)
    expect(await readFile(join(cwd, 'nuxt.config.ts'), 'utf8')).toBe(NUXT['nuxt.config.ts'])
  })

  it('stops on a mistyped --dry-run instead of writing for real', async () => {
    const cwd = await project(NUXT)

    const { json } = await run(cwd, ['--json', '--dryrun', '--no-agents'])

    expect(json().error.code).toBe('cli.UNKNOWN_FLAG')
    expect(process.exitCode).toBe(2)
    expect(existsSync(join(cwd, 'evlog.config.ts'))).toBe(false)
    expect(await readFile(join(cwd, 'nuxt.config.ts'), 'utf8')).toBe(NUXT['nuxt.config.ts'])
  })

  it.each([
    { flag: ['--framework', 'rails'], code: 'cli.INIT_INVALID_FRAMEWORK' },
    { flag: ['--drain', 'console'], code: 'cli.INIT_INVALID_DRAIN' },
    { flag: ['--enrichers', 'geo,browser'], code: 'cli.INIT_INVALID_ENRICHER' },
    { flag: ['--sampling', '0.1'], code: 'cli.INIT_INVALID_SAMPLING' },
  ])('exits 2 on $flag.0 $flag.1 before it writes anything', async ({ flag, code }) => {
    const cwd = await project(NUXT)

    const { json } = await run(cwd, ['--json', '--no-agents', '--no-install', ...flag])

    expect(json().error.code).toBe(code)
    expect(process.exitCode).toBe(2)
    expect(existsSync(join(cwd, 'evlog.config.ts'))).toBe(false)
  })

  it('installs evlog with the project\'s package manager, and not at all with --no-install', async () => {
    const cwd = await project({ ...NUXT, 'pnpm-lock.yaml': '' })

    const installed = await run(cwd, ['--json', '--yes', '--no-agents'])
    expect(installed.json().install).toEqual({ status: 'installed', command: `pnpm add ${evlogPackageSpec(VERSION)}` })
    expect(installs.calls).toEqual(['pnpm'])

    vi.restoreAllMocks()
    const skipped = await run(await project({ ...NUXT, 'pnpm-lock.yaml': '' }), ['--json', '--yes', '--no-agents', '--no-install'])
    expect(skipped.json().install).toEqual({ status: 'skipped', command: `pnpm add ${evlogPackageSpec(VERSION)}` })
    expect(installs.calls).toEqual(['pnpm'])
  })

  it('exits 1 when the install fails, with the wiring written and the error in the JSON', async () => {
    installs.result = { ok: false, error: `Command failed: npm install ${evlogPackageSpec(VERSION)}` }
    const cwd = await project(NUXT)

    const { json } = await run(cwd, ['--json', '--yes', '--no-agents'])

    expect(json().install).toEqual({ status: 'failed', command: `npm install ${evlogPackageSpec(VERSION)}`, error: `Command failed: npm install ${evlogPackageSpec(VERSION)}` })
    expect(process.exitCode).toBe(1)
    expect(existsSync(join(cwd, 'evlog.config.ts'))).toBe(true)
  })

  it('writes the wiring, then reports it as already there on a second run', async () => {
    const cwd = await project(NUXT)

    const first = await run(cwd, ['--json', '--yes', '--no-agents', '--no-install'])
    expect(first.json().written.map((entry: { file: string }) => entry.file)).toEqual(['evlog.config.ts', 'nuxt.config.ts'])
    expect(await readFile(join(cwd, 'nuxt.config.ts'), 'utf8')).toContain('evlog/nuxt')

    vi.restoreAllMocks()
    const second = await run(cwd, ['--json', '--yes', '--no-agents', '--no-install'])
    expect(second.json().written).toEqual([])
    expect(second.json().already.length).toBeGreaterThan(0)
    expect(process.exitCode).toBeUndefined()
  })

  it('prints the report on stderr and leaves stdout empty without --json', async () => {
    const cwd = await project(NUXT)

    const { stdout, stderr } = await run(cwd, ['--yes', '--no-agents', '--no-install'])

    expect(stdout).toBe('')
    expect(stderr).toContain('evlog.config.ts')
  })

  describe('at a workspace root', () => {
    const WORKSPACE = {
      'pnpm-workspace.yaml': 'packages:\n  - apps/*\n',
      'package.json': JSON.stringify({ name: 'mono', private: true }),
      'apps/web/package.json': JSON.stringify({ name: 'web', dependencies: { nuxt: '^4.0.0', evlog: '^2.35.1' } }),
      'apps/web/nuxt.config.ts': 'export default defineNuxtConfig({})\n',
      'apps/api/package.json': JSON.stringify({ name: '@acme/api', type: 'module', dependencies: { hono: '^4.0.0', evlog: '^2.35.1' } }),
      'apps/api/src/index.ts': 'import { Hono } from \'hono\'\nexport default new Hono()\n',
    }
    const flags = ['--json', '--yes', '--no-agents', '--no-install']

    it('sets up every app when --apps is left out', async () => {
      const cwd = await project(WORKSPACE)

      const { json } = await run(cwd, flags)

      expect(json().workspace).toBe(true)
      expect(json().apps.map((app: { app: string, framework: string }) => [app.app, app.framework])).toEqual([['apps/api', 'hono'], ['apps/web', 'nuxt']])
      expect(existsSync(join(cwd, 'apps/web/evlog.config.ts'))).toBe(true)
      expect(existsSync(join(cwd, 'apps/api/evlog.config.ts'))).toBe(true)
      expect(existsSync(join(cwd, 'evlog.config.ts'))).toBe(false)
    })

    it.each([
      { by: 'its directory', value: 'apps/web', kept: 'apps/web', left: 'apps/api' },
      { by: 'its package name', value: '@acme/api', kept: 'apps/api', left: 'apps/web' },
    ])('sets up only the app --apps names by $by', async ({ value, kept, left }) => {
      const cwd = await project(WORKSPACE)

      const { json } = await run(cwd, [...flags, '--apps', value])

      expect(json().apps.map((app: { app: string }) => app.app)).toEqual([kept])
      expect(existsSync(join(cwd, kept, 'evlog.config.ts'))).toBe(true)
      expect(existsSync(join(cwd, left, 'evlog.config.ts'))).toBe(false)
    })

    it('exits 2 and sets up nothing when one of the names matches no app', async () => {
      const cwd = await project(WORKSPACE)

      const { json } = await run(cwd, [...flags, '--apps', 'apps/web,shopp'])

      expect(json().error).toMatchObject({ code: 'cli.INIT_NO_APPS', message: expect.stringContaining('"shopp"') })
      expect(process.exitCode).toBe(2)
      expect(existsSync(join(cwd, 'apps/web/evlog.config.ts'))).toBe(false)
    })
  })
})
