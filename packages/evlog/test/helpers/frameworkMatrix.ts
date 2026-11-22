import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { BaseEvlogOptions } from '../../src/shared/middleware'
import type { WideEvent } from '../../src/types'
import { createPipelineSpies, findEventViaDrain, waitForDrainCalls } from './framework'
import { defined, getDrainCallArg } from './defined'
import { AUDIT_PATH, EXCLUDED_AUDIT_PATH, MATRIX_TOKEN } from './matrixAudits'

export { AUDIT_PATH, EXCLUDED_AUDIT_PATH, recordMatrixAudits } from './matrixAudits'

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
   * `GET` {@link AUDIT_PATH} and {@link EXCLUDED_AUDIT_PATH} run
   * {@link recordMatrixAudits} with the request logger, then answer 200.
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
  /** Picks the event to assert on. Defaults to the first one for `request.path`. */
  match?: (event: WideEvent) => boolean
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

interface AuditCheck {
  name: string
  options: BuiltAppOptions
  path: string
  requestId: string
  /** Whether the route also emits its request event. */
  requestEvent: boolean
}

const AUDIT_HEADERS = { 'user-agent': 'matrix-agent/1', 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }

const auditChecks: AuditCheck[] = [
  {
    name: 'records each log.audit() call as its own event with the request context',
    options: {},
    path: AUDIT_PATH,
    requestId: 'matrix-audit',
    requestEvent: true,
  },
  {
    name: 'records the audits of a route filtered out by exclude',
    options: { exclude: [EXCLUDED_AUDIT_PATH] },
    path: EXCLUDED_AUDIT_PATH,
    requestId: 'matrix-audit-excluded',
    requestEvent: false,
  },
]

function assertMatrixAudits(events: WideEvent[], check: AuditCheck): void {
  const audits = events.flatMap(e => e.audit && e.requestId === check.requestId ? [e.audit] : [])
  expect(audits.toSorted((a, b) => a.id.localeCompare(b.id)).map(a => [a.action, a.outcome, a.tenantId])).toEqual([
    ['token.create', 'success', 'team_1'],
    ['team.delete', 'denied', 'team_2'],
  ])
  for (const audit of audits) {
    expect(audit.actor).toEqual(MATRIX_TOKEN)
    expect(audit.context).toMatchObject({ requestId: check.requestId, userAgent: 'matrix-agent/1', ip: '203.0.113.9' })
  }
  expect(events.filter(e => e.path === check.path && !e.audit)).toHaveLength(check.requestEvent ? 1 : 0)
}

/**
 * Checks only the built-app matrix runs: each fixture serves `GET /api/fork`,
 * which sets `viaUseLogger: true` through a zero-argument `useLogger()` and
 * forks `matrix_fork`, whose child sets `forked: true`.
 */
const builtAppChecks: MatrixCheck[] = [
  {
    name: 'returns the request logger from a zero-argument useLogger()',
    options: {},
    request: { method: 'GET', path: '/api/fork' },
    match: event => event.path === '/api/fork' && event.operation === undefined,
    assert(event) {
      expect(event.viaUseLogger).toBe(true)
    },
  },
  {
    name: 'emits a child event from log.fork(), passing the child to fn',
    options: {},
    request: { method: 'GET', path: '/api/fork', headers: { 'x-request-id': 'matrix-fork-parent' } },
    // The child of the previous check can still arrive while this one polls.
    match: event => event.operation === 'matrix_fork' && event._parentRequestId === 'matrix-fork-parent',
    assert(event) {
      expect(event).toMatchObject({ path: '/api/fork', forked: true })
      expect(event.requestId).not.toBe('matrix-fork-parent')
      expect(event.viaUseLogger).toBeUndefined()
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

    for (const check of auditChecks) {
      it(check.name, async () => {
        const { drain } = createPipelineSpies()
        const { fire, cleanup } = await adapter.mount({ drain, ...check.options })
        try {
          const { status } = await fire({ method: 'GET', path: check.path, headers: { ...AUDIT_HEADERS, 'x-request-id': check.requestId } })
          expect(status).toBe(200)
          // A later request's event arrives after any event the audited request emits.
          await fire({ method: 'GET', path: '/api/users' })
          await vi.waitFor(() => expect(findEventViaDrain(drain, e => e.path === '/api/users')).toBeDefined(), { timeout: 1000, interval: 5 })
          if (check.requestEvent) {
            await vi.waitFor(() => expect(findEventViaDrain(drain, e => e.path === check.path && !e.audit)).toBeDefined(), { timeout: 1000, interval: 5 })
          }
          assertMatrixAudits(drain.mock.calls.map(call => getDrainCallArg(call).event), check)
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
      const options: BuiltAppOptions = Object.assign({}, ...[...checks, ...auditChecks].map(check => check.options))
      built.app = await adapter.start({ ...options, exclude: [...options.exclude ?? [], DRAINED_PATH] })
      await built.app.drained()
    }, timeout)

    afterAll(async () => {
      await built.app?.cleanup()
    })

    for (const check of [...checks, ...builtAppChecks]) {
      it(check.name, async () => {
        const { fire, drained } = defined(built.app, `${adapter.name} app`)
        const { status } = await fire(check.request)
        expect(status).toBe(200)
        const event = await vi.waitFor(async () => {
          const events = await drained()
          return defined(events.find(check.match ?? (e => e.path === check.request.path)), `event for ${check.name}`)
        }, { timeout: 5_000, interval: 50 })
        check.assert(event)
      })
    }

    for (const check of auditChecks) {
      it(check.name, async () => {
        const { fire, drained } = defined(built.app, `${adapter.name} app`)
        const { status } = await fire({ method: 'GET', path: check.path, headers: { ...AUDIT_HEADERS, 'x-request-id': check.requestId } })
        expect(status).toBe(200)
        const events: WideEvent[] = []
        await vi.waitFor(async () => {
          events.push(...await drained())
          // The fixture awaits both audits before it answers, so only the request event can still be on its way.
          expect(events.some(e => e.path === check.path && !e.audit)).toBe(check.requestEvent)
        }, { timeout: 5_000, interval: 50 })
        assertMatrixAudits(events, check)
      })
    }
  })
}
