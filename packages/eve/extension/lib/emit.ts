import type { HookContext } from 'eve/hooks'
import { createError, initLogger, toLoggerConfig, toMiddlewareOptions } from 'evlog'
import { createMiddlewareLogger, isLoggerInitialized, isLoggerLocked, resolveRedactConfig } from 'evlog/toolkit'
import extension from '../extension'
import type { RecordedError, TurnSlot } from './state'
import { takeTurnTrace } from './traces'
import { turnFields } from './turn'

let initialized = false
let replaying = false

/** True while the hook rebuilds recorded errors, which must not be recorded again. */
export function isReplaying(): boolean {
  return replaying
}

function rebuild(recorded: RecordedError): Error {
  const { stack, ...options } = recorded
  replaying = true
  try {
    const error = createError(options)
    error.stack = stack
    return error
  } finally {
    replaying = false
  }
}

/** A failure eve kept only the name and message of; the stack would be this hook's, so it has none. */
function kept(failure: { name?: string, message: string }): Error {
  const error = new Error(failure.message)
  if (failure.name) error.name = failure.name
  error.stack = undefined
  return error
}

function settings() {
  const { record, tools, init, logs: _logs, ...config } = extension.config
  // Records are read back by the agent and pasted into issues, so they are
  // redacted in every environment unless the mount says otherwise.
  return {
    init,
    record: record ?? 'standard',
    tools: tools ?? {},
    config: { service: 'eve-agent', ...config, redact: config.redact ?? true },
  }
}

/**
 * Who asked and which session delegated the turn. Only the identifiers eve
 * routes on: a channel may put a name or an email in a principal's subject.
 */
function lineage(ctx: HookContext): Record<string, unknown> {
  const caller = ctx.session.auth?.current
  const { parent } = ctx.session
  return {
    ...(caller && {
      caller: { principalId: caller.principalId, principalType: caller.principalType, authenticator: caller.authenticator },
    }),
    ...(parent && {
      parent: {
        sessionId: parent.sessionId,
        rootSessionId: parent.rootSessionId,
        callId: parent.callId,
        ...(parent.turn?.id && { turnId: parent.turn.id }),
      },
    }),
  }
}

/**
 * Emits the turn's event and resolves once every drain has accepted it, so a
 * serverless step can't end before the event leaves. The event id is
 * `sessionId:turnId`: a retried step or a resumed turn emits the same id.
 */
export async function emitTurn(turnId: string, slot: Pick<TurnSlot, 'calls' | 'created'>, ctx: HookContext): Promise<void> {
  const { init, record, tools, config } = settings()
  if (!initialized) {
    initialized = true
    if (!isLoggerLocked() && !isLoggerInitialized()) initLogger(init ?? toLoggerConfig(config))
  }

  const id = `${ctx.session.id}:${turnId}`
  const { logger, finish, skipped } = createMiddlewareLogger({
    ...toMiddlewareOptions(config),
    method: 'EVE',
    path: `/agents/${ctx.agent.name}/turns`,
    requestId: id,
  })
  if (skipped) return
  // initLogger is skipped when a host app such as Next initialised evlog first,
  // so the mount's service reaches its turns here.
  if (extension.config.service && logger.getContext().service === undefined) logger.set({ service: extension.config.service })

  const turn = turnFields({
    view: ctx.view,
    sessionId: ctx.session.id,
    turnId,
    agent: ctx.agent.name,
    channel: ctx.channel.kind,
    record,
    tools,
    redact: resolveRedactConfig(config.redact),
    created: slot.created,
  })
  logger.set({ idempotencyKey: id, ...turn.fields, ...takeTurnTrace(ctx.session.id, turnId) })
  if (record !== 'minimal') logger.set({ eve: lineage(ctx) })

  let errors = 0
  const reported = new Set<string>()
  for (const call of slot.calls) {
    if (call.op === 'set') logger.set(call.fields)
    else if (call.op === 'audit') logger.audit(call.input)
    else if (call.op === 'error') {
      errors += 1
      reported.add(call.error.message)
      logger.error(rebuild(call.error), call.context)
    } else logger[call.op](call.message, call.context)
  }
  // eve keeps only a failed call's message, so the evlog error built in the
  // tool is found by that message to restore its code, why, fix and link. A
  // call that threw anything else is written from what eve kept, so a
  // recovered failure still carries an error block.
  for (const failure of turn.failures) {
    if (reported.has(failure.message)) continue
    reported.add(failure.message)
    const created = slot.created.findLast(error => error.message === failure.message)
    errors += 1
    logger.error(created ? rebuild(created) : kept(failure))
  }
  // A turn that recovered from a failed call still answered: it is a warning,
  // so `evlog logs errors` lists it without counting it as a failed turn.
  const failedCalls = (turn.fields.eve as { failedCalls?: number }).failedCalls ?? 0
  if (turn.status === 200 && errors + failedCalls > 0) logger.setLevel('warn')

  await finish({ status: turn.status, ...(turn.durationMs !== undefined && { durationMs: turn.durationMs }) })

  const { flush } = (config.drain ?? {}) as { flush?: () => Promise<void> }
  if (typeof flush === 'function') await flush()
}
