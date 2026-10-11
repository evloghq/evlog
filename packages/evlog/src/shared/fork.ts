import type { AsyncLocalStorage } from 'node:async_hooks'
import type { RequestLogger } from '../types'
import type { AuditableLogger } from '../audit'
import { createRequestLogger, getGlobalDrain, outputWideEvent } from '../logger'
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
  parent.fork = (label, fn) => forkBackgroundLogger({ storage, parent, middlewareOptions, label, fn, lifecycle })
}

/**
 * Run background work under a child request logger so `useLogger()` resolves to the
 * child while `fn` runs. The child emits a separate wide event when `fn` settles,
 * with `operation` and `_parentRequestId` set for correlation.
 *
 * Returns the child's lifetime: it resolves once `fn` has settled and the child
 * event has been enriched and drained, and never rejects. When `waitUntil` is set,
 * that lifetime is registered with it synchronously, while the caller is still in
 * the request scope.
 *
 * @beta Part of `evlog/toolkit` — used by framework integrations; prefer `log.fork()`
 * on the request logger when available.
 */
export function forkBackgroundLogger(options: ForkBackgroundLoggerOptions): Promise<void> {
  const { storage, parent, label, fn, lifecycle } = options
  const { waitUntil, ...middlewareOptions } = options.middlewareOptions

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

  const lifetime = storage.run(child, () => {
    lifecycle?.onChildEnter?.(child)
    return Promise.resolve()
      .then(() => fn())
      .then(
        () => {
          const ctxStatus = child.getContext().status
          return typeof ctxStatus === 'number' ? ctxStatus : undefined
        },
        (err: unknown) => {
          const error = err instanceof Error ? err : new Error(String(err))
          const status = extractErrorStatus(error)
          child.error(error)
          child.set({ status })
          return status
        },
      )
      .then(async (status) => {
        const emittedEvent = child.emit()
        if (!emittedEvent) return
        if (middlewareOptions.enrich || middlewareOptions.drain || getGlobalDrain()) {
          await runEnrichAndDrain(emittedEvent, middlewareOptions, childRequestInfo, (emittedEvent.status as number | undefined) ?? status)
        } else {
          outputWideEvent(emittedEvent)
        }
      })
      .catch((err: unknown) => {
        console.error('[evlog] log.fork() failed to emit the child event:', err)
      })
      .finally(() => {
        lifecycle?.onChildExit?.(child)
      })
  })

  if (waitUntil) {
    // Covers a pipeline's batch delivery without making an awaited fork wait for it.
    const { settled } = (middlewareOptions.drain ?? getGlobalDrain() ?? {}) as { settled?: () => Promise<void> }
    waitUntil(typeof settled === 'function' ? lifetime.then(() => settled()) : lifetime)
  }

  return lifetime
}
