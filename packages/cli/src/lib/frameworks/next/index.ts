import { indent } from '../../map/utils'
import { defineFramework } from '../types'
import type { InitPlanner, MapAdapter } from '../types'

export const next = defineFramework({
  id: 'next',
  label: 'Next.js',
  docs: '/integrate/frameworks/nextjs',
  detect: { deps: ['next'], configs: ['next.config.{ts,js,mjs}'], specificity: 10 },
  accessor: '`useLogger()` from your `lib/evlog.ts` inside a route handler',
  requestLogger: 'explicit',
  shape: {
    loggerCall: 'const log = useLogger()',
    handler(route, body) {
      return [`export async function ${route.method ?? 'POST'}(request: Request) {`, ...body.map(line => indent(1, line)), '}']
    },
  },
  map: (): Promise<MapAdapter> => import('./map').then(module => module.nextAdapter),
  init: (): Promise<InitPlanner> => import('./init').then(module => module.default),
})
