import { describe, expect, it } from 'vitest'
import type { AuditableLogger } from '../../src/audit'
import type { BaseEvlogOptions } from '../../src/shared/middleware'
import { assertHttpEventEmitted, createPipelineSpies, findEventViaDrain, waitForDrainCalls } from './framework'
import { defined, getDrainCallArg } from './defined'

/** Route the matrix filters out with `exclude`; it runs {@link recordMatrixAudit}. */
export const EXCLUDED_AUDIT_PATH = '/api/audit-excluded'

/** What {@link EXCLUDED_AUDIT_PATH} does with the request logger. */
export function recordMatrixAudit(log: Pick<AuditableLogger, 'audit'>): void {
  log.audit({ action: 'token.create', actor: { type: 'api', id: 'tok_12' }, target: { type: 'token', id: 'tok_99' } })
}

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
   * `GET` {@link EXCLUDED_AUDIT_PATH} runs {@link recordMatrixAudit} with the
   * request logger, then answers 200.
   */
  mount: (options: BaseEvlogOptions) => Promise<{
    fire: (req: { method?: string, path: string, headers?: Record<string, string> }) => Promise<{ status: number }>
    cleanup?: () => Promise<void>
  }>
}

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
    it('drains an event with method, path, status, level', async () => {
      const { drain } = createPipelineSpies()
      const { fire, cleanup } = await adapter.mount({ drain })
      try {
        await fire({ method: 'GET', path: '/api/users' })
        await waitForDrainCalls(drain)
        const event = assertHttpEventEmitted(drain, {
          path: '/api/users',
          method: 'GET',
          status: 200,
          level: 'info',
        })
        expect(event.duration).toBeDefined()
      } finally {
        await cleanup?.()
      }
    })

    it('preserves x-request-id when provided', async () => {
      const { drain } = createPipelineSpies()
      const { fire, cleanup } = await adapter.mount({ drain })
      try {
        await fire({ method: 'GET', path: '/api/users', headers: { 'x-request-id': 'shared-matrix-id' } })
        await waitForDrainCalls(drain)
        const event = defined(
          findEventViaDrain(drain, e => e.path === '/api/users'),
          'event with x-request-id',
        )
        expect(event.requestId).toBe('shared-matrix-id')
      } finally {
        await cleanup?.()
      }
    })

    it('honors per-route service overrides', async () => {
      const { drain } = createPipelineSpies()
      const { fire, cleanup } = await adapter.mount({
        drain,
        routes: { '/api/**': { service: 'matrix-service' } },
      })
      try {
        await fire({ method: 'GET', path: '/api/users' })
        await waitForDrainCalls(drain)
        const event = defined(
          findEventViaDrain(drain, e => e.path === '/api/users'),
          'event with service override',
        )
        expect(event.service).toBe('matrix-service')
      } finally {
        await cleanup?.()
      }
    })

    it('records the audit of a route filtered out by exclude', async () => {
      const { drain } = createPipelineSpies()
      const { fire, cleanup } = await adapter.mount({ drain, exclude: [EXCLUDED_AUDIT_PATH] })
      try {
        const { status } = await fire({ method: 'GET', path: EXCLUDED_AUDIT_PATH, headers: { 'x-request-id': 'matrix-audit-excluded' } })
        expect(status).toBe(200)
        await waitForDrainCalls(drain)
        expect(drain).toHaveBeenCalledTimes(1)
        expect(getDrainCallArg(drain.mock.calls[0]).event).toMatchObject({
          method: 'GET',
          path: EXCLUDED_AUDIT_PATH,
          requestId: 'matrix-audit-excluded',
          audit: { action: 'token.create', actor: { type: 'api', id: 'tok_12' }, target: { type: 'token', id: 'tok_99' }, outcome: 'success' },
        })
      } finally {
        await cleanup?.()
      }
    })
  })
}
