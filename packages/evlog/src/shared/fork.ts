import type { AsyncLocalStorage } from 'node:async_hooks'
import type { RequestLogger } from '../types'
import type { AuditableLogger } from '../audit'
import { createRequestLogger, getGlobalDrain } from '../logger'
import { extractErrorStatus } from './errors'
import type { MiddlewareLoggerOptions } from './middleware'
import { runEnrichAndDrain } from './middleware'

/**
 * Optional hooks for integrations that track active loggers (e.g. Elysia `activeLoggers`).
 */
export interface ForkLifecycle {
  /** Called after the child logger is installed in storage, before `fn` runs. */
  onChildEnter?: (child: AuditableLogger) => void
  /** Called after the child has finished (emit + enrich/drain), success or failure. */
  onChildExit?: (child: AuditableLogger) => void
}

/**
 * Options for {@link forkBackgroundLogger}.
 *
 * @beta Part of `evlog/toolkit`
 */
export interface ForkBackgroundLoggerOptions {
  storage: AsyncLocalStorage<RequestLogger>
  parent: RequestLogger
  middlewareOptions: MiddlewareLoggerOptions
  label: string
  fn: () => void | Promise<void>
  lifecycle?: ForkLifecycle
}

/**
 * Attach {@link RequestLogger.fork} to a request logger. Replaces any existing `fork`.
 */
export function attachForkToLogger(
  storage: AsyncLocalStorage<RequestLogger>,
  parent: RequestLogger,
  middlewareOptions: MiddlewareLoggerOptions,
  lifecycle?: ForkLifecycle,
): void {
  const log = parent as RequestLogger & { fork?: (label: string, fn: () => void | Promise<void>) => void }
  log.fork = (label: string, fn: () => void | Promise<void>) => {
    forkBackgroundLogger({ storage, parent, middlewareOptions, label, fn, lifecycle })
  }
}

/**
 * Run background work under a child request logger so `useLogger()` resolves to the
 * child while `fn` runs. The child emits a separate wide event when `fn` settles,
 * with `operation` and `_parentRequestId` set for correlation.
 *
 * @beta Part of `evlog/toolkit` — used by framework integrations; prefer `log.fork()`
 * on the request logger when available.
 */
export function forkBackgroundLogger(options: ForkBackgroundLoggerOptions): void {
  const { storage, parent, middlewareOptions, label, fn, lifecycle } = options

  const parentCtx = parent.getContext() as Record<string, unknown>
  const parentRequestId = parentCtx.requestId
  if (typeof parentRequestId !== 'string' || parentRequestId.length === 0) {
    throw new Error(
      '[evlog] log.fork() requires the parent logger to have a requestId. '
      + 'Ensure the request was created by evlog middleware.',
    )
  }

  const method = String(parentCtx.method ?? middlewareOptions.method)
  const path = String(parentCtx.path ?? middlewareOptions.path)

  const child = createRequestLogger(
    {
      method,
      path,
      requestId: crypto.randomUUID(),
    },
    { _deferDrain: true },
  )

  child.set({
    operation: label,
    _parentRequestId: parentRequestId,
  })

  const childRequestInfo = {
    method,
    path,
    requestId: child.getContext().requestId as string,
  }

  storage.run(child, () => {
    lifecycle?.onChildEnter?.(child)
    void Promise.resolve()
      .then(() => fn())
      .then(async () => {
        const emittedEvent = child.emit()
        const ctxStatus = child.getContext().status
        const status = (emittedEvent?.status
          ?? (typeof ctxStatus === 'number' ? ctxStatus : undefined)) as number | undefined
        if (
          emittedEvent
          && (middlewareOptions.enrich || middlewareOptions.drain || getGlobalDrain())
        ) {
          await runEnrichAndDrain(emittedEvent, middlewareOptions, childRequestInfo, status)
        }
      })
      .catch(async (err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err))
        child.error(error)
        child.set({ status: extractErrorStatus(error) })
        const emittedEvent = child.emit()
        const status = extractErrorStatus(error)
        if (
          emittedEvent
          && (middlewareOptions.enrich || middlewareOptions.drain || getGlobalDrain())
        ) {
          await runEnrichAndDrain(emittedEvent, middlewareOptions, childRequestInfo, status)
        }
      })
      .finally(() => {
        lifecycle?.onChildExit?.(child)
      })
  })
}
