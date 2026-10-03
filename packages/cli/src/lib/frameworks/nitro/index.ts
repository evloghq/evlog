import { NUXT_EVLOG_AUTO_IMPORTS, eventHandlerShape } from '../nuxt'
import { defineFramework } from '../types'
import type { InitPlanner, MapAdapter } from '../types'

/** A bare Nitro app: the same handlers as Nuxt's `server/`, one directory level up. */
export const nitro = defineFramework({
  id: 'nitro',
  label: 'Nitro',
  docs: '/integrate/frameworks/nitro',
  detect: { deps: ['nitropack', 'nitro'], configs: ['nitro.config.{ts,js,mjs}'], unlessDeps: ['nuxt'], specificity: 8 },
  accessor: '`useLogger(event)` from `evlog/nitro` inside a route handler',
  requestLogger: 'ambient',
  evlogAutoImports: NUXT_EVLOG_AUTO_IMPORTS,
  shape: { loggerCall: 'const log = useLogger(event)', handler: eventHandlerShape },
  map: (): Promise<MapAdapter> => import('../nuxt/map').then(module => module.nitroAdapter),
  init: (): Promise<InitPlanner> => import('./init').then(module => module.default),
})
