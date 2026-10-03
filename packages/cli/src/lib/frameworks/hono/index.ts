import { indent } from '../../map/utils'
import { defineFramework } from '../types'
import type { InitPlanner, MapAdapter } from '../types'

/**
 * Hono route methods → HTTP verb.
 *
 * `all` has no single verb (matches every method), so it lands as `method: null`.
 * `use` / `route` / `onError` are not entry points and are ignored.
 */
export const HONO_METHODS: ReadonlyMap<string, string | null> = new Map([
  ['get', 'GET'],
  ['post', 'POST'],
  ['put', 'PUT'],
  ['patch', 'PATCH'],
  ['delete', 'DELETE'],
  ['options', 'OPTIONS'],
  ['all', null],
])

/** Verbs with an `app.<verb>()` shorthand; anything else registers via `app.on()`. */
const SHORTHAND_VERBS = new Set([...HONO_METHODS.values()].filter((verb): verb is string => verb !== null))

export const hono = defineFramework({
  id: 'hono',
  label: 'Hono',
  docs: '/integrate/frameworks/hono',
  detect: { deps: ['hono'], specificity: 10 },
  accessor: '`c.get(\'log\')` or `useLogger()` from `evlog/hono` inside a route handler',
  requestLogger: 'explicit',
  shape: {
    loggerCall: 'const log = useLogger()',
    handler(route, body) {
      /* `app.on('PURGE', …)` routes have no `app.purge()` shorthand to suggest. */
      const open = route.method === null || SHORTHAND_VERBS.has(route.method)
        ? `app.${(route.method ?? 'all').toLowerCase()}('${route.path}', async (c) => {`
        : `app.on('${route.method}', '${route.path}', async (c) => {`
      return [open, ...body.map(line => indent(1, line)), '})']
    },
  },
  map: (): Promise<MapAdapter> => import('./map').then(module => module.default),
  init: (): Promise<InitPlanner> => import('./init').then(module => module.default),
})
