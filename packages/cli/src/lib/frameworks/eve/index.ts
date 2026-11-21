import { indent } from '../../map/utils'
import { defineFramework } from '../types'
import type { InitPlanner, MapAdapter } from '../types'

export const eve = defineFramework({
  id: 'eve',
  label: 'eve',
  docs: '/use-cases/eve',
  /* An agent is `agent/`, or `agents/<name>/agent/` in a workspace: an app
     that only calls an agent elsewhere (`eveRoot`) lists `eve` too. Above the
     web frameworks an agent often ships inside, which init wires beside it.
     `@evlog/eve` needs eve 1.0. */
  detect: { deps: ['eve'], requires: ['agent', 'agents'], minMajor: 1, specificity: 20 },
  packages: ['@evlog/eve'],
  accessor: '`useLogger()` from `@evlog/eve/logger` inside a tool\'s `execute()`',
  requestLogger: 'explicit',
  shape: {
    loggerCall: 'const log = useLogger()',
    handler(_route, body) {
      return ['export default defineTool({', '  async execute(input) {', ...body.map(line => indent(2, line)), '  },', '})']
    },
  },
  map: (): Promise<MapAdapter> => import('./map').then(module => module.default),
  init: (): Promise<InitPlanner> => import('./init').then(module => module.default),
})
