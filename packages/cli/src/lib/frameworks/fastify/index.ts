import { indent } from '../../map/utils'
import { defineFramework } from '../types'
import type { InitPlanner, MapAdapter } from '../types'

/** Fastify route methods → HTTP verb; `all` matches every method. */
export const FASTIFY_METHODS: ReadonlyMap<string, string | null> = new Map([
  ['get', 'GET'],
  ['post', 'POST'],
  ['put', 'PUT'],
  ['patch', 'PATCH'],
  ['delete', 'DELETE'],
  ['options', 'OPTIONS'],
  ['head', 'HEAD'],
  ['all', null],
])

export const fastify = defineFramework({
  id: 'fastify',
  label: 'Fastify',
  docs: '/integrate/frameworks/fastify',
  detect: { deps: ['fastify'], specificity: 10 },
  accessor: '`request.log`, or `useLogger()` from `evlog/fastify` below the handler',
  requestLogger: 'explicit',
  requestLoggerMember: 'log',
  shape: {
    loggerCall: 'const log = request.log',
    handler(route, body) {
      return [`app.${(route.method ?? 'all').toLowerCase()}('${route.path}', async (request, reply) => {`, ...body.map(line => indent(1, line)), '})']
    },
  },
  map: (): Promise<MapAdapter> => import('./map').then(module => module.default),
  init: (): Promise<InitPlanner> => import('./init').then(module => module.default),
})
