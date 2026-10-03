import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { planWiring } from '../src/lib/init/wiring'
import { auditActionName, readProject } from '../src/lib/init/insight'
import { findWorkspaceApps, isWorkspaceRoot, parsePnpmPackages } from '../src/lib/init/workspace'
import { resolveProject } from '../src/lib/project'

const tempDirs: string[] = []

async function project(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'evlog-cli-insight-'))
  tempDirs.push(dir)
  for (const [path, contents] of Object.entries(files)) {
    const target = join(dir, path)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, contents, 'utf8')
  }
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

const REPEATED_ERROR = `export default defineEventHandler(async (event) => {
  const log = useLogger(event)
  log.set({ step: 'start' })
  throw createError({ status: 402, message: 'Card declined', why: 'The issuer refused it' })
})
`

describe('readProject', () => {
  it('seeds catalog entries from errors the project already repeats', async () => {
    /* One inline error is a local decision; the same one in three handlers is a
       catalog entry nobody has written yet. */
    const root = await project({
      'package.json': '{"name":"shop","dependencies":{"nuxt":"^4.0.0"}}',
      'server/api/checkout.post.ts': REPEATED_ERROR,
      'server/api/refund.post.ts': REPEATED_ERROR,
    })

    const insight = await readProject(root, 'nuxt', 'shop')

    expect(insight?.repeatedErrors).toEqual([expect.objectContaining({ key: 'CARD_DECLINED', status: 402, message: 'Card declined' }),])
  })

  it('carries over the why the code already wrote', async () => {
    /* Replacing prose somebody wrote with a TODO would make the generated file
       worse than the inline error it replaces. */
    const root = await project({
      'package.json': '{"name":"shop","dependencies":{"nuxt":"^4.0.0"}}',
      'server/api/a.post.ts': REPEATED_ERROR,
      'server/api/b.post.ts': REPEATED_ERROR,
    })

    const insight = await readProject(root, 'nuxt', 'shop')

    expect(insight?.repeatedErrors[0]?.why).toBe('The issuer refused it')
  })

  it('ignores an error written in only one place', async () => {
    const root = await project({
      'package.json': '{"name":"shop","dependencies":{"nuxt":"^4.0.0"}}',
      'server/api/checkout.post.ts': REPEATED_ERROR,
    })

    const insight = await readProject(root, 'nuxt', 'shop')

    expect(insight?.repeatedErrors).toEqual([])
  })

  it('reports sensitive entry points with no audit trail', async () => {
    const root = await project({
      'package.json': '{"name":"shop","dependencies":{"nuxt":"^4.0.0"}}',
      'server/api/payments/refund.post.ts': 'export default defineEventHandler(() => ({ ok: true }))\n',
    })

    const insight = await readProject(root, 'nuxt', 'shop')

    expect(insight?.auditGaps).toEqual([expect.objectContaining({ path: '/api/payments/refund', method: 'POST', reasons: ['money'] }),])
  })

  it('survives a project it cannot scan', async () => {
    const root = await project({ 'package.json': 'not json at all' })

    await expect(readProject(root, 'nuxt', 'shop')).resolves.not.toThrow()
  })
})

describe('auditActionName', () => {
  it('names the action after the route and its verb', () => {
    expect(auditActionName({ path: '/api/payments/refund', method: 'POST', file: 'x', reasons: [] }))
      .toBe('payments.refund.created')
    expect(auditActionName({ path: '/api/orders/:id', method: 'DELETE', file: 'x', reasons: [] }))
      .toBe('orders.deleted')
  })
})

describe('generated catalogs', () => {
  it('writes the project\'s own errors, not a template', async () => {
    const root = await project({ 'package.json': '{"name":"shop"}' })

    const plan = await planWiring({
      root,
      framework: 'nuxt',
      service: 'shop',
      devDrain: 'none',
      prodDrains: [],
      extras: ['error-catalog'],
      enrichers: [],
      sampling: 'all',
      nitroMajor: 3,
      repeatedErrors: [{ key: 'CARD_DECLINED', status: 402, message: 'Card declined', files: ['a.ts', 'b.ts'] }],
      auditGaps: [],
    })
    const catalog = plan.actions.find(action => action.relative.endsWith('errors.ts'))!

    expect(catalog.contents).toContain('CARD_DECLINED')
    expect(catalog.contents).toContain('status: 402')
    expect(catalog.contents).toContain('Currently written inline in a.ts, b.ts')
    /* Generated files go through the reader's linter, which on most TypeScript
       projects means single quotes. */
    expect(catalog.contents).not.toContain('"Card declined"')
  })

  it('writes no catalog when the scan found nothing to seed it with', async () => {
    const root = await project({ 'package.json': '{"name":"shop"}' })

    const plan = await planWiring({
      root,
      framework: 'nuxt',
      service: 'shop',
      devDrain: 'none',
      prodDrains: [],
      extras: ['error-catalog', 'audit-catalog'],
      enrichers: [],
      sampling: 'all',
      nitroMajor: 3,
      repeatedErrors: [],
      auditGaps: [],
    })

    expect(plan.actions.filter(action => /errors\.ts|audit\.ts/.test(action.relative))).toEqual([])
  })
})

describe('workspaces', () => {
  it('reads the package globs out of pnpm-workspace.yaml', () => {
    const patterns = parsePnpmPackages('packages:\n  - apps/*\n  - "packages/*"\n  - !docs\n\nshamefullyHoist: true\n')

    /* tinyglobby reads `!docs` as a pattern rather than an exclusion, so a
       negation kept here would search for a directory literally named `!docs`. */
    expect(patterns).toEqual(['apps/*', 'packages/*'])
  })

  it('offers only the workspace packages that have a framework', async () => {
    const root = await project({
      'package.json': '{"name":"mono","private":true}',
      'pnpm-workspace.yaml': 'packages:\n  - apps/*\n  - packages/*\n',
      'apps/web/package.json': '{"name":"web","dependencies":{"nuxt":"^4.0.0"}}',
      'apps/api/package.json': '{"name":"api","dependencies":{"nitro":"^3.0.0"}}',
      'packages/utils/package.json': '{"name":"utils"}',
    })

    const info = await resolveProject(root)
    const apps = findWorkspaceApps(info)

    expect(isWorkspaceRoot(info)).toBe(true)
    expect(apps.map(app => `${app.label}:${app.framework}`)).toEqual(['apps/api:nitro', 'apps/web:nuxt'])
  })
})
