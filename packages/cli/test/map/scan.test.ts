import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { getFramework } from '../../src/lib/frameworks'
import { detectFramework } from '../../src/lib/map/detect'
import { scan } from '../../src/lib/map/scan'
import type { ScanContext, ScanResult } from '../../src/lib/map/types'
import { extractMethodFromFilename, relativeFromRoot, segmentsToPath } from '../../src/lib/map/utils'
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
