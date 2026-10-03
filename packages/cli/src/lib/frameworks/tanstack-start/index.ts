import { indent } from '../../map/utils'
import { defineFramework } from '../types'
import type { InitPlanner, MapAdapter } from '../types'

export const tanstackStart = defineFramework({
  id: 'tanstack-start',
  label: 'TanStack Start',
  docs: '/integrate/frameworks/tanstack-start',
  detect: { deps: ['@tanstack/react-start', '@tanstack/start'], specificity: 10 },
  accessor: '`req.context.log` inside a server route',
  requestLogger: 'explicit',
  shape: {
    loggerCall: 'const log = useLogger()',
    handler(route, body) {
      return [
        `export const Route = createFileRoute('${route.path}')({`,
        indent(1, 'server: { handlers: {'),
        indent(2, `${route.method ?? 'POST'}: async () => {`),
        ...body.map(line => indent(3, line)),
        indent(2, '},'),
        indent(1, '} },'),
        '})',
      ]
    },
  },
  map: (): Promise<MapAdapter> => import('./map').then(module => module.tanstackStartAdapter),
  init: (): Promise<InitPlanner> => import('./init').then(module => module.default),
})
