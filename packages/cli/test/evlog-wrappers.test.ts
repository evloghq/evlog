import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runDoctor } from '../src/commands/doctor'
import { createContext } from '../src/core/context'
import type { CliContext } from '../src/core/context'
import { formatInitReport } from '../src/lib/init/report'
import { runInit } from '../src/lib/init/run'
import { resolveEvlog, resolveProject } from '../src/lib/project'

/*
 * An app that reaches evlog only through a wrapper package (`@acme/logger`
 * calls `createEvlog`, the app imports the wrapper and never names evlog).
 * `map` already recognises this; `resolveEvlog`, `doctor` and `init` must too.
 */

const tempDirs: string[] = []

const CREATE_EVLOG = 'import { createEvlog } from \'evlog/next\'\nexport const { withEvlog, useLogger } = createEvlog({ service: \'shop\' })\n'

async function write(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, source] of Object.entries(files)) {
    const file = join(root, path)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, source, 'utf8')
  }
}

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'evlog-cli-wrappers-'))
  tempDirs.push(root)
  return root
}

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

/**
 * A pnpm workspace: `apps/web` imports only `@acme/logger`, a workspace package
 * that declares evlog. Its own node_modules holds evlog, the way pnpm lays it out.
 */
async function pnpmWorkspaceWithWrapper(): Promise<string> {
  const root = await tempRoot()
  await write(root, {
    'pnpm-workspace.yaml': 'packages:\n  - apps/*\n  - packages/*\n',
    'package.json': JSON.stringify({ name: 'shop', private: true }),
    'apps/web/package.json': JSON.stringify({
      name: 'web',
      dependencies: { nuxt: '^4.0.0', '@acme/logger': 'workspace:*' },
    }),
    'apps/web/nuxt.config.ts': 'export default defineNuxtConfig({})\n',
    'packages/logger/package.json': JSON.stringify({
      name: '@acme/logger',
      exports: { '.': './src/index.ts' },
      dependencies: { evlog: '^3.0.0' },
    }),
    'packages/logger/src/index.ts': CREATE_EVLOG,
    'packages/logger/node_modules/evlog/package.json': JSON.stringify({ name: 'evlog', version: '3.0.0' }),
  })
  await mkdir(join(root, 'apps/web/node_modules/@acme'), { recursive: true })
  await symlink(join(root, 'packages/logger'), join(root, 'apps/web/node_modules/@acme/logger'), 'dir')
  return join(root, 'apps/web')
}

/**
 * A single-package app whose wrapper came from npm: a built `.js` entry and
 * evlog under the wrapper's own node_modules, not the app's.
 */
async function publishedWrapper(): Promise<string> {
  const root = await tempRoot()
  await write(root, {
    'package.json': JSON.stringify({
      name: 'web',
      dependencies: { nuxt: '^4.0.0', '@acme/logger': '^1.0.0' },
    }),
    'nuxt.config.ts': 'export default defineNuxtConfig({})\n',
    'node_modules/@acme/logger/package.json': JSON.stringify({
      name: '@acme/logger',
      version: '1.0.0',
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
      dependencies: { evlog: '^3.0.0' },
    }),
    'node_modules/@acme/logger/dist/index.js': 'import { createEvlog } from \'evlog/next\'\nexport const { withEvlog, useLogger } = createEvlog({ service: \'shop\' })\n',
    'node_modules/@acme/logger/dist/index.d.ts': 'export declare const withEvlog: unknown\nexport declare const useLogger: unknown\n',
    'node_modules/@acme/logger/node_modules/evlog/package.json': JSON.stringify({ name: 'evlog', version: '3.0.0' }),
  })
  return root
}

/** An app with neither evlog nor a wrapper. */
async function plainApp(): Promise<string> {
  const root = await tempRoot()
  await write(root, {
    'package.json': JSON.stringify({ name: 'shop', dependencies: { nuxt: '^4.0.0' } }),
    'nuxt.config.ts': 'export default defineNuxtConfig({})\n',
  })
  return root
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('resolveEvlog with a wrapper package', () => {
  it('names the wrapper in a pnpm workspace app that imports only the wrapper', async () => {
    const cwd = await pnpmWorkspaceWithWrapper()
    const resolved = await resolveEvlog(await resolveProject(cwd))

    expect(resolved.install).toBeNull()
    expect([...resolved.wrappers.keys()]).toEqual(['@acme/logger'])
  })

  it('names a published wrapper resolved from its own location, not the app', async () => {
    const cwd = await publishedWrapper()
    const resolved = await resolveEvlog(await resolveProject(cwd))

    expect(resolved.install).toBeNull()
    expect([...resolved.wrappers.keys()]).toEqual(['@acme/logger'])
  })

  it('finds no wrapper in an app that depends on none', async () => {
    const cwd = await plainApp()
    const resolved = await resolveEvlog(await resolveProject(cwd))

    expect(resolved.install).toBeNull()
    expect(resolved.wrappers.size).toBe(0)
  })
})

describe('evlog doctor with a wrapper package', () => {
  it('reports evlog as reached through the wrapper, not as missing', async () => {
    const cwd = await pnpmWorkspaceWithWrapper()
    const result = await runDoctor(fakeContext(cwd))

    const evlog = result.checks.find(check => check.id === 'evlog')
    expect(evlog?.status).toBe('ok')
    expect(evlog?.message).toContain('@acme/logger')
    expect(evlog?.hint ?? '').not.toContain('pnpm add evlog')
  })

  it('does not warn that the framework still needs evlog', async () => {
    const cwd = await publishedWrapper()
    const result = await runDoctor(fakeContext(cwd))

    const stack = result.checks.find(check => check.id === 'stack')
    expect(stack?.status).toBe('ok')
    expect(stack?.hint).toBeUndefined()
  })

  it('still reports a missing evlog in an app with no wrapper', async () => {
    const cwd = await plainApp()
    const result = await runDoctor(fakeContext(cwd))

    const evlog = result.checks.find(check => check.id === 'evlog')
    expect(evlog?.status).toBe('warn')
    expect(evlog?.message).toBe('not found in this project')
    expect(evlog?.hint).toContain('pnpm add evlog')
    expect(result.checks.find(check => check.id === 'stack')?.hint).toContain('add evlog')
  })
})

describe('evlog init with a wrapper package', () => {
  it('stops without offering to install evlog or scaffolding a second setup', async () => {
    const cwd = await pnpmWorkspaceWithWrapper()
    const result = await runInit(fakeContext(cwd), undefined, { agentGuide: false, yes: true })

    expect(result.install.status).toBe('already')
    expect(result.wrappers).toEqual(['@acme/logger'])
    expect(result.written).toHaveLength(0)
    expect(result.interactive).toBe(false)
    expect(existsSync(join(cwd, 'evlog.config.ts'))).toBe(false)
    expect(await readFile(join(cwd, 'nuxt.config.ts'), 'utf8')).toBe('export default defineNuxtConfig({})\n')

    const report = formatInitReport(fakeContext(cwd), result)
    expect(report).toContain('@acme/logger')
    expect(report).not.toContain('installed evlog')
  })

  it('still offers to install evlog in an app with no wrapper', async () => {
    const cwd = await plainApp()
    const result = await runInit(fakeContext(cwd), undefined, { agentGuide: false, install: false, yes: true })

    expect(result.install.status).toBe('skipped')
    expect(result.wrappers).toEqual([])
    expect(result.written.length).toBeGreaterThan(0)
  })
})
