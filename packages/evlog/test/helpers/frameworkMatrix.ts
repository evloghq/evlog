import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { BaseEvlogOptions } from '../../src/shared/middleware'
import type { WideEvent } from '../../src/types'
import { createPipelineSpies, findEventViaDrain, waitForDrainCalls } from './framework'
import { defined } from './defined'

type MatrixRequest = { method?: string, path: string, headers?: Record<string, string> }
type Fire = (req: MatrixRequest) => Promise<{ status: number }>

/**
 * Minimal viable surface every framework adapter must expose for the shared
 * matrix to drive it. Keep this small — the matrix is best-effort coverage of
 * the *truly identical* specs across all frameworks; framework-specific tests
 * (Elysia status, Hono throw paths, SvelteKit hooks, NestJS module API,
 * Next instrumentation, Fastify inject semantics) live in their own files.
 */
export interface FrameworkAdapter {
  name: string
  /**
   * Build a fresh app + a `fire` function for that app. The adapter owns the
   * mounting (via `app.use`, `register`, `c.use`, ...) and translates a
   * `{ method, path, headers }` request shape to its native firing API.
   *
   * The single GET route at `/api/users` returns `{ users: [] }` with status
   * 200; tests use other paths only when relevant (e.g. include/exclude).
   */
  mount: (options: BaseEvlogOptions) => Promise<{
    fire: Fire
    cleanup?: () => Promise<void>
  }>
}

/** Route a {@link BuiltAppAdapter} app serves its drained events on. The matrix excludes it. */
export const DRAINED_PATH = '/matrix-drained'

/** Options a built app takes in its config: the callbacks cannot cross the build. */
export type BuiltAppOptions = Pick<BaseEvlogOptions, 'include' | 'exclude' | 'routes'>

/**
 * An integration that receives its options through a built app's config
 * (Nitro, Nuxt). The app is built once per suite with every check's options
 * merged, drains through an `evlog:drain` hook, and serves what it drained.
 */
export interface BuiltAppAdapter {
  name: string
  /**
   * Build and serve the app with `options` in its evlog config. Besides
   * `/api/users`, the app answers `GET` {@link DRAINED_PATH} with the events
   * drained since the last call; `drained()` reads it.
   */
  start: (options: BuiltAppOptions) => Promise<{
    fire: Fire
    drained: () => Promise<WideEvent[]>
    cleanup: () => Promise<void>
  }>
}

interface MatrixCheck {
  name: string
  options: BuiltAppOptions
  request: MatrixRequest
  assert: (event: WideEvent) => void
}

const checks: MatrixCheck[] = [
  {
    name: 'drains an event with method, path, status, level',
    options: {},
    request: { method: 'GET', path: '/api/users' },
    assert(event) {
      expect(event).toMatchObject({ method: 'GET', path: '/api/users', status: 200, level: 'info' })
      expect(event.duration).toBeDefined()
    },
  },
  {
    name: 'preserves x-request-id when provided',
    options: {},
    request: { method: 'GET', path: '/api/users', headers: { 'x-request-id': 'shared-matrix-id' } },
    assert(event) {
      expect(event.requestId).toBe('shared-matrix-id')
    },
  },
  {
    name: 'honors per-route service overrides',
    options: { routes: { '/api/**': { service: 'matrix-service' } } },
    request: { method: 'GET', path: '/api/users' },
    assert(event) {
      expect(event.service).toBe('matrix-service')
    },
  },
]

/**
 * Run the shared HTTP middleware spec against a framework adapter. Asserts
 * via injected drain spy (never `console.info` parsing) so semantics are
 * portable across Express, Hono, Elysia, Fastify, NestJS, SvelteKit, and
 * react-router.
 *
 * Use under a top-level `describe('evlog/<framework>', ...)` inside each
 * framework test file to anchor the framework-specific blocks alongside.
 *
 * @example
 * ```ts
 * describeStandardHttpMatrix({
 *   name: 'express',
 *   async mount(options) {
 *     const app = express()
 *     app.use(evlog(options))
 *     app.get('/api/users', (_req, res) => res.json({ users: [] }))
 *     return {
 *       async fire(req) {
 *         const r = await request(app)[req.method?.toLowerCase() || 'get'](req.path).set(req.headers || {})
 *         return { status: r.status }
 *       },
 *     }
 *   },
 * })
 * ```
 */
export function describeStandardHttpMatrix(adapter: FrameworkAdapter): void {
  describe(`shared http matrix (${adapter.name})`, () => {
    for (const check of checks) {
      it(check.name, async () => {
        const { drain } = createPipelineSpies()
        const { fire, cleanup } = await adapter.mount({ drain, ...check.options })
        try {
          await fire(check.request)
          await waitForDrainCalls(drain)
          check.assert(defined(findEventViaDrain(drain, e => e.path === check.request.path), `event for ${check.request.path}`))
        } finally {
          await cleanup?.()
        }
      })
    }
  })
}

/**
 * The same spec as {@link describeStandardHttpMatrix}, for an integration
 * configured at build time. The checks run in order against one app built
 * with all their options merged, so each check only asserts the field its own
 * options control.
 */
export function describeBuiltAppMatrix(adapter: BuiltAppAdapter, timeout = 180_000): void {
  describe.sequential(`shared http matrix (${adapter.name})`, () => {
    const built: { app?: Awaited<ReturnType<BuiltAppAdapter['start']>> } = {}

    beforeAll(async () => {
      const options: BuiltAppOptions = Object.assign({}, ...checks.map(check => check.options))
      built.app = await adapter.start({ ...options, exclude: [...options.exclude ?? [], DRAINED_PATH] })
      await built.app.drained()
    }, timeout)

    afterAll(async () => {
      await built.app?.cleanup()
    })

    for (const check of checks) {
      it(check.name, async () => {
        const { fire, drained } = defined(built.app, `${adapter.name} app`)
        const { status } = await fire(check.request)
        expect(status).toBe(200)
        const event = await vi.waitFor(async () => {
          const events = await drained()
          return defined(events.find(e => e.path === check.request.path), `event for ${check.request.path}`)
        }, { timeout: 5_000, interval: 50 })
        check.assert(event)
      })
    }
  })
}
