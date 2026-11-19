import { defineDynamic, defineTool } from 'eve/tools'
import type { DynamicContext } from 'eve/tools'
import { isScheduleAuth } from 'eve/schedules'
import { createError } from 'evlog'
import { z } from 'zod'
import { VIEWS } from '../lib/vendor/logs-query'
import { DEFAULT_VERCEL_CONNECTOR } from '../lib/vendor/logs-vercel'
import extension from '../extension'
import type { EvlogEveLogsAccess } from '../extension'
import { DEFAULT_LIMIT, readLogs } from '../lib/read-logs'
import type { LogsSource } from '../lib/read-logs'

const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const

/** The deployment's OIDC token, where `@vercel/oidc` looks for it: the request's header, then the environment. */
function deploymentOidcToken(): string | undefined {
  const context = (globalThis as Record<symbol, { get?: () => { headers?: Record<string, string | undefined> } } | undefined>)[Symbol.for('@vercel/request-context')]
  return context?.get?.().headers?.['x-vercel-oidc-token'] ?? process.env.VERCEL_OIDC_TOKEN
}

function source(): LogsSource {
  const { dir, vercel } = extension.config.logs ?? {}
  if (process.env.VERCEL !== '1') return { kind: 'fs', dir: dir ?? '.evlog/logs' }
  const oidcToken = deploymentOidcToken()
  if (!oidcToken) throw createError({ message: 'No OIDC token in this deployment', status: 503, why: 'The logs tool reads runtime logs through Vercel Connect, which accepts the deployment\'s OIDC token', fix: 'Turn on OIDC federation for the project in its Vercel settings' })
  return { kind: 'vercel', oidcToken, connector: vercel?.connector ?? DEFAULT_VERCEL_CONNECTOR }
}

/** The agent's own scheduled work reads every turn, a signed-in caller its own session, an anonymous one nothing. */
function defaultAccess(ctx: DynamicContext): EvlogEveLogsAccess {
  const caller = ctx.session.auth.current
  if (isScheduleAuth(caller)) return 'agent'
  if (!caller || caller.principalType === 'anonymous') return false
  return 'session'
}

export default defineDynamic((ctx) => {
  const access = (extension.config.logs?.access ?? defaultAccess)(ctx)
  if (!access) return null
  return defineTool({
    description: [
      'Read this agent\'s own wide events: one per turn, with its outcome, duration, usage, tool calls and their errors (code, why, fix).',
      'Use it to find out what failed or was slow, and why, before proposing a fix. Quote the requestId of the events you cite.',
      'recent (default), errors and slow (worst first) return one short row per turn; stats counts per route; trace returns one request\'s events in full, by id.',
      'Narrow with the filters before raising limit, and open a row with trace only when its row does not answer.',
      access === 'session' ? 'It reads this session only.' : 'It reads every session.',
    ].join(' '),
    inputSchema: z.object({
      view: z.enum(VIEWS).optional().describe('recent, errors, slow, stats, or trace with id'),
      id: z.string().min(1).optional().describe('For trace: the requestId, or its first block'),
      session: z.string().min(1).optional().describe('Only this session\'s turns, by session id'),
      where: z.array(z.string()).optional().describe('Field clauses, all must hold: user.id=42, durationMs>1000, error.message~declined, audit, !error'),
      since: z.string().optional().describe('Only events newer than this duration back from now: 30m, 6h, 3d. On Vercel, defaults to 1d'),
      until: z.string().optional().describe('Only events older than this duration back from now'),
      level: z.array(z.enum(LEVELS)).optional().describe('Only these levels'),
      path: z.string().min(1).optional().describe('Only events on this exact path'),
      status: z.string().optional().describe('Only this status (500) or class (5xx)'),
      over: z.string().optional().describe('For slow: the duration a turn has to exceed (default 500ms)'),
      fields: z.array(z.string()).max(10).optional().describe('Dotted fields to add to each row, such as user.id or eve.caller.principalId'),
      limit: z.number().int().min(1).max(50).optional().describe(`Most rows returned (default ${DEFAULT_LIMIT})`),
    }),
    execute(input, toolCtx) {
      return readLogs(input, { source: source(), session: access === 'session' ? toolCtx.session.id : undefined })
    },
  })
})
