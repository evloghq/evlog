import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getFramework } from '../../src/lib/frameworks'
import type { Framework, RawRouteEntry, ScanContext } from '../../src/lib/map/types'

const tempDirs: string[] = []

/** Write a throwaway project from a path → source map, and return its root. */
async function project(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'evlog-cli-adapter-'))
  tempDirs.push(root)
  for (const [path, source] of Object.entries(files)) {
    const file = join(root, path)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, source, 'utf8')
  }
  return root
}

async function routesOf(framework: Framework, root: string): Promise<RawRouteEntry[]> {
  const adapter = await getFramework(framework).map()
  return adapter.extractRoutes(scanContext(framework, root))
}

/** The capability `scan` would use: the per-project override, else the static one. */
async function requestLoggerOf(framework: Framework, root: string): Promise<'ambient' | 'explicit'> {
  const adapter = await getFramework(framework).map()
  return adapter.resolveRequestLogger?.(scanContext(framework, root)) ?? getFramework(framework).requestLogger
}

function scanContext(framework: Framework, root: string): ScanContext {
  return {
    projectRoot: root,
    framework,
    projectName: 'temp',
    hasEvlog: true,
    verbose: false,
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('next adapter', () => {
  it('finds routes in src/app when the project has no pages at all', async () => {
    const root = await project({
      'src/app/api/health/route.ts': 'export function GET() { return Response.json({ ok: true }) }',
    })

    const routes = await routesOf('next', root)

    expect(routes.map(route => `${route.method} ${route.path}`)).toEqual(['GET /api/health'])
  })

  it('gives the root handler the root path', async () => {
    const root = await project({
      'app/route.ts': 'export function GET() { return new Response("hi") }',
    })

    const routes = await routesOf('next', root)

    expect(routes[0]?.path).toBe('/')
  })

  it('reads a method exported under an alias', async () => {
    const root = await project({
      'app/api/orders/route.ts': [
        'async function handler() { return Response.json([]) }',
        'export { handler as GET }',
      ].join('\n'),
    })

    const routes = await routesOf('next', root)

    expect(routes.map(route => route.method)).toEqual(['GET'])
  })

  it('still collects server actions once the cheap text filter is in the way', async () => {
    const root = await project({
      'app/actions/orders.ts': [
        '"use server"',
        'export async function createOrder() { return { id: 1 } }',
      ].join('\n'),
      'app/lib/plain.ts': 'export function helper() { return 1 }',
    })

    const routes = await routesOf('next', root)

    expect(routes.map(route => route.path)).toEqual(['action:createOrder'])
  })

  /* Next treats every export of a `'use server'` module as a public endpoint, so
     a spelling the adapter cannot read is an unscanned POST handler. */
  it.each([
    ['a function declaration', 'export async function createOrder() {}', 'action:createOrder'],
    ['an arrow constant', 'export const createOrder = async () => {}', 'action:createOrder'],
    ['a plain specifier', 'async function createOrder() {}\nexport { createOrder }', 'action:createOrder'],
    ['a renamed specifier', 'async function run() {}\nexport { run as createOrder }', 'action:createOrder'],
    ['a default function', 'export default async function createOrder() {}', 'action:createOrder'],
  ])('collects a server action declared as %s', async (_name, source, expected) => {
    const root = await project({ 'app/actions/orders.ts': `"use server"\n${source}` })

    const routes = await routesOf('next', root)

    expect(routes.map(route => route.path)).toEqual([expected])
  })

  it('leaves a re-export alone — the action belongs to the module it came from', async () => {
    const root = await project({
      'app/actions/orders.ts': '"use server"\nexport { createOrder } from \'./impl\'',
    })

    const routes = await routesOf('next', root)

    expect(routes).toEqual([])
  })
})

describe('nuxt adapter', () => {
  it.each(['ts', 'mjs', 'cjs', 'mts'])('reads the method and path off a .%s handler', async (ext) => {
    const root = await project({
      [`server/api/orders/checkout.post.${ext}`]: 'export default defineEventHandler(() => ({ ok: true }))',
    })

    const routes = await routesOf('nuxt', root)

    expect(routes.map(route => `${route.method} ${route.path}`)).toEqual(['POST /api/orders/checkout'])
  })

  it('gives server/routes handlers no /api prefix', async () => {
    const root = await project({
      'server/routes/health.get.ts': 'export default defineEventHandler(() => ({ ok: true }))',
    })

    const routes = await routesOf('nuxt', root)

    expect(routes.map(route => `${route.method} ${route.path}`)).toEqual(['GET /health'])
  })

  it.each(['app/pages', 'pages', 'src/pages'] as const)(
    'maps a page under %s and strips that root from the path',
    async (pageDir) => {
      const root = await project({
        [`${pageDir}/blog/[...slug].vue`]: '<script setup lang="ts"></script>',
      })

      const routes = await routesOf('nuxt', root)

      expect(routes.map(route => `${route.kind} ${route.path}`)).toEqual(['page /blog/:slug*'])
      expect(routes[0]?.file).toBe(`${pageDir}/blog/[...slug].vue`)
    },
  )

  it('collects pages from every populated root', async () => {
    const root = await project({
      'app/pages/index.vue': '<script setup lang="ts"></script>',
      'pages/about.vue': '<script setup lang="ts"></script>',
    })

    const routes = await routesOf('nuxt', root)

    expect(routes.map(route => `${route.path} (${route.file})`).sort()).toEqual([
      '/ (app/pages/index.vue)',
      '/about (pages/about.vue)',
    ])
  })
})

describe('nitro adapter', () => {
  it('derives the same paths as nuxt, one directory level up', async () => {
    const root = await project({
      'api/orders/checkout.post.ts': 'export default defineEventHandler(() => ({ ok: true }))',
      'routes/health.get.ts': 'export default defineEventHandler(() => ({ ok: true }))',
      'middleware/auth.ts': 'export default defineEventHandler(() => {})',
    })

    const routes = await routesOf('nitro', root)

    expect(routes.map(route => `${route.kind} ${route.method ?? '*'} ${route.path}`).sort()).toEqual([
      'api GET /health',
      'api POST /api/orders/checkout',
      'middleware * *',
    ])
  })
})

describe('tanstack-start adapter', () => {
  it('does not read "api" inside a longer word as an API route', async () => {
    const root = await project({
      'src/routes/capital.tsx': 'export const Route = createFileRoute("/capital")({})',
    })

    const routes = await routesOf('tanstack-start', root)

    expect(routes.map(route => route.kind)).toEqual(['page'])
  })

  it('ignores lowercase method-shaped properties', async () => {
    const root = await project({
      'src/routes/settings.tsx': [
        'const form = { get: () => null, delete: () => null }',
        'export const Route = createFileRoute("/settings")({ component: () => form })',
      ].join('\n'),
    })

    const routes = await routesOf('tanstack-start', root)

    expect(routes.map(route => `${route.kind} ${route.method ?? '*'}`)).toEqual(['page *'])
  })

  it('reads the uppercase handlers the framework actually honours', async () => {
    const root = await project({
      'src/routes/api/orders.ts': [
        'export const Route = createFileRoute("/api/orders")({',
        '  server: { handlers: { GET: async () => null, POST: async () => null } },',
        '})',
      ].join('\n'),
    })

    const routes = await routesOf('tanstack-start', root)

    expect(routes.map(route => route.method).sort()).toEqual(['GET', 'POST'])
  })
})

describe('hono adapter', () => {
  it('reads method and path off app.get / app.post registrations', async () => {
    const root = await project({
      'src/index.ts': [
        'import { Hono } from \'hono\'',
        'const app = new Hono()',
        'app.post(\'/checkout\', (c) => c.json({ ok: true }))',
        'app.get(\'/health\', (c) => c.json({ ok: true }))',
        'export default app',
      ].join('\n'),
    })

    const routes = await routesOf('hono', root)

    expect(routes.map(route => `${route.method} ${route.path}`).sort()).toEqual([
      'GET /health',
      'POST /checkout',
    ])
  })

  it('still finds routes when the app is not named app', async () => {
    const root = await project({
      'src/api.ts': [
        'import { Hono } from \'hono\'',
        'const api = new Hono()',
        'api.put(\'/orders/:id\', (c) => c.json({ ok: true }))',
        'export default api',
      ].join('\n'),
    })

    const routes = await routesOf('hono', root)

    expect(routes.map(route => `${route.method} ${route.path}`)).toEqual(['PUT /orders/:id'])
  })

  it('does not treat c.get(\'log\') as a route', async () => {
    const root = await project({
      'src/index.ts': [
        'import { Hono } from \'hono\'',
        'const app = new Hono()',
        'app.get(\'/health\', (c) => {',
        '  const log = c.get(\'log\')',
        '  log.set({ route: \'health\' })',
        '  return c.json({ ok: true })',
        '})',
        'export default app',
      ].join('\n'),
    })

    const routes = await routesOf('hono', root)

    expect(routes.map(route => `${route.method} ${route.path}`)).toEqual(['GET /health'])
  })

  it('does not treat HTTP client calls as routes', async () => {
    const root = await project({
      'src/index.ts': [
        'import { Hono } from \'hono\'',
        'import axios from \'axios\'',
        'const app = new Hono()',
        'app.get(\'/proxy\', async (c) => {',
        '  const res = await axios.get(\'/users\', { headers: {} })',
        '  return c.json(res.data)',
        '})',
        'export default app',
      ].join('\n'),
    })

    const routes = await routesOf('hono', root)

    expect(routes.map(route => `${route.method} ${route.path}`)).toEqual(['GET /proxy'])
  })

  it('reads app.on(\'GET\', \'/path\', …) registrations', async () => {
    const root = await project({
      'src/index.ts': [
        'import { Hono } from \'hono\'',
        'const app = new Hono()',
        'app.on(\'GET\', \'/status\', (c) => c.json({ ok: true }))',
        'export default app',
      ].join('\n'),
    })

    const routes = await routesOf('hono', root)

    expect(routes.map(route => `${route.method} ${route.path}`)).toEqual(['GET /status'])
  })

  it('expands app.on array methods and paths into one route per combination', async () => {
    const root = await project({
      'src/index.ts': [
        'import { Hono } from \'hono\'',
        'const app = new Hono()',
        'app.on([\'PUT\', \'DELETE\'], \'/posts/:id\', (c) => c.json({ ok: true }))',
        'app.on(\'GET\', [\'/hello\', \'/ja/hello\'], (c) => c.text(\'hi\'))',
        'export default app',
      ].join('\n'),
    })

    const routes = await routesOf('hono', root)

    expect(routes.map(route => `${route.method} ${route.path}`).sort()).toEqual([
      'DELETE /posts/:id',
      'GET /hello',
      'GET /ja/hello',
      'PUT /posts/:id',
    ])
  })

  it('resolves the request logger to ambient once app.use(evlog()) is registered', async () => {
    const root = await project({
      'src/index.ts': [
        'import { Hono } from \'hono\'',
        'import { evlog } from \'evlog/hono\'',
        'const app = new Hono()',
        'app.use(evlog())',
        'app.get(\'/health\', (c) => c.json({ ok: true }))',
        'export default app',
      ].join('\n'),
    })

    expect(await requestLoggerOf('hono', root)).toBe('ambient')
  })

  it('resolves the request logger to explicit when the middleware is never registered', async () => {
    const root = await project({
      'src/index.ts': [
        'import { Hono } from \'hono\'',
        'const app = new Hono()',
        'app.get(\'/health\', (c) => c.json({ ok: true }))',
        'export default app',
      ].join('\n'),
    })

    expect(await requestLoggerOf('hono', root)).toBe('explicit')
  })

  it('does not credit an evlog() call that is not evlog/hono\'s middleware', async () => {
    const root = await project({
      'src/index.ts': [
        'import { Hono } from \'hono\'',
        'import { evlog } from \'./local-helper\'',
        'const app = new Hono()',
        'app.use(evlog())',
        'export default app',
      ].join('\n'),
    })

    expect(await requestLoggerOf('hono', root)).toBe('explicit')
  })
})

describe('express adapter', () => {
  it('reads routes off the app and off a Router, with middleware before the handler', async () => {
    const root = await project({
      'src/index.ts': `import express from 'express'
const app = express()
app.get('/health', (req, res) => res.json({ ok: true }))
app.post('/orders', auth, async (req, res) => res.json({}))
app.use('/api', router)
app.get('view engine')`,
      'src/users.ts': `import { Router } from 'express'
const router = Router()
router.delete('/users/:id', handler)`,
    })

    const routes = await routesOf('express', root)

    expect(routes.map(route => `${route.method} ${route.path}`).sort()).toEqual([
      'DELETE /users/:id',
      'GET /health',
      'POST /orders',
    ])
  })

  it('resolves the request logger to ambient once app.use(evlog()) is registered', async () => {
    const root = await project({
      'src/index.ts': `import express from 'express'
import { evlog } from 'evlog/express'
const app = express()
app.use(evlog())`,
    })
    expect(await requestLoggerOf('express', root)).toBe('ambient')
  })

  it('stays explicit when the middleware is never registered', async () => {
    const root = await project({
      'src/index.ts': `import express from 'express'
const app = express()
app.get('/', (req, res) => res.end())`,
    })
    expect(await requestLoggerOf('express', root)).toBe('explicit')
  })
})

describe('fastify adapter', () => {
  it('reads shorthand routes with an options object and the route() object form', async () => {
    const root = await project({
      'src/index.ts': `import Fastify from 'fastify'
const app = Fastify()
app.get('/health', { schema }, async () => ({ ok: true }))
app.route({ method: ['PUT', 'PATCH'], url: '/users/:id', handler })
app.route({ method: 'DELETE', url: '/users/:id', handler: async () => {} })`,
    })

    const routes = await routesOf('fastify', root)

    expect(routes.map(route => `${route.method} ${route.path}`).sort()).toEqual([
      'DELETE /users/:id',
      'GET /health',
      'PATCH /users/:id',
      'PUT /users/:id',
    ])
  })

  it('resolves the request logger to ambient once app.register(evlog) is called', async () => {
    const root = await project({
      'src/index.ts': `import Fastify from 'fastify'
import { evlog } from 'evlog/fastify'
const app = Fastify()
await app.register(evlog, { drain })`,
    })
    expect(await requestLoggerOf('fastify', root)).toBe('ambient')
  })
})
