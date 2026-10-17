import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectProjectFacts } from '../../src/lib/map/project-facts'
import type { ProjectFacts } from '../../src/lib/map/project-facts'
import type { ScanContext } from '../../src/lib/map/types'

const tempDirs: string[] = []

async function factsFor(files: Record<string, string>): Promise<ProjectFacts> {
  const root = await mkdtemp(join(tmpdir(), 'evlog-cli-project-facts-'))
  tempDirs.push(root)
  for (const [path, source] of Object.entries(files)) {
    const file = join(root, path)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, source, 'utf8')
  }

  const ctx: ScanContext = {
    projectRoot: root,
    framework: 'nuxt',
    projectName: 'temp',
    hasEvlog: true,
    verbose: false,
  }
  return collectProjectFacts(ctx, { packageJson: { dependencies: { evlog: '*' } } })
}

/**
 * A pnpm workspace: `apps/web` depends on `packages/logger`, linked into the
 * app's `node_modules` the way pnpm does it, with evlog installed only in the
 * package that wraps it.
 */
async function workspaceFacts(logger: {
  manifest: Record<string, unknown>
  files: Record<string, string>
  evlogInstalled?: boolean
}): Promise<ProjectFacts> {
  const root = await mkdtemp(join(tmpdir(), 'evlog-cli-workspace-'))
  tempDirs.push(root)
  const app = join(root, 'apps/web')
  const packageDir = join(root, 'packages/logger')
  const files: Record<string, string> = {
    'packages/logger/package.json': JSON.stringify({ name: '@acme/logger', ...logger.manifest }),
    'apps/web/package.json': JSON.stringify({ name: 'web', dependencies: { '@acme/logger': 'workspace:*' } }),
  }
  for (const [path, source] of Object.entries(logger.files)) files[`packages/logger/${path}`] = source
  if (logger.evlogInstalled ?? true) {
    files['packages/logger/node_modules/evlog/package.json'] = JSON.stringify({ name: 'evlog', version: '3.0.0' })
  }
  for (const [path, source] of Object.entries(files)) {
    const file = join(root, path)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, source, 'utf8')
  }
  await mkdir(join(app, 'node_modules/@acme'), { recursive: true })
  await symlink(packageDir, join(app, 'node_modules/@acme/logger'), 'dir')

  const ctx: ScanContext = { projectRoot: app, framework: 'next', projectName: 'web', hasEvlog: false, verbose: false }
  return collectProjectFacts(ctx, { packageJson: { dependencies: { '@acme/logger': 'workspace:*' } } })
}

const CREATE_EVLOG = 'import { createEvlog } from \'evlog/next\'\nexport const { withEvlog, useLogger } = createEvlog({ service: \'shop\' })'

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('collectProjectFacts', () => {
  it.each(['ts', 'mts', 'cts', 'mjs'])('sees a catalog declared in a .%s module', async (ext) => {
    const facts = await factsFor({
      [`shared/errors.${ext}`]: 'import { defineErrorCatalog } from \'evlog\'\nexport const errors = defineErrorCatalog(\'shop\', {})',
    })

    expect(facts.features.has('error-catalog')).toBe(true)
    expect(facts.catalogs).toContain('shop')
  })

  it('ignores build output rather than reading a stale copy of the source', async () => {
    const facts = await factsFor({
      'dist/errors.js': 'import { defineErrorCatalog } from \'evlog\'\nexport const errors = defineErrorCatalog(\'stale\', {})',
      '.nuxt/errors.mjs': 'import { defineErrorCatalog } from \'evlog\'\nexport const errors = defineErrorCatalog(\'generated\', {})',
    })

    expect(facts.catalogs).toEqual([])
  })
})

describe('collectProjectFacts on a package that wraps evlog', () => {
  it('reads the names each entry of a workspace package forwards', async () => {
    const facts = await workspaceFacts({
      manifest: {
        exports: { '.': './src/index.ts', './errors': './src/errors.ts', './package.json': './package.json' },
        dependencies: { evlog: '^3.0.0' },
      },
      files: {
        'src/index.ts': 'export * from \'./logger\'\nexport { formatDate } from \'./dates\'',
        'src/logger.ts': CREATE_EVLOG,
        'src/dates.ts': 'export function formatDate() { return \'\' }',
        'src/errors.ts': 'export { createError as fail } from \'evlog\'',
      },
    })

    expect(facts.evlogPackages).toEqual(new Map([
      ['@acme/logger', new Set(['withEvlog', 'useLogger'])],
      ['@acme/logger/errors', new Set(['fail'])],
    ]))
  })

  it('reads the bundled output of a published wrapper', async () => {
    const facts = await workspaceFacts({
      manifest: {
        exports: { '.': { types: './dist/index.d.mts', import: './dist/index.mjs' } },
        peerDependencies: { evlog: '^3.0.0' },
      },
      files: {
        'dist/index.d.mts': 'export declare const withEvlog: unknown',
        'dist/index.mjs': [
          'import { createEvlog } from \'evlog/next\'',
          'const { withEvlog: withEvlog$1, useLogger } = createEvlog({ service: \'shop\' })',
          'export { useLogger, withEvlog$1 as withEvlog }',
        ].join('\n'),
      },
    })

    expect(facts.evlogPackages.get('@acme/logger')).toEqual(new Set(['useLogger', 'withEvlog']))
  })

  it('leaves out a package that does not depend on evlog, whatever it exports', async () => {
    const facts = await workspaceFacts({
      manifest: { exports: { '.': './src/index.ts' } },
      files: { 'src/index.ts': 'export function useLogger() { return console }' },
    })

    expect(facts.evlogPackages.size).toBe(0)
  })

  it('leaves out a package evlog cannot be found from', async () => {
    const facts = await workspaceFacts({
      manifest: { exports: { '.': './src/index.ts' }, dependencies: { evlog: '^3.0.0' } },
      files: { 'src/index.ts': CREATE_EVLOG },
      evlogInstalled: false,
    })

    expect(facts.evlogPackages.size).toBe(0)
  })

  it('survives re-exports that loop back on themselves', async () => {
    const facts = await workspaceFacts({
      manifest: { main: './src/index.ts', dependencies: { evlog: '^3.0.0' } },
      files: {
        'src/index.ts': 'export * from \'./a\'',
        'src/a.ts': 'export * from \'./b\'\nexport { useLogger } from \'evlog\'',
        'src/b.ts': 'export * from \'./a\'',
      },
    })

    expect(facts.evlogPackages.get('@acme/logger')).toEqual(new Set(['useLogger']))
  })

  it('reads each entry in full when two entries re-export each other', async () => {
    const facts = await workspaceFacts({
      manifest: {
        exports: { '.': './src/a.ts', './b': './src/b.ts' },
        dependencies: { evlog: '^3.0.0' },
      },
      files: {
        'src/a.ts': 'export * from \'./b\'\nexport * from \'./helper\'',
        'src/b.ts': 'export * from \'./a\'',
        'src/helper.ts': 'export { useLogger } from \'evlog\'',
      },
    })

    expect(facts.evlogPackages).toEqual(new Map([
      ['@acme/logger', new Set(['useLogger'])],
      ['@acme/logger/b', new Set(['useLogger'])],
    ]))
  })
})
