import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
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

  it.skipIf(process.platform === 'win32')('keeps a file it cannot read as a failing entry point', async ({ skip }) => {
    const root = await project({ ...EXPRESS, 'src/dark.ts': DARK })
    await chmod(join(root, 'src/dark.ts'), 0o000)
    skip(await readFile(join(root, 'src/dark.ts')).then(() => true, () => false), 'this process reads files whatever their mode')

    const result = await scan(await ctx(root, 'express'))

    const entry = result.map.routes.find(route => route.file === 'src/dark.ts')
    expect(entry?.checks['wide-event']).toMatchObject({ status: 'fail', message: 'file failed to parse' })
    expect(result.warnings).toEqual(['src/dark.ts failed to parse: cannot be read (EACCES)'])
  })

  it('gives an entry point the same id whether or not an ignored file declares its route too', async () => {
    const twin = 'import { Router } from \'express\'\nexport const twin = Router()\ntwin.get(\'/a\', (req, res) => { res.json(1) })\n'
    const alone = await scan(await ctx(await project({ ...EXPRESS, 'src/dark.ts': DARK }), 'express'))
    const shared = await scan({ ...await ctx(await project({ ...EXPRESS, 'src/dark.ts': DARK, 'src/twin.ts': twin }), 'express'), ignore: ['src/twin.ts'] })

    expect(shared.map.routes.map(route => route.id)).toEqual(alone.map.routes.map(route => route.id))
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

describe('a file that declares several entry points', () => {
  const roots: string[] = []

  async function scanned(framework: ScanContext['framework'], dependencies: Record<string, string>, files: Record<string, string>): Promise<ScanResult> {
    const root = await mkdtemp(join(tmpdir(), 'evlog-cli-handlers-'))
    roots.push(root)
    const all = { 'package.json': JSON.stringify({ name: 'shop', dependencies }), ...files }
    for (const [path, source] of Object.entries(all)) {
      const file = join(root, path)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, source, 'utf8')
    }
    return scan(await ctx(root, framework))
  }

  afterAll(async () => {
    await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })))
  })

  /** `METHOD path` → the status of `check`, for every entry point. */
  function statuses(result: ScanResult, check: 'wide-event' | 'context' | 'audit' | 'structured-errors' | 'error-handling'): Record<string, string | undefined> {
    return Object.fromEntries(result.map.routes.map(route => [`${route.method} ${route.path}`, route.checks[check]?.status]))
  }

  const EXPRESS_DEPS = { express: '^5.0.0', evlog: '^2.0.0' }
  const EXPRESS_HEAD = [
    'import express from \'express\'',
    'import { evlog } from \'evlog/express\'',
    'const app = express()',
    'app.use(evlog())',
  ]

  it('judges each handler on its own code', async () => {
    const result = await scanned('express', EXPRESS_DEPS, {
      'src/app.ts': [
        ...EXPRESS_HEAD,
        'app.get(\'/health\', (req, res) => { req.log.set({ health: { ok: true } }); res.json({}) })',
        'app.get(\'/users\', async (req, res) => { res.json(await db.users.list()) })',
        'app.post(\'/users\', async (req, res) => { res.json(await db.users.add(req.body)) })',
      ].join('\n'),
    })

    expect(statuses(result, 'wide-event')).toEqual({ 'GET /health': 'pass', 'GET /users': 'fail', 'POST /users': 'fail' })
    expect(statuses(result, 'context')).toEqual({ 'GET /health': 'pass', 'GET /users': 'fail', 'POST /users': 'fail' })
    expect(result.map.routes.map(route => route.event?.fields)).toEqual([['health.ok'], undefined, undefined])
    expect(result.map.routes.map(route => route.score)).toEqual([100, 45, 45])
  })

  it('follows a handler passed by name, and the helpers it calls in the same file', async () => {
    const result = await scanned('express', EXPRESS_DEPS, {
      'src/app.ts': [
        ...EXPRESS_HEAD,
        'function describeOrder(req) { req.log.set({ order: { id: req.params.id } }) }',
        'const showOrder = async (req, res) => { describeOrder(req); res.json({}) }',
        'async function listOrders(req, res) { res.json([]) }',
        'app.get(\'/orders/:id\', requireUser, showOrder)',
        'app.get(\'/orders\', requireUser, listOrders)',
      ].join('\n'),
    })

    expect(statuses(result, 'context')).toEqual({ 'GET /orders/:id': 'pass', 'GET /orders': 'fail' })
    expect(result.map.routes[0]!.event).toEqual({ fields: ['order.id'], audit: [] })
  })

  it('keeps crediting a logger the file creates once for all its handlers', async () => {
    const result = await scanned('hono', { hono: '^4.0.0', evlog: '^2.0.0' }, {
      'src/app.ts': [
        'import { Hono } from \'hono\'',
        'import { createLogger } from \'evlog\'',
        'const log = createLogger()',
        'const app = new Hono()',
        'app.get(\'/a\', (c) => { log.set({ a: 1 }); return c.json({}) })',
        'app.get(\'/b\', c => c.json({}))',
      ].join('\n'),
    })

    expect(statuses(result, 'context')).toEqual({ 'GET /a': 'pass', 'GET /b': 'fail' })
  })

  it('reads a chained registration one call at a time', async () => {
    const result = await scanned('hono', { hono: '^4.0.0', evlog: '^2.0.0' }, {
      'src/app.ts': [
        'import { Hono } from \'hono\'',
        'export default new Hono()',
        '  .get(\'/a\', (c) => { const log = c.get(\'log\'); log.set({ a: 1 }); return c.json({}) })',
        '  .post(\'/b\', c => c.json({}))',
      ].join('\n'),
    })

    expect(statuses(result, 'wide-event')).toEqual({ 'GET /a': 'pass', 'POST /b': 'fail' })
  })

  it('flags as sensitive only the handler that uses the import or the field', async () => {
    const result = await scanned('express', { ...EXPRESS_DEPS, stripe: '^18.0.0' }, {
      'src/app.ts': [
        ...EXPRESS_HEAD,
        'import Stripe from \'stripe\'',
        'const stripe = new Stripe(process.env.STRIPE_KEY)',
        'app.post(\'/orders\', async (req, res) => { res.json(await stripe.charges.create({ amount: 1 })) })',
        'app.post(\'/profile\', async (req, res) => { res.json(await db.users.update({ email: req.body.email })) })',
        'app.get(\'/health\', (req, res) => { res.json({ ok: true }) })',
      ].join('\n'),
    })

    expect(result.map.routes.map(route => [route.path, route.sensitivity.level])).toEqual([['/orders', 'high'], ['/profile', 'medium'], ['/health', 'none']])
    expect(statuses(result, 'audit')).toEqual({ 'POST /orders': 'fail', 'POST /profile': 'n/a', 'GET /health': 'n/a' })
  })

  it('keeps a thrown error and a swallowed one with the handler that wrote them', async () => {
    const result = await scanned('fastify', { fastify: '^5.0.0', evlog: '^2.0.0' }, {
      'src/app.ts': [
        'import Fastify from \'fastify\'',
        'const app = Fastify()',
        'app.get(\'/a\', async () => { throw new Error(\'nope\') })',
        'app.get(\'/b\', async () => { try { await work() } catch {} })',
        'app.route({ method: \'GET\', url: \'/c\', handler: async () => ({ ok: true }) })',
      ].join('\n'),
    })

    expect(statuses(result, 'structured-errors')).toEqual({ 'GET /a': 'fail', 'GET /b': 'n/a', 'GET /c': 'n/a' })
    expect(statuses(result, 'error-handling')).toEqual({ 'GET /a': 'n/a', 'GET /b': 'fail', 'GET /c': 'n/a' })
  })

  it('judges each method a Next route file exports, however it is exported', async () => {
    const result = await scanned('next', { next: '^16.0.0', evlog: '^2.0.0' }, {
      'app/api/orders/route.ts': [
        'import { useLogger, withEvlog } from \'evlog/next\'',
        'export async function GET() { const log = useLogger(); log.set({ orders: { listed: true } }); return Response.json([]) }',
        'export const POST = async () => Response.json({})',
        'const remove = withEvlog(async () => Response.json({}))',
        'const replace = async () => Response.json({})',
        'export { remove as DELETE, replace as PUT }',
      ].join('\n'),
    })

    expect(statuses(result, 'wide-event')).toEqual({ 'GET /api/orders': 'pass', 'POST /api/orders': 'fail', 'DELETE /api/orders': 'pass', 'PUT /api/orders': 'fail' })
    expect(statuses(result, 'context')).toEqual({ 'GET /api/orders': 'pass', 'POST /api/orders': 'fail', 'DELETE /api/orders': 'fail', 'PUT /api/orders': 'fail' })
  })

  it('judges each action a server module exports', async () => {
    const result = await scanned('next', { next: '^16.0.0', evlog: '^2.0.0' }, {
      'app/page.tsx': 'export default function Page() { return <main /> }\n',
      'app/actions.ts': [
        '\'use server\'',
        'import { useLogger } from \'evlog/next\'',
        'export async function createOrder() { useLogger().set({ order: { id: 1 } }) }',
        'export const cancelOrder = async () => {}',
      ].join('\n'),
    })

    const actions = Object.fromEntries(result.map.routes.filter(route => route.kind === 'server-action').map(route => [route.path, route.checks.context?.status]))
    expect(actions).toEqual({ 'action:createOrder': 'pass', 'action:cancelOrder': 'fail' })
  })

  it('judges each method a TanStack Start route handles', async () => {
    const result = await scanned('tanstack-start', { '@tanstack/react-start': '^1.0.0', 'evlog': '^2.0.0' }, {
      'src/routes/api/orders.ts': [
        'import { createFileRoute } from \'@tanstack/react-router\'',
        'import { useRequest } from \'nitro/context\'',
        'export const Route = createFileRoute(\'/api/orders\')({ server: { handlers: {',
        '  GET: async () => { useRequest().context.log.set({ orders: { listed: true } }); return Response.json([]) },',
        '  POST: async () => Response.json({}),',
        '} } })',
      ].join('\n'),
    })

    expect(statuses(result, 'context')).toEqual({ 'GET /api/orders': 'pass', 'POST /api/orders': 'fail' })
  })

  it('writes nothing about where a handler sits into the map', async () => {
    const result = await scanned('express', EXPRESS_DEPS, {
      'src/app.ts': [...EXPRESS_HEAD, 'app.get(\'/ok\', (req, res) => { res.json({}) })'].join('\n'),
    })

    expect(Object.keys(result.map.routes[0]!).sort()).toEqual(['checks', 'file', 'framework', 'handler', 'id', 'kind', 'method', 'path', 'score', 'sensitivity', 'suggestions'])
  })
})

describe('the logger an integration parks on the request', () => {
  const roots: string[] = []

  async function fastify(dependencies: Record<string, string>, lines: string[]): Promise<ScanResult> {
    const root = await mkdtemp(join(tmpdir(), 'evlog-cli-request-'))
    roots.push(root)
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'shop', dependencies }), 'utf8')
    await writeFile(join(root, 'src/app.ts'), lines.join('\n'), 'utf8')
    return scan(await ctx(root, 'fastify'))
  }

  afterAll(async () => {
    await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })))
  })

  it('does not take Fastify\'s own request.log for evlog in an app without evlog', async () => {
    const result = await fastify({ fastify: '^5.0.0' }, [
      'import Fastify from \'fastify\'',
      'const app = Fastify({ logger: true })',
      'app.get(\'/orders\', async (request) => { request.log.info(\'listing orders\'); return [] })',
    ])

    expect(result.map.routes[0]!.checks['wide-event']).toMatchObject({ status: 'fail', message: 'evlog not installed — adopt evlog for wide events' })
    expect(result.map.routes[0]!.score).toBe(45)
  })

  it('takes request.log for evlog once the app registers the plugin', async () => {
    const result = await fastify({ fastify: '^5.0.0', evlog: '^2.0.0' }, [
      'import Fastify from \'fastify\'',
      'import { evlog } from \'evlog/fastify\'',
      'const app = Fastify()',
      'await app.register(evlog)',
      'app.get(\'/orders\', async (request) => { request.log.info(\'listing orders\'); return [] })',
    ])

    expect(result.map.routes[0]!.checks['wide-event']?.status).toBe('pass')
  })

  it('credits request.evlog', async () => {
    const result = await fastify({ fastify: '^5.0.0', evlog: '^2.0.0' }, [
      'import Fastify from \'fastify\'',
      'import { evlog } from \'evlog/fastify\'',
      'const app = Fastify()',
      'await app.register(evlog)',
      'app.get(\'/orders\', async (request) => { request.evlog.set({ orders: { listed: true } }); return [] })',
    ])

    expect(result.map.routes[0]!.score).toBe(100)
    expect(result.map.routes[0]!.event).toEqual({ fields: ['orders.listed'], audit: [] })
  })
})

describe('the event an entry point carries', () => {
  let root: string
  let result: ScanResult

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'evlog-cli-event-'))
    const files: Record<string, string> = {
      'package.json': JSON.stringify({ name: 'shop', dependencies: { evlog: '^2.0.0', nuxt: '^4.0.0' } }),
      'server/api/checkout.post.ts': [
        'export default defineEventHandler(async (event) => {',
        '  const log = useLogger(event)',
        '  const cache = new Map()',
        '  cache.set(\'k\', 1)',
        '  log.set({ user: { id: 1, plan: \'pro\' }, cart: { items: 3 }, ...extra, [dynamic]: 1 })',
        '  log.set({ user: { id: 1 }, total: 42 })',
        '  log.set({ order: { id: 1, payment: { method: \'card\' } as const } } as Context)',
        '  log.set({ shipping: { zone: \'eu\' } } satisfies Context)',
        '  log.audit({ action: \'checkout.completed\', actor: { type: \'user\', id: 1 } })',
        '  log.audit({ action: kind })',
        '  log.audit({ [action]: \'refund.issued\' })',
        '  log.audit({ action: \'order.refunded\' } as const)',
        '  log.audit({ action: \'order.cancelled\' as const } satisfies AuditInput)',
        '  return { ok: true }',
        '})',
      ].join('\n'),
      'server/api/health.get.ts': 'export default defineEventHandler(() => ({ ok: true }))',
    }
    for (const [path, source] of Object.entries(files)) {
      const file = join(root, path)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, source, 'utf8')
    }
    result = await scan(await ctx(root, 'nuxt'))
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('lists the dotted paths log.set() writes, once each, and the literal audit actions', () => {
    const checkout = result.map.routes.find(r => r.path === '/api/checkout')
    expect(checkout?.event).toEqual({
      fields: ['user.id', 'user.plan', 'cart.items', 'total', 'order.id', 'order.payment.method', 'shipping.zone'],
      audit: ['checkout.completed', 'order.refunded', 'order.cancelled'],
    })
  })

  it('leaves the event out of an entry point that sets nothing', () => {
    expect(result.map.routes.find(r => r.path === '/api/health')).not.toHaveProperty('event')
  })
})
