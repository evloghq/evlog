import type { RawRouteEntry } from '../../map/types'
import { indent } from '../../map/utils'
import { defineFramework } from '../types'
import type { InitPlanner, MapAdapter } from '../types'

/**
 * What evlog's Nuxt module auto-imports (`addImports` / `addServerImports`).
 *
 * An un-imported `useLogger()` or `log` is evlog's here, as long as the file
 * does not declare one itself.
 */
export const NUXT_EVLOG_AUTO_IMPORTS = ['useLogger', 'log', 'createEvlogError'] as const

/** The h3 handler Nuxt and Nitro share. */
export function eventHandlerShape(_route: RawRouteEntry, body: readonly string[]): string[] {
  return ['export default defineEventHandler(async (event) => {', ...body.map(line => indent(1, line)), '})']
}

export const nuxt = defineFramework({
  id: 'nuxt',
  label: 'Nuxt',
  docs: '/integrate/frameworks/nuxt',
  detect: { deps: ['nuxt'], configs: ['nuxt.config.{ts,js,mjs}'], specificity: 10 },
  accessor: '`useLogger(event)` (auto-imported) inside a `server/api` handler',
  requestLogger: 'ambient',
  evlogAutoImports: NUXT_EVLOG_AUTO_IMPORTS,
  shape: { loggerCall: 'const log = useLogger(event)', handler: eventHandlerShape },
  map: (): Promise<MapAdapter> => import('./map').then(module => module.nuxtAdapter),
  init: (): Promise<InitPlanner> => import('./init').then(module => module.default),
})
