import type { EvlogError } from '../error'

/** Shared by every copy of evlog of this major, like the logger registry. */
const LISTENERS_KEY = Symbol.for('evlog.error-created.v3')

type ListenerHost = typeof globalThis & { [LISTENERS_KEY]?: Set<(error: EvlogError) => void> }

function listeners(): Set<(error: EvlogError) => void> {
  return ((globalThis as ListenerHost)[LISTENERS_KEY] ??= new Set())
}

/**
 * Calls `listener` with every `EvlogError` as it is constructed, including the
 * ones a catalog builds, before anything throws or serializes it. For
 * integrations whose runtime keeps only an error's name and message, such as
 * agent frameworks that record tool failures. Returns an unsubscribe.
 *
 * The listener runs inside the constructor, so it must not throw.
 */
export function onErrorCreated(listener: (error: EvlogError) => void): () => void {
  const set = listeners()
  set.add(listener)
  return () => set.delete(listener)
}

export function notifyErrorCreated(error: EvlogError): void {
  const set = (globalThis as ListenerHost)[LISTENERS_KEY]
  if (set) for (const listener of set) listener(error)
}
