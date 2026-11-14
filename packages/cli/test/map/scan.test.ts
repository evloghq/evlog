import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getFramework } from '../../src/lib/frameworks'
import { detectFramework } from '../../src/lib/map/detect'
import { scan } from '../../src/lib/map/scan'
import type { ScanContext, ScanResult } from '../../src/lib/map/types'
import { extractMethodFromFilename, relativeFromRoot, routeId, segmentsToPath } from '../../src/lib/map/utils'
import { mapForSnapshot } from '../../src/lib/map/write'
import { resolveProject } from '../../src/lib/project'

const FIXTURES = join(import.meta.dirname, 'fixtures')

async function ctx(root: string, framework: ScanContext['framework']): Promise<ScanContext> {
  const project = await resolveProject(root)
  const deps = { ...project.packageJson?.dependencies, ...project.packageJson?.devDependencies }
  return {
    projectRoot: project.packageDir,
    framework,
    projectName: project.packageName ?? 'unknown',
    hasEvlog: 'evlog' in deps,
    verbose: false,
  }
}

describe('utils', () => {
  it('extracts HTTP method from filename', () => {
    expect(extractMethodFromFilename('checkout.post.ts')).toBe('POST')
    expect(extractMethodFromFilename('health.get.ts')).toBe('GET')
    expect(extractMethodFromFilename('index.ts')).toBeNull()
  })

  it('converts segments to path', () => {
    expect(segmentsToPath(['orders', '[id]'], '/api')).toBe('/api/orders/:id')
    expect(segmentsToPath(['docs', '[...slug]'], '/api')).toBe('/api/docs/:slug*')
    expect(segmentsToPath(['(group)', 'about'])).toBe('/about')
  })

  it('relativises a file against the project root', () => {
    expect(relativeFromRoot('/app', '/app/server/api/foo.ts')).toBe('server/api/foo.ts')
  })

  it('survives a root with a trailing separator', () => {
    /* A prefix comparison eats the first character here and yields `erver/…`,
       which no longer resolves to a file when the scan reads it back. */
    expect(relativeFromRoot('/app/', '/app/server/api/foo.ts')).toBe('server/api/foo.ts')
  })

  it('leaves a file outside the root untouched', () => {
    expect(relativeFromRoot('/app', '/elsewhere/foo.ts')).toBe('/elsewhere/foo.ts')
  })
})

describe('detect', () => {
  it('detects nuxt in fixture', async () => {
    const project = await resolveProject(join(FIXTURES, 'nuxt-basic'))
    const result = detectFramework(project)
    expect(result.framework).toBe('nuxt')
  })

  it('detects next in fixture', async () => {
    const project = await resolveProject(join(FIXTURES, 'next-app-router'))
    const result = detectFramework(project)
    expect(result.framework).toBe('next')
  })

  it('detects tanstack-start in fixture', async () => {
    const project = await resolveProject(join(FIXTURES, 'tanstack-basic'))
    const result = detectFramework(project)
    expect(result.framework).toBe('tanstack-start')
  })

  it('detects hono in fixture', async () => {
    const project = await resolveProject(join(FIXTURES, 'hono-basic'))
    const result = detectFramework(project)
    expect(result.framework).toBe('hono')
  })

  it.each(['express', 'fastify'] as const)('detects %s in fixture', async (framework) => {
    const project = await resolveProject(join(FIXTURES, `${framework}-basic`))
    expect(detectFramework(project).framework).toBe(framework)
  })
})

describe('code-first extraction', () => {
  it.each(['express', 'fastify'] as const)('extracts all routes from the %s-basic fixture', async (framework) => {
    const root = join(FIXTURES, `${framework}-basic`)
    const adapter = await getFramework(framework).map()
    const routes = await adapter.extractRoutes(await ctx(root, framework))

    const paths = routes.map(r => `${r.method ?? '*'} ${r.path} (${r.kind})`).sort()
    expect(paths).toEqual([
      'GET /health (api)',
      'POST /checkout (api)',
    ])
  })

  it.each(['express', 'fastify'] as const)('credits the %s request logger and finds the dark health route', async (framework) => {
    const root = join(FIXTURES, `${framework}-basic`)
    const result = await scan(await ctx(root, framework))
    const byPath = Object.fromEntries(result.map.routes.map(route => [route.path, route]))
    expect(byPath['/checkout']!.checks['wide-event']!.status).toBe('pass')
    expect(byPath['/checkout']!.checks.audit!.status).toBe('pass')
    expect(byPath['/health']!.checks['wide-event']!.status).toBe('fail')
  })
})

describe('nuxt extraction', () => {
  it('extracts all routes from nuxt-basic fixture', async () => {
    const root = join(FIXTURES, 'nuxt-basic')
    const adapter = await getFramework('nuxt').map()
    const routes = await adapter.extractRoutes(await ctx(root, 'nuxt'))

    const paths = routes.map(r => `${r.method ?? '*'} ${r.path} (${r.kind})`).sort()
    expect(paths).toMatchInlineSnapshot(`
      [
        "* * (middleware)",
        "* / (page)",
        "* /orders/:id (page)",
        "* /tasks/cleanup (cron)",
        "GET /api/broken-error (api)",
        "GET /api/docs/:slug* (api)",
        "GET /api/orders/:id (api)",
        "GET /api/plain-error (api)",
        "GET /health (api)",
        "HEAD /api/orders/:id (api)",
        "POST /api/checkout (api)",
        "POST /api/payments/stripe (api)",
      ]
    `)
  })
})

describe('next extraction', () => {
  it('extracts all routes from next-app-router fixture', async () => {
    const root = join(FIXTURES, 'next-app-router')
    const adapter = await getFramework('next').map()
    const routes = await adapter.extractRoutes(await ctx(root, 'next'))

    const paths = routes.map(r => `${r.method ?? '*'} ${r.path} (${r.kind})`).sort()
    expect(paths).toContain('GET /api/health (api)')
    expect(paths).toContain('POST /api/checkout (api)')
    expect(paths).toContain('POST /api/payments (api)')
    expect(paths).toContain('GET /api/error (api)')
    expect(paths).toContain('* / (page)')
    expect(paths).toContain('POST action:createOrder (server-action)')
    expect(paths).toContain('* * (middleware)')
  })
})

describe('tanstack extraction', () => {
  it('extracts routes from tanstack-basic fixture', async () => {
    const root = join(FIXTURES, 'tanstack-basic')
    const adapter = await getFramework('tanstack-start').map()
    const routes = await adapter.extractRoutes(await ctx(root, 'tanstack-start'))

    const paths = routes.map(r => `${r.method ?? '*'} ${r.path} (${r.kind})`).sort()
    expect(paths).toContain('POST /api/checkout (api)')
    expect(paths).toContain('GET /api/hello (api)')
    expect(paths).toContain('* / (page)')
    expect(paths).toContain('POST /api/admin (api)')
  })
})

describe('hono extraction', () => {
  it('extracts all routes from hono-basic fixture', async () => {
    const root = join(FIXTURES, 'hono-basic')
    const adapter = await getFramework('hono').map()
    const routes = await adapter.extractRoutes(await ctx(root, 'hono'))

    const paths = routes.map(r => `${r.method ?? '*'} ${r.path} (${r.kind})`).sort()
    expect(paths).toEqual([
      'GET /health (api)',
      'POST /checkout (api)',
    ])
  })
})

describe('full scan snapshots', () => {
  it('nuxt-basic map snapshot', async () => {
    const root = join(FIXTURES, 'nuxt-basic')
    const result = await scan(await ctx(root, 'nuxt'))
    expect(mapForSnapshot(result.map)).toMatchSnapshot()
  })

  it('next-app-router map snapshot', async () => {
    const root = join(FIXTURES, 'next-app-router')
    const result = await scan(await ctx(root, 'next'))
    expect(mapForSnapshot(result.map)).toMatchSnapshot()
  })

  it('tanstack-basic map snapshot', async () => {
    const root = join(FIXTURES, 'tanstack-basic')
    const result = await scan(await ctx(root, 'tanstack-start'))
    expect(mapForSnapshot(result.map)).toMatchSnapshot()
  })

  it('hono-basic map snapshot', async () => {
    const root = join(FIXTURES, 'hono-basic')
    const result = await scan(await ctx(root, 'hono'))
    expect(mapForSnapshot(result.map)).toMatchSnapshot()
  })
})

describe('checks', () => {
  /* One scan for the suite: every case below reads the same fixture, and
     re-parsing it four times only makes the suite slower. */
  let result: ScanResult

  beforeAll(async () => {
    result = await scan(await ctx(join(FIXTURES, 'nuxt-basic'), 'nuxt'))
  })

  it('flags empty catch blocks', () => {
    const stripe = result.map.routes.find(r => r.path === '/api/payments/stripe')
    expect(stripe?.checks['error-handling']?.status).toBe('fail')
  })

  it('passes instrumented checkout route', () => {
    const checkout = result.map.routes.find(r => r.path === '/api/checkout')
    expect(checkout?.checks['wide-event']?.status).toBe('pass')
    expect(checkout?.checks['context']?.status).toBe('pass')
    expect(checkout?.checks['audit']?.status).toBe('pass')
    expect(checkout?.score).toBe(100)
  })

  it('flags createError missing fix', () => {
    const broken = result.map.routes.find(r => r.path === '/api/broken-error')
    expect(broken?.checks['structured-errors']?.status).toBe('fail')
  })

  it('flags plain throw new Error', () => {
    const plain = result.map.routes.find(r => r.path === '/api/plain-error')
    expect(plain?.checks['structured-errors']?.status).toBe('fail')
  })
})

describe('hono checks', () => {
  let result: ScanResult

  beforeAll(async () => {
    result = await scan(await ctx(join(FIXTURES, 'hono-basic'), 'hono'))
  })

  it('passes the instrumented checkout route that uses c.get(\'log\')', () => {
    const checkout = result.map.routes.find(r => r.path === '/checkout')
    expect(checkout?.checks['wide-event']?.status).toBe('pass')
    expect(checkout?.checks['context']?.status).toBe('pass')
    expect(checkout?.checks['audit']?.status).toBe('pass')
    expect(checkout?.score).toBe(100)
  })

  it('flags the dark health route', () => {
    const health = result.map.routes.find(r => r.path === '/health')
    expect(health?.checks['wide-event']?.status).toBe('fail')
    expect(health?.checks['context']?.status).toBe('fail')
  })
})

/* The setup from EVL-659: a Next.js app in a pnpm workspace that only ever
   imports a shared `@acme/logger` package, with evlog installed in that package
   and not in the app. */
describe('a workspace package that wraps evlog', () => {
  let root: string
  let result: ScanResult

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'evlog-cli-wrapper-'))
    const files: Record<string, string> = {
      'packages/logger/package.json': JSON.stringify({
        name: '@acme/logger',
        exports: { '.': './src/index.ts' },
        dependencies: { evlog: '^3.0.0' },
      }),
      'packages/logger/src/index.ts': 'import { createEvlog } from \'evlog/next\'\nexport const { withEvlog, useLogger } = createEvlog({ service: \'shop\' })',
      'packages/logger/node_modules/evlog/package.json': JSON.stringify({ name: 'evlog', version: '3.0.0' }),
      'apps/web/package.json': JSON.stringify({ name: 'web', dependencies: { '@acme/logger': 'workspace:*', 'next': '*' } }),
      'apps/web/app/api/orders/route.ts': [
        'import { useLogger, withEvlog } from \'@acme/logger\'',
        'export const POST = withEvlog(async () => {',
        '  useLogger().set({ order: { id: 1 } })',
        '  return Response.json({ ok: true })',
        '})',
      ].join('\n'),
      'apps/web/app/api/health/route.ts': 'export function GET() { return Response.json({ ok: true }) }',
      'apps/web/app/actions/checkout.ts': [
        '\'use server\'',
        'import { useLogger, withEvlog } from \'@acme/logger\'',
        'export const checkout = withEvlog(async () => {',
        '  useLogger().set({ cart: { id: 1 } })',
        '})',
      ].join('\n'),
    }
    for (const [path, source] of Object.entries(files)) {
      const file = join(root, path)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, source, 'utf8')
    }
    await mkdir(join(root, 'apps/web/node_modules/@acme'), { recursive: true })
    await symlink(join(root, 'packages/logger'), join(root, 'apps/web/node_modules/@acme/logger'), 'dir')

    result = await scan({ projectRoot: join(root, 'apps/web'), framework: 'next', projectName: 'web', hasEvlog: false, verbose: false })
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('credits a route handler that logs through the package', () => {
    const orders = result.map.routes.find(r => r.path === '/api/orders')
    expect(orders?.checks['wide-event']?.status).toBe('pass')
    expect(orders?.checks['context']?.status).toBe('pass')
  })

  it('lists and credits a server action wrapped by the package', () => {
    const checkout = result.map.routes.find(r => r.path === 'action:checkout')
    expect(checkout?.kind).toBe('server-action')
    expect(checkout?.checks['wide-event']?.status).toBe('pass')
  })

  it('treats evlog as installed when the package can reach it', () => {
    const health = result.map.routes.find(r => r.path === '/api/health')
    expect(health?.checks['wide-event']?.message).toMatch(/dark event/)
  })
})

describe('entry points a scan must not lose', () => {
  const roots: string[] = []

  async function project(files: Record<string, string>): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'evlog-cli-scan-'))
    roots.push(root)
    for (const [path, source] of Object.entries(files)) {
      const file = join(root, path)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, source, 'utf8')
    }
    return root
  }

  afterAll(async () => {
    await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })))
  })

  const EXPRESS = {
    'package.json': JSON.stringify({ name: 'shop', dependencies: { express: '^5.0.0', evlog: '^2.0.0' } }),
    'src/app.ts': [
      'import express from \'express\'',
      'import { evlog } from \'evlog/express\'',
      'const app = express()',
      'app.use(evlog())',
      'app.get(\'/ok\', (req, res) => { req.log.set({ ok: true }); res.json({}) })',
    ].join('\n'),
  }
  const DARK = [
    'import { Router } from \'express\'',
    'export const dark = Router()',
    'dark.get(\'/a\', (req, res) => { res.json(1) })',
    'dark.post(\'/b\', (req, res) => { res.json(1) })',
  ].join('\n')

  it('keeps a code-first file that stops parsing as a failing entry point', async () => {
    const clean = await scan(await ctx(await project({ ...EXPRESS, 'src/dark.ts': DARK }), 'express'))
    const broken = await scan(await ctx(await project({ ...EXPRESS, 'src/dark.ts': `${DARK}\nconst x = = 1\n` }), 'express'))

    const entry = broken.map.routes.find(route => route.file === 'src/dark.ts')
    expect(entry?.checks['wide-event']).toMatchObject({ status: 'fail', message: 'file failed to parse' })
    expect(broken.map.score).toBeLessThanOrEqual(clean.map.score)
    expect(broken.warnings).toEqual(['src/dark.ts failed to parse: Unexpected token'])
  })

  it('fails a file-based handler that stops parsing, whatever it logged before', async () => {
    const handler = 'export default defineEventHandler((event) => {\n  useLogger(event).set({ order: { id: 1 } })\n  return {}\n})\n'
    const result = await scan(await ctx(await project({
      'package.json': JSON.stringify({ name: 'shop', dependencies: { nuxt: '^4.0.0', evlog: '^2.0.0' } }),
      'server/api/orders.get.ts': `${handler}const x = = 1\n`,
    }), 'nuxt'))

    expect(result.map.routes).toHaveLength(1)
    expect(result.map.routes[0]!.checks['wide-event']).toMatchObject({ status: 'fail', message: 'file failed to parse' })
    expect(result.warnings).toEqual(['server/api/orders.get.ts failed to parse: Unexpected token'])
  })

  it('keeps a server action module that stops parsing', async () => {
    const result = await scan(await ctx(await project({
      'package.json': JSON.stringify({ name: 'shop', dependencies: { next: '^16.0.0' } }),
      'app/page.tsx': 'export default function Page() { return <main /> }\n',
      'app/actions.ts': '\'use server\'\nexport async function createOrder() {}\nconst x = = 1\n',
    }), 'next'))

    expect(result.map.routes.map(route => route.file).sort()).toEqual(['app/actions.ts', 'app/page.tsx'])
  })

  it('leaves a file in map.ignore out even when it does not parse', async () => {
    const root = await project({ ...EXPRESS, 'src/dark.ts': `${DARK}\nconst x = = 1\n` })
    const result = await scan({ ...await ctx(root, 'express'), ignore: ['src/dark.ts'] })

    expect(result.map.routes.map(route => route.file)).toEqual(['src/app.ts'])
    expect(result.warnings).toEqual([])
  })

  it('scans handlers in directories named build, dist and coverage', async () => {
    const handler = 'export default defineEventHandler(() => ({}))\n'
    const result = await scan(await ctx(await project({
      'package.json': JSON.stringify({ name: 'shop', dependencies: { nuxt: '^4.0.0' } }),
      'server/api/build/index.get.ts': handler,
      'server/api/dist/index.get.ts': handler,
      'server/api/coverage/index.get.ts': handler,
    }), 'nuxt'))

    expect(result.map.routes.map(route => route.path).sort()).toEqual(['/api/build', '/api/coverage', '/api/dist'])
  })

  it('gives two entry points with the same method and path their own ids', async () => {
    const router = (name: string, body: string): string => [
      'import { Router } from \'express\'',
      `export const ${name} = Router()`,
      `${name}.get('/', (req, res) => { ${body} })`,
    ].join('\n')
    const result = await scan(await ctx(await project({
      ...EXPRESS,
      'src/routes/orders.ts': router('orders', 'req.log.set({ orders: 1 }); res.json([])'),
      'src/routes/users.ts': `${router('users', 'res.json([])')}\nusers.get('/', (req, res) => { res.json([]) })`,
    }), 'express'))

    const ids = result.map.routes.map(route => route.id)
    expect(new Set(ids).size).toBe(ids.length)
    /* An entry point nothing collides with keeps the id older maps recorded. */
    expect(result.map.routes.find(route => route.path === '/ok')!.id).toBe(routeId({ framework: 'express', kind: 'api', method: 'GET', path: '/ok' }))
  })
})
