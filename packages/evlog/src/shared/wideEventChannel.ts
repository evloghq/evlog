import type { WideEvent } from '../types'

/** @internal Publisher registered by `evlog/diagnostics`. */
type WideEventPublisher = (event: WideEvent) => void

let publisher: WideEventPublisher | null = null

/**
 * Register the sink that receives every emitted wide event.
 *
 * Kept here so the core never imports `node:diagnostics_channel` — the
 * publisher lives in the `evlog/diagnostics` entry point and registers itself.
 *
 * @internal
 */
export function registerWideEventPublisher(fn: WideEventPublisher | null): void {
  publisher = fn
}

/** @internal */
export function hasWideEventPublisher(): boolean {
  return publisher !== null
}

/**
 * Hand an emitted wide event to the registered publisher, if any.
 *
 * Subscriber failures are contained the same way drain failures are: logged,
 * never propagated to the request.
 *
 * @internal
 */
export function publishWideEvent(event: WideEvent): void {
  if (!publisher) return
  try {
    publisher(event)
  } catch (err) {
    console.error('[evlog] diagnostics channel publish failed:', err)
  }
}
