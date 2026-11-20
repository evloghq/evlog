import { defineDynamic, defineTool } from 'eve/tools'
import type { DynamicContext } from 'eve/tools'
import { isScheduleAuth } from 'eve/schedules'
import { createError } from 'evlog'
import { z } from 'zod'
import { useLogger } from '../lib/logger'
import { VIEWS } from '../lib/vendor/logs-query'
import { DEFAULT_VERCEL_CONNECTOR } from '../lib/vendor/logs-vercel'
import extension from '../extension'
import type { EvlogEveLogsAccess } from '../extension'
import { DEFAULT_LIMIT, readLogs } from '../lib/read-logs'
import type { LogsSource, LogsToolInput, LogsToolResult } from '../lib/read-logs'

const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const

/** The deployment's OIDC token, where `@vercel/oidc` looks for it: the request's header, then the environment. */
function deploymentOidcToken(): string | undefined {
  const context = (globalThis as Record<symbol, { get?: () => { headers?: Record<string, string | undefined> } } | undefined>)[Symbol.for('@vercel/request-context')]
  return context?.get?.().headers?.['x-vercel-oidc-token'] ?? process.env.VERCEL_OIDC_TOKEN
}

/** Which store the tool reads, known before the source is resolved. */
function sourceKind(): 'files' | 'vercel' {
  const chosen = extension.config.logs?.source ?? 'auto'
  return chosen === 'files' || (chosen === 'auto' && process.env.VERCEL !== '1') ? 'files' : 'vercel'
}

export function source(): LogsSource {
  const { dir, vercel } = extension.config.logs ?? {}
  const onVercel = process.env.VERCEL === '1'
  if (sourceKind() === 'files') {
    return { kind: 'fs', dir: dir ?? '.evlog/logs', environment: extension.config.env?.environment ?? process.env.NODE_ENV ?? 'development' }
  }
  const oidcToken = deploymentOidcToken()
  if (!oidcToken) {
    throw createError(onVercel
      ? { message: 'No OIDC token in this deployment', status: 503, why: 'The logs tool reads runtime logs through Vercel Connect, which accepts the deployment\'s OIDC token', fix: 'Turn on OIDC federation for the project in its Vercel settings' }
      : { message: 'No VERCEL_OIDC_TOKEN in this process', status: 503, why: 'logs.source is vercel, and a local run reads the linked project\'s runtime logs with the token vercel env pull writes to .env.local', fix: 'Run eve link, or vercel env pull, then restart eve dev. The token lasts 12 hours' })
  }
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
      'recent (default), errors and slow (worst first) return one short row per turn; sessions sums each session (turns, outcomes, failed tool calls, tokens, cost, slowest turn, latest failure); stats counts per route; trace returns one request\'s full wide events by id, not its OTel span tree.',
      'Rows carry result: completed, recovered (finished after a tool call failed), failed or cancelled. A 200 status does not mean no tool failed. detail: diagnostic adds models, model calls, cost, cache reads and trace ids.',
      'Every result names its origin (files or vercel, and the environment), the window read, the filters and over threshold, and coverage. Say which source and window an answer covers. Never conclude that nothing failed or was slow when coverage.complete is false, and name the threshold when you say nothing was slow.',
      'When the question is about one environment, such as production, pass expect: the read is refused instead of answered from another source.',
      'caller is the session and turn you are in. Narrow with the filters before raising limit, and open a row with trace only when its row does not answer.',
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
      detail: z.enum(['brief', 'diagnostic']).optional().describe('diagnostic adds models, model calls, cost, cache reads and trace ids to each row'),
      limit: z.number().int().min(1).max(50).optional().describe(`Most rows or sessions returned (default ${DEFAULT_LIMIT})`),
      full: z.boolean().optional().describe('Raise the size budget from 24000 to 200000 characters, so a large event, field or summary comes back whole'),
      expect: z.object({
        source: z.enum(['files', 'vercel']).optional(),
        environment: z.string().min(1).optional(),
      }).optional().describe('Refuse the read unless it is this source and environment, such as { environment: "production" }'),
    }),
    async execute(input, toolCtx) {
      const started = Date.now()
      const caller = { session: toolCtx.session.id, turn: toolCtx.session.turn.id }
      let outcome: Awaited<ReturnType<typeof readLogs>> | undefined
      try {
        outcome = await readLogs(input, { source: source(), session: access === 'session' ? caller.session : undefined, caller })
        return outcome
      } finally {
        if (extension.config.logs?.diagnostics) {
          useLogger().set({ evlog: { logs: { [toolCtx.callId]: diagnosticsOf(input, outcome, Date.now() - started) } } })
        }
      }
    },
  })
})

/** What a logs call is recorded as: its shape and counts, never what it returned. */
function diagnosticsOf(input: LogsToolInput, result: LogsToolResult | undefined, durationMs: number): Record<string, unknown> {
  const { fields, ...asked } = input
  return {
    source: sourceKind(),
    view: input.view ?? (input.id ? 'trace' : 'recent'),
    input: { ...asked, ...(fields && { fields: fields.length }) },
    durationMs,
    ...(result
      ? { matched: result.matched, returned: result.returned, complete: result.coverage.complete }
      : { failed: true }),
  }
}
