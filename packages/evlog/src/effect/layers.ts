import { Cause, Context, Effect, Layer, Logger, Option, References } from 'effect'
import type { LogLevel } from 'effect'
import type { AuditableLogger } from '../audit'
import { initLogger } from '../logger'
import type { LoggerConfig } from '../types'
import { formatMessage } from '../utils'
import { errorFromFailure } from './cause'
import { EvlogLogger } from './unit'

type EntryMethod = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'

const METHODS: Partial<Record<LogLevel.LogLevel, EntryMethod>> = {
  Fatal: 'fatal',
  Error: 'error',
  Warn: 'warn',
  Info: 'info',
  Debug: 'debug',
  Trace: 'trace',
}

function renderMessage(message: unknown): string {
  const values = (Array.isArray(message) ? message : [message]).map(value => value instanceof Error ? value.message : value)
  const [first, ...rest] = values
  if (typeof first === 'string') return formatMessage(first, rest)
  return values.map(value => formatMessage('%s', [value])).join(' ')
}

/** The failure or defect of a log entry's cause, ranked as `Cause.squash` ranks them. */
function causeError(cause: Cause.Cause<unknown>): Error | undefined {
  const reason = cause.reasons.find(Cause.isFailReason) ?? cause.reasons.find(Cause.isDieReason)
  if (reason === undefined) return undefined
  return errorFromFailure(Cause.isFailReason(reason) ? reason.error : reason.defect)
}

function record(logger: AuditableLogger, method: EntryMethod, options: Logger.Options<unknown>): void {
  const message = renderMessage(options.message)
  const annotations = options.fiber.getRef(References.CurrentLogAnnotations)
  const error = method === 'error' || method === 'fatal' ? causeError(options.cause) : undefined
  if (method === 'error') {
    logger.error(error ?? message, annotations)
    return
  }
  logger[method](message, annotations)
  if (error) logger.error(error)
}

/**
 * Route `Effect.log*` entries into the wide event of the current unit of work.
 *
 * Inside a unit ({@link withLogger}, {@link withRequestLogger}, the `evlog()` HTTP
 * middleware), an entry lands on that unit's event with the evlog method of the same
 * severity, and its log annotations merge into the event as fields. An Error or Fatal
 * entry logged with a `Cause` records the cause's error. Outside a unit, entries go to
 * the loggers that were active when the layer was built.
 *
 * @example
 * ```ts
 * const job = Effect.gen(function* () {
 *   yield* Effect.logInfo('loaded %d items', items.length)
 *   yield* Effect.logWarning('retrying').pipe(Effect.annotateLogs({ provider: 'stripe' }))
 * })
 *
 * await Effect.runPromise(job.pipe(withLogger('sync'), Effect.provide(loggerLayer())))
 * ```
 */
export function loggerLayer(): Layer.Layer<never> {
  const routing = Effect.withFiber((fiber) => {
    const previous = fiber.getRef(Logger.CurrentLoggers)
    return Effect.succeed(Logger.make((options) => {
      const logger = Context.getOption(options.fiber.context, EvlogLogger)
      if (Option.isNone(logger)) {
        for (const previousLogger of previous) previousLogger.log(options)
        return
      }
      const method = METHODS[options.logLevel]
      if (method) record(logger.value, method, options)
    }))
  })
  return Logger.layer([routing])
}

/**
 * Initialize evlog with `config` when the layer is built, and flush a batching drain
 * (`createDrainPipeline`) when the layer's scope closes, after the units of work in
 * that scope have emitted.
 *
 * @example
 * ```ts
 * const drain = createDrainPipeline()(createAxiomDrain())
 *
 * await Effect.runPromise(program.pipe(
 *   Effect.provide(Layer.merge(initLoggerLayer({ env: { service: 'worker' }, drain }), loggerLayer())),
 * ))
 * ```
 */
export function initLoggerLayer(config?: LoggerConfig): Layer.Layer<never> {
  return Layer.effectDiscard(Effect.acquireRelease(
    Effect.sync(() => initLogger(config)),
    () => flushDrain(config?.drain),
  ))
}

/** Flush a drain that buffers (`createDrainPipeline`); a failed flush is reported, never raised. */
function flushDrain(drain: LoggerConfig['drain']): Effect.Effect<void> {
  const { flush } = (drain ?? {}) as { flush?: () => Promise<void> }
  if (typeof flush !== 'function') return Effect.void
  return Effect.promise(() => flush().catch((error: unknown) => {
    console.error('[evlog] drain flush failed:', error)
  }))
}
