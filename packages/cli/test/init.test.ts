import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createContext } from '../src/core/context'
import type { CliContext } from '../src/core/context'
import { readConfig, RuntimeValue } from '../src/lib/config/read'
import { formatInitReport } from '../src/lib/init/report'
import { planWiring } from '../src/lib/init/wiring'
import type { FileAction, WiringPlan } from '../src/lib/init/wiring'
import { detectPackageManager, installCommand } from '../src/lib/init/pm'
import { detectNitroMajor, runInit } from '../src/lib/init/run'

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
  skills.spawnResult = null
  skills.calls = 0
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

    expect(contents).toContain(`import evlog from 'evlog/nitro/v3'`)
    expect(contents).toContain('modules: [evlog()]')
    expect(contents).not.toContain('service')
  })

  it('uses the v2 subpath and factory when the project is on nitropack', async () => {
    const root = await project({ 'package.json': '{"name":"api"}' })

    const plan = await planWiring({ root, framework: 'nitro', service: 'api', ...wiring({ devDrain: 'none' }), nitroMajor: 2 })
    const { contents } = action(plan, 'nitro.config.ts')

    expect(contents).toContain(`import evlog from 'evlog/nitro'`)
    expect(contents).toContain('defineNitroConfig')
    expect(contents).toContain('modules: [evlog()]')
  })

  it('says the module options win when the module is already registered', async () => {
    const root = await project({
      'package.json': '{"name":"api"}',
      'nitro.config.ts': `import { defineConfig } from 'nitro'\nimport evlog from 'evlog/nitro/v3'\n\nexport default defineConfig({\n  modules: [evlog({ env: { service: 'api' } })],\n})\n`,
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
    expect(plan.manual[0]!.snippet).toContain('evlogErrorHandler')
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
    expect(config).toContain('drain: import.meta.dev ? createFsDrain() : undefined,')
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

    expect(result.install).toMatchObject({ status: 'skipped', command: 'pnpm add evlog' })
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
      expect.arrayContaining(['AGENTS.md', 'CLAUDE.md']),
    )
    /* The wiring and the guidelines land in the same plan, not two runs. */
    expect(await readFile(join(cwd, 'nuxt.config.ts'), 'utf8')).toContain('evlog/nuxt')
    expect(await readFile(join(cwd, 'AGENTS.md'), 'utf8')).toContain('## Logging with evlog')
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
    expect(existsSync(join(cwd, 'CLAUDE.md'))).toBe(true)
  })

  it('keeps the wiring and the block when the skills install fails', async () => {
    skills.spawnResult = { ok: false, error: 'npx: command not found' }
    const cwd = await nuxtProject()

    const result = await runInit(fakeContext(cwd), undefined, { agentGuide: true, install: false, yes: true })

    expect(result.agentGuide).toMatchObject({ status: 'failed', error: 'npx: command not found' })
    expect(await readFile(join(cwd, 'nuxt.config.ts'), 'utf8')).toContain('evlog/nuxt')
    expect(existsSync(join(cwd, 'AGENTS.md'))).toBe(true)
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

describe('detectPackageManager', () => {
  it('reads the lockfile nearest the package first', async () => {
    const root = await project({ 'package.json': '{}', 'bun.lock': '' })

    expect(detectPackageManager([root])).toBe('bun')
  })

  it('falls back to npm when nothing says otherwise', async () => {
    const root = await project({ 'package.json': '{}' })

    expect(detectPackageManager([root])).toBe('npm')
    expect(installCommand('npm')).toBe('npm install evlog')
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
    expect(contents).toContain('const drains = [createAxiomDrain()]')
    /* Nothing gates it: a hosted destination is the one you picked to receive
       production traffic. */
    expect(contents).not.toContain('import.meta.dev')
  })

  it('branches on import.meta.dev for the Nitro-based frameworks', async () => {
    const root = await project({ 'package.json': '{"name":"api"}' })

    const plan = await planWiring({
      root,
      framework: 'nitro',
      service: 'api',
      ...wiring({ devDrain: 'fs', prodDrains: ['axiom', 'sentry'] }),
      nitroMajor: 3,
    })
    const { contents } = action(plan, 'evlog.config.ts')

    expect(contents).toContain('const drains = import.meta.dev\n  ? [createFsDrain()]\n  : [createAxiomDrain(), createSentryDrain()]')
    expect(contents).toContain('drain: async ctx => void await Promise.all(drains.map(drain => drain(ctx))),')
  })

  it('branches on NODE_ENV where there is no import.meta.dev', async () => {
    const root = await project({ 'package.json': '{"name":"api"}', 'src/index.ts': '' })

    const plan = await planWiring({ root, framework: 'hono', service: 'api', ...wiring({ prodDrains: ['axiom'] }), nitroMajor: 3 })
    const { contents } = action(plan, 'evlog.config.ts')

    expect(contents).toContain(`const drains = process.env.NODE_ENV === 'production'\n  ? [createAxiomDrain()]\n  : [createFsDrain()]`)
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
    expect(contents).toContain('[createFsDrain()]')
    expect(contents).toContain('[pipeline(createAxiomDrain())]')
  })

  it('scopes the filesystem drain to development', async () => {
    /* It writes files on whatever box serves the request — that is a decision,
       and init does not make it for you. */
    const nitro = await project({ 'package.json': '{"name":"api"}' })
    const hono = await project({ 'package.json': '{"name":"api"}', 'src/index.ts': '' })

    const nitroPlan = await planWiring({ root: nitro, framework: 'nitro', service: 'api', ...wiring(), nitroMajor: 3 })
    const honoPlan = await planWiring({ root: hono, framework: 'hono', service: 'api', ...wiring(), nitroMajor: 3 })

    expect(action(nitroPlan, 'evlog.config.ts').contents).toContain('drain: import.meta.dev ? createFsDrain() : undefined,')
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
    /* The answers still land, in the config. */
    expect(action(plan, 'evlog.config.ts').contents).toContain('createAxiomDrain()')
    expect(action(plan, 'evlog.config.ts').contents).toContain('rates: { info: 25')
  })

  it('stays quiet when it already imports the config', async () => {
    const root = await project({
      'package.json': '{"name":"web"}',
      'lib/evlog.ts': `import { createEvlog } from 'evlog/next'\nimport config from '../evlog.config'\n\nexport const { withEvlog } = createEvlog(config)\n`,
    })

    const plan = await planWiring({ root, framework: 'next', service: 'web', ...wiring(), nitroMajor: 3 })

    expect(plan.manual.map(step => step.title)).not.toContain(`Read evlog.config.ts in ${join('lib', 'evlog.ts')}`)
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
