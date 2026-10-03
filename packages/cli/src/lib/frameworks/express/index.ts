import { indent } from '../../map/utils'
import { defineFramework } from '../types'
import type { InitPlanner, MapAdapter } from '../types'

/** Express route methods → HTTP verb; `all` matches every method. */
export const EXPRESS_METHODS: ReadonlyMap<string, string | null> = new Map([
  ['get', 'GET'],
  ['post', 'POST'],
  ['put', 'PUT'],
  ['patch', 'PATCH'],
  ['delete', 'DELETE'],
  ['options', 'OPTIONS'],
  ['head', 'HEAD'],
  ['all', null],
])

export const express = defineFramework({
  id: 'express',
  label: 'Express',
  docs: '/integrate/frameworks/express',
  detect: { deps: ['express'], specificity: 10 },
  accessor: '`req.log`, or `useLogger()` from `evlog/express` below the handler',
  requestLogger: 'explicit',
  requestLoggerMember: 'log',
  shape: {
    loggerCall: 'const log = req.log',
    handler(route, body) {
      return [`app.${(route.method ?? 'all').toLowerCase()}('${route.path}', async (req, res) => {`, ...body.map(line => indent(1, line)), '})']
    },
  },
  map: (): Promise<MapAdapter> => import('./map').then(module => module.default),
  init: (): Promise<InitPlanner> => import('./init').then(module => module.default),
})
