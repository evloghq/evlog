import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createContext } from '../src/core/context'
import type { CliContext } from '../src/core/context'
import { formatInitReport } from '../src/lib/init/report'
import { planWiring } from '../src/lib/init/wiring'
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

    expect(plan.actions).toHaveLength(1)
    expect(plan.actions[0]!.contents).toBe(
      `export default defineNuxtConfig({\n  // keep me\n  modules: ['@nuxt/ui', 'evlog/nuxt'],\n  devtools: { enabled: true },\n  evlog: {\n    env: { service: 'shop' },\n  },\n})\n`,
    )
  })

  it('adds the modules key when the config has none, after a last property with a trailing comma', async () => {
    const root = await project({
      'package.json': '{"name":"shop"}',
      'nuxt.config.ts': `export default defineNuxtConfig({\n  devtools: { enabled: true },\n})\n`,
    })

    const { contents } = ((await await planWiring({ root, framework: 'nuxt', service: 'shop', ...wiring({ devDrain: 'none' }), nitroMajor: 3 })).actions[0]!)

    expect(contents).toBe(
      `export default defineNuxtConfig({\n  devtools: { enabled: true },\n  modules: ['evlog/nuxt'],\n  evlog: {\n    env: { service: 'shop' },\n  },\n})\n`,
    )
  })

  it('adds the modules key when the config has none, after a last property without a trailing comma', async () => {
    const root = await project({
      'package.json': '{"name":"shop"}',
      'nuxt.config.ts': `export default defineNuxtConfig({\n  devtools: { enabled: true }\n})\n`,
    })

    const { contents } = ((await await planWiring({ root, framework: 'nuxt', service: 'shop', ...wiring({ devDrain: 'none' }), nitroMajor: 3 })).actions[0]!)

    expect(contents).toBe(
      `export default defineNuxtConfig({\n  devtools: { enabled: true },\n  modules: ['evlog/nuxt'],\n  evlog: {\n    env: { service: 'shop' },\n  }\n})\n`,
    )
  })

  it('plans nothing when the module is already registered', async () => {
    const root = await project({
      'package.json': '{"name":"shop"}',
      'nuxt.config.ts': `export default defineNuxtConfig({\n  modules: ['evlog/nuxt'],\n  evlog: { env: { service: 'shop' } },\n})\n`,
    })

    const plan = await planWiring({ root, framework: 'nuxt', service: 'shop', ...wiring({ devDrain: 'none' }), nitroMajor: 3 })

    expect(plan.actions).toHaveLength(0)
    expect(plan.already).toHaveLength(2)
  })

  it('hands back a snippet rather than guessing at a computed modules list', async () => {
    const root = await project({
      'package.json': '{"name":"shop"}',
      'nuxt.config.ts': `const mods = ['@nuxt/ui']\nexport default defineNuxtConfig({\n  modules: mods,\n})\n`,
    })

    const plan = await planWiring({ root, framework: 'nuxt', service: 'shop', ...wiring({ devDrain: 'none' }), nitroMajor: 3 })

    expect(plan.manual[0]).toMatchObject({ file: 'nuxt.config.ts', snippet: `'evlog/nuxt'` })
    /* The half it can still do lands: the `evlog` block is independent of how
       `modules` is spelled, and skipping it would make the manual step longer
       than it has to be. */
    expect(plan.actions[0]!.contents).toContain(`env: { service: 'shop' },`)
    expect(plan.actions[0]!.contents).toContain('modules: mods')
  })
})

describe('planWiring — nitro', () => {
  it('adds the import alongside the module entry', async () => {
    const root = await project({
      'package.json': '{"name":"api"}',
      'nitro.config.ts': `import { defineConfig } from 'nitro'\n\nexport default defineConfig({\n  compatibilityDate: '2025-01-01',\n})\n`,
    })

    const { contents } = ((await await planWiring({ root, framework: 'nitro', service: 'api', ...wiring({ devDrain: 'none' }), nitroMajor: 3 })).actions[0]!)

    expect(contents).toContain(`import evlog from 'evlog/nitro/v3'`)
    expect(contents).toContain(`env: { service: 'api' },`)
  })

  it('uses the v2 subpath and factory when the project is on nitropack', async () => {
    const root = await project({ 'package.json': '{"name":"api"}' })

    const { contents } = ((await await planWiring({ root, framework: 'nitro', service: 'api', ...wiring({ devDrain: 'none' }), nitroMajor: 2 })).actions[0]!)

    expect(contents).toContain(`import evlog from 'evlog/nitro'`)
    expect(contents).toContain('defineNitroConfig')
  })

  it('turns on async context for tanstack start and asks for the error middleware', async () => {
    const root = await project({
      'package.json': '{"name":"start-app"}',
      'nitro.config.ts': `import { defineConfig } from 'nitro'\n\nexport default defineConfig({\n  experimental: {},\n})\n`,
    })

    const plan = await planWiring({ root, framework: 'tanstack-start', service: 'start-app', ...wiring({ devDrain: 'none' }), nitroMajor: 3 })

    expect(plan.actions[0]!.contents).toContain('asyncContext: true')
    expect(plan.manual[0]!.snippet).toContain('evlogErrorHandler')
  })
})

describe('planWiring — next', () => {
  it('writes instrumentation next to the app directory, not at the root', async () => {
    const root = await project({
      'package.json': '{"name":"web"}',
      'src/app/page.tsx': 'export default function Page() { return null }',
    })

    const files = (await await planWiring({ root, framework: 'next', service: 'web', ...wiring({}), nitroMajor: 3 })).actions.map(a => a.relative)

    expect(files).toEqual([join('src', 'instrumentation.ts'), join('src', 'lib', 'evlog.ts')])
  })

  it('leaves an existing instrumentation file alone', async () => {
    const root = await project({
      'package.json': '{"name":"web"}',
      'instrumentation.ts': 'export function register() {}',
    })

    const plan = await planWiring({ root, framework: 'next', service: 'web', ...wiring({ devDrain: 'none' }), nitroMajor: 3 })

    expect(plan.actions.map(a => a.relative)).toEqual([join('lib', 'evlog.ts')])
    expect(plan.already).toContain('instrumentation.ts already exists')
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
    expect(existsSync(join(cwd, 'server/plugins/evlog-drain.ts'))).toBe(false)
  })

  it('is safe to run twice — the second run changes nothing', async () => {
    const cwd = await project({
      'package.json': '{"name":"shop","dependencies":{"nuxt":"^4.0.0"}}',
      'nuxt.config.ts': 'export default defineNuxtConfig({})\n',
    })

    await runInit(fakeContext(cwd), undefined, { agentGuide: false, install: false, yes: true })
    const afterFirst = await readFile(join(cwd, 'nuxt.config.ts'), 'utf8')
    const second = await runInit(fakeContext(cwd), undefined, { agentGuide: false, install: false, yes: true })

    expect(second.written).toHaveLength(0)
    expect(await readFile(join(cwd, 'nuxt.config.ts'), 'utf8')).toBe(afterFirst)
  })

  it('uses the Nitro v3 plugin factory on Nuxt 5', async () => {
    const cwd = await project({
      'package.json': '{"name":"shop","dependencies":{"nuxt":"^5.0.0"}}',
      'nuxt.config.ts': 'export default defineNuxtConfig({})\n',
    })

    await runInit(fakeContext(cwd), undefined, { agentGuide: false, install: false, yes: true })

    const plugin = await readFile(join(cwd, 'server/plugins/evlog-drain.ts'), 'utf8')
    expect(plugin).toContain(`import { definePlugin } from 'nitro'`)
    expect(plugin).toContain('definePlugin((nitroApp) => {')
  })

  it('gates the local sink on development rather than shipping a file writer', async () => {
    const cwd = await project({
      'package.json': '{"name":"shop","dependencies":{"nuxt":"^4.0.0"}}',
      'nuxt.config.ts': 'export default defineNuxtConfig({})\n',
    })

    await runInit(fakeContext(cwd), undefined, { agentGuide: false, install: false, yes: true })

    const plugin = await readFile(join(cwd, 'server/plugins/evlog-drain.ts'), 'utf8')
    expect(plugin).toContain('if (!import.meta.dev) return')
    expect(plugin).toContain('createFsDrain')
  })

  it('honours --no-sink', async () => {
    const cwd = await project({
      'package.json': '{"name":"shop","dependencies":{"nuxt":"^4.0.0"}}',
      'nuxt.config.ts': 'export default defineNuxtConfig({})\n',
    })

    await runInit(fakeContext(cwd), undefined, { agentGuide: false, install: false, devDrain: 'none', yes: true })

    expect(existsSync(join(cwd, 'server/plugins/evlog-drain.ts'))).toBe(false)
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

describe('drain wiring', () => {
  it('imports definePlugin from nitro on Nitro v3, where defineNitroPlugin is not auto-imported', async () => {
    const root = await project({ 'package.json': '{"name":"shop"}' })

    const plan = await planWiring({ root, framework: 'nuxt', service: 'shop', ...wiring(), nitroMajor: 3 })
    const drain = plan.actions.find(action => action.relative.endsWith('evlog-drain.ts'))!

    expect(drain.contents).toContain(`import { definePlugin } from 'nitro'`)
    expect(drain.contents).toContain('definePlugin((nitroApp) => {')
  })

  it('keeps the auto-imported defineNitroPlugin on Nitro v2', async () => {
    const root = await project({ 'package.json': '{"name":"shop"}' })

    const plan = await planWiring({ root, framework: 'nuxt', service: 'shop', ...wiring(), nitroMajor: 2 })
    const drain = plan.actions.find(action => action.relative.endsWith('evlog-drain.ts'))!

    expect(drain.contents).toContain('defineNitroPlugin((nitroApp) => {')
    expect(drain.contents).not.toContain(`from 'nitro'`)
  })

  it('does the same for the enricher plugin', async () => {
    const root = await project({ 'package.json': '{"name":"shop"}' })

    const plan = await planWiring({ root, framework: 'nuxt', service: 'shop', ...wiring({ extras: ['enrichers'], enrichers: ['user-agent'] }), nitroMajor: 3 })
    const enrich = plan.actions.find(action => action.relative.endsWith('evlog-enrich.ts'))!

    expect(enrich.contents).toContain(`import { definePlugin } from 'nitro'`)
    expect(enrich.contents).toContain('definePlugin((nitroApp) => {')
  })

  it('leaves a hosted drain running in production', async () => {
    const root = await project({ 'package.json': '{"name":"api"}' })

    const plan = await planWiring({
      root,
      framework: 'nitro',
      service: 'api',
      ...wiring({ devDrain: 'none', prodDrains: ['axiom'] }),
      nitroMajor: 3,
    })
    const drain = plan.actions.find(action => action.relative.endsWith('evlog-drain.ts'))!

    expect(drain.contents).toContain(`import { createAxiomDrain } from 'evlog/axiom'`)
    /* Nothing gates it: a hosted destination is the one you picked to receive
       production traffic. */
    expect(drain.contents).not.toContain('import.meta.dev')
  })

  it('branches on the environment when dev and production differ', async () => {
    const root = await project({ 'package.json': '{"name":"api"}' })

    const plan = await planWiring({
      root,
      framework: 'nitro',
      service: 'api',
      ...wiring({ devDrain: 'fs', prodDrains: ['axiom', 'sentry'] }),
      nitroMajor: 3,
    })
    const drain = plan.actions.find(action => action.relative.endsWith('evlog-drain.ts'))!

    expect(drain.contents).toContain('import.meta.dev')
    expect(drain.contents).toContain('createFsDrain()')
    expect(drain.contents).toContain('createAxiomDrain(), createSentryDrain()')
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
    const drain = plan.actions.find(action => action.relative.endsWith('evlog-drain.ts'))!

    expect(drain.contents).toContain('[createFsDrain()]')
    expect(drain.contents).toContain('[pipeline(createAxiomDrain())]')
  })

  it('scopes the filesystem drain to development', async () => {
    /* It writes files on whatever box serves the request — that is a decision,
       and init does not make it for you. */
    const root = await project({ 'package.json': '{"name":"api"}' })

    const plan = await planWiring({ root, framework: 'nitro', service: 'api', ...wiring({}), nitroMajor: 3 })
    const drain = plan.actions.find(action => action.relative.endsWith('evlog-drain.ts'))!

    expect(drain.contents).toContain('if (!import.meta.dev) return')
  })

  it('writes no drain plugin at all for the console-only choice', async () => {
    const root = await project({ 'package.json': '{"name":"api"}' })

    const plan = await planWiring({ root, framework: 'nitro', service: 'api', ...wiring({ devDrain: 'none' }), nitroMajor: 3 })

    expect(plan.actions.some(action => action.relative.includes('evlog-drain'))).toBe(false)
  })

  it('wraps the drain in a pipeline when batching was asked for', async () => {
    const root = await project({ 'package.json': '{"name":"api"}' })

    const plan = await planWiring({ root, framework: 'nitro', service: 'api', ...wiring({ prodDrains: ['axiom'], extras: ['pipeline'] }), nitroMajor: 3 })
    const drain = plan.actions.find(action => action.relative.endsWith('evlog-drain.ts'))!

    expect(drain.contents).toContain('createDrainPipeline<DrainContext>')
    expect(drain.contents).toContain('pipeline(createAxiomDrain())')
  })

  it('puts the Next.js drain in the factory rather than a plugin', async () => {
    const root = await project({ 'package.json': '{"name":"web"}' })

    const plan = await planWiring({
      root,
      framework: 'next',
      service: 'web',
      ...wiring({ devDrain: 'none', prodDrains: ['sentry'] }),
      nitroMajor: 3,
    })
    const lib = plan.actions.find(action => action.relative.endsWith('evlog.ts'))!

    expect(lib.contents).toContain(`import { createSentryDrain } from 'evlog/sentry'`)
    expect(lib.contents).toContain('const drains = [createSentryDrain()]')
  })

  it('keeps errors at full rate when sampling is enabled', async () => {
    const root = await project({
      'package.json': '{"name":"shop"}',
      'nuxt.config.ts': 'export default defineNuxtConfig({})\n',
    })

    const plan = await planWiring({ root, framework: 'nuxt', service: 'shop', ...wiring({ extras: ['sampling'], sampling: 'medium' }), nitroMajor: 3 })
    const config = plan.actions.find(action => action.relative === 'nuxt.config.ts')!

    expect(config.contents).toContain('error: 100')
    /* Debug is never named: an unspecified level is kept in full, which is what
       you want from logs somebody switched on to investigate something. */
    expect(config.contents).not.toContain('debug:')
  })
})

describe('an evlog factory that is already there (Next.js)', () => {
  it('splices the destinations into an existing createEvlog call', async () => {
    /* Reporting "already exists" and wiring nothing meant the command asked
       which destinations you wanted and then ignored the answer. */
    const root = await project({
      'package.json': '{"name":"web"}',
      'lib/evlog.ts': `import { createEvlog } from 'evlog/next'\n\n// ours\nexport const { withEvlog } = createEvlog({\n  service: 'web',\n})\n`,
    })

    const plan = await planWiring({
      root,
      framework: 'next',
      service: 'web',
      ...wiring({ prodDrains: ['axiom'], extras: ['sampling'], sampling: 'medium' }),
      nitroMajor: 3,
    })
    const lib = plan.actions.find(action => action.relative === join('lib', 'evlog.ts'))!

    expect(lib.kind).toBe('patch')
    expect(lib.contents).toContain('// ours')
    expect(lib.contents).toContain('drain: async ctx =>')
    expect(lib.contents).toContain('rates: { info: 25')
    /* Imports before the statements that call them. */
    expect(lib.contents.indexOf(`from 'evlog/axiom'`)).toBeLessThan(lib.contents.indexOf('const drains ='))
  })

  it('hands back a snippet when the file is a re-export barrel', async () => {
    const root = await project({
      'package.json': '{"name":"web"}',
      'lib/evlog.ts': `export { useLogger, withEvlog } from 'evlog'\n`,
    })

    const plan = await planWiring({
      root,
      framework: 'next',
      service: 'web',
      ...wiring({ prodDrains: ['axiom'] }),
      nitroMajor: 3,
    })

    expect(plan.actions.some(action => action.relative === join('lib', 'evlog.ts'))).toBe(false)
    expect(plan.manual.some(step => step.snippet.includes('createAxiomDrain'))).toBe(true)
  })

  it('refuses to replace options the author already set', async () => {
    const root = await project({
      'package.json': '{"name":"web"}',
      'lib/evlog.ts': `import { createEvlog } from 'evlog/next'\n\nexport const { withEvlog } = createEvlog({\n  service: 'web',\n  drain: myDrain,\n})\n`,
    })

    const plan = await planWiring({
      root,
      framework: 'next',
      service: 'web',
      ...wiring({ prodDrains: ['axiom'] }),
      nitroMajor: 3,
    })

    expect(plan.actions.some(action => action.relative === join('lib', 'evlog.ts'))).toBe(false)
    expect(plan.manual.some(step => step.reason.includes('already sets drain'))).toBe(true)
  })

  it('wires enrichers and sampling for Next, which supports both', async () => {
    /* createEvlog takes `enrich` and `sampling`; gating them to the Nitro-based
       frameworks excluded Next from two features it fully supports. */
    const root = await project({ 'package.json': '{"name":"web"}' })

    const plan = await planWiring({
      root,
      framework: 'next',
      service: 'web',
      ...wiring({ extras: ['enrichers', 'sampling'], enrichers: ['user-agent'], sampling: 'very-high' }),
      nitroMajor: 3,
    })
    const lib = plan.actions.find(action => action.relative === join('lib', 'evlog.ts'))!

    expect(lib.contents).toContain('createUserAgentEnricher()')
    expect(lib.contents).toContain('enrich: async (ctx) =>')
    expect(lib.contents).toContain('rates: { info: 1')
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
      const config = plan.actions.find(action => action.relative === 'nuxt.config.ts')!

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
    const config = plan.actions.find(action => action.relative === 'nuxt.config.ts')!

    expect(config.contents).not.toContain('sampling:')
  })
})

describe('planWiring — hono', () => {
  it('creates src/evlog.ts with the configured middleware and asks for the app.use line', async () => {
    const root = await project({
      'package.json': '{"name":"shop","dependencies":{"hono":"^4.0.0"}}',
      'src/index.ts': 'import { Hono } from \'hono\'\nconst app = new Hono()\nexport default app\n',
    })

    const plan = await planWiring({ root, framework: 'hono', service: 'api', ...wiring(), nitroMajor: 3 })
    const file = plan.actions.find(action => action.relative === join('src', 'evlog.ts'))!

    expect(file.contents).toContain(`import { evlog } from 'evlog/hono'`)
    expect(file.contents).toContain(`initLogger({\n  env: { service: 'api' },\n})`)
    expect(file.contents).toContain('export const evlogMiddleware = evlog(')
    expect(file.contents).toContain('createFsDrain')
    expect(plan.manual.map(step => step.title)).toContain('Register the middleware on your app')
    expect(plan.manual[0]?.snippet).toContain('app.use(evlogMiddleware)')
  })

  it('puts sampling in initLogger and drains on the middleware', async () => {
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
    const file = plan.actions.find(action => action.relative === join('src', 'evlog.ts'))!
    const [initBlock] = file.contents.split('export const evlogMiddleware')

    expect(initBlock).toContain('sampling:')
    expect(file.contents.split('evlogMiddleware = evlog(')[1]).toContain('drain:')
    expect(file.contents).toContain('createAxiomDrain')
  })

  it('falls back to the package root when there is no src directory', async () => {
    const root = await project({
      'package.json': '{"name":"shop","dependencies":{"hono":"^4.0.0"}}',
      'index.ts': 'export {}\n',
    })

    const plan = await planWiring({ root, framework: 'hono', service: 'api', ...wiring(), nitroMajor: 3 })

    expect(plan.actions.map(action => action.relative)).toContain('evlog.ts')
    expect(plan.manual[0]?.file).toBe('index.ts')
  })

  it('reports an existing evlog.ts instead of overwriting it', async () => {
    const root = await project({
      'package.json': '{"name":"shop","dependencies":{"hono":"^4.0.0"}}',
      'src/evlog.ts': 'export const evlogMiddleware = null\n',
    })

    const plan = await planWiring({ root, framework: 'hono', service: 'api', ...wiring(), nitroMajor: 3 })

    expect(plan.actions.map(action => action.relative)).not.toContain(join('src', 'evlog.ts'))
    expect(plan.already.some(line => line.includes('evlog.ts'))).toBe(true)
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
    expect(result.written.map(action => action.relative)).toContain(join('src', 'evlog.ts'))
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

    expect(plan.actions.map(action => action.relative)).toEqual(['src/evlog.ts'])
    expect(plan.actions[0]!.contents).toContain('import { evlog } from \'evlog/express\'')
    expect(plan.actions[0]!.contents).toContain('export const evlogMiddleware = evlog(')
    expect(plan.manual.map(step => step.file)).toEqual(['src/index.ts'])
    expect(plan.manual[0]!.snippet).toContain('app.use(evlogMiddleware)')
  })

  it('exports the plugin and its options for fastify', async () => {
    const root = await project({ 'src/index.ts': '' })
    const plan = await planWiring({ root, framework: 'fastify', service: 'api', ...wiring({ prodDrains: ['axiom'] }), nitroMajor: 3 })

    const { contents } = plan.actions[0]!
    expect(contents).toContain('import type { EvlogFastifyOptions } from \'evlog/fastify\'')
    expect(contents).toContain('export const evlogOptions: EvlogFastifyOptions = {')
    expect(contents).toContain('createAxiomDrain')
    expect(plan.manual.map(step => step.snippet).join('\n')).toContain('await app.register(evlog, evlogOptions)')
  })
})
