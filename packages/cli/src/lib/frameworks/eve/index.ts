import { indent } from '../../map/utils'
import { defineFramework } from '../types'
import type { InitPlanner, MapAdapter } from '../types'

const LOGGER_CALL = 'const log = useLogger()'

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
  evlogModules: { '@evlog/eve/logger': ['useLogger'] },
  recordedBy: '@evlog/eve in the agent\'s extensions/',
  shape: {
    loggerCall: LOGGER_CALL,
    handler(route, body) {
      /* A schedule or channel runs no code inside its turns, so the only fix
         there is the mount that records them. */
      if (route.kind !== 'tool') {
        const agentDir = route.file.slice(0, route.file.lastIndexOf(`/${route.kind}s/`))
        return [`// ${agentDir}/extensions/evlog.ts`, 'export { default } from \'@evlog/eve\'']
      }
      /* The mount passes `wide-event` on its own, so a tool can be asked for
         `log.set()` without ever having been asked for the logger. */
      const lines = body.some(line => line.startsWith('log.')) && !body.includes(LOGGER_CALL) ? [LOGGER_CALL, ...body] : body
      return ['export default defineTool({', indent(1, 'async execute(input) {'), ...lines.map(line => indent(2, line)), indent(1, '},'), '})']
    },
  },
  map: (): Promise<MapAdapter> => import('./map').then(module => module.default),
  init: (): Promise<InitPlanner> => import('./init').then(module => module.default),
})
