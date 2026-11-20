import type { Signal, SignalInput } from './define'
import { defineSignal } from './define'

/** What `knownError` reads from a `defineError` factory: its code and the text that describes it. */
export interface KnownErrorEntry {
  readonly code: string
  readonly message: unknown
  readonly why?: unknown
}

/** A `defineError` factory, or a whole `defineErrorCatalog`. */
export type KnownErrors = KnownErrorEntry | { readonly _codes: ReadonlyArray<string> }

const NEW = 'new'

function entriesOf(errors: KnownErrors): KnownErrorEntry[] {
  if (typeof errors === 'function' || !('_codes' in errors)) return [errors as KnownErrorEntry]
  return Object.values(errors as Record<string, unknown>).filter((value): value is KnownErrorEntry => typeof value === 'function' && typeof (value as { code?: unknown }).code === 'string')
}

function describe(entry: KnownErrorEntry): string {
  const parts = [entry.message, entry.why].filter((part): part is string => typeof part === 'string' && part.length > 0)
  return parts.length > 0 ? parts.join('. ') : entry.code
}

/**
 * Match errors the app did not throw through its catalog (a raw Stripe error,
 * a library exception) to the catalog entry that describes the same failure,
 * or to `new` when none does. Each entry's `message` and `why` are the
 * description the model matches against. Errors already carrying a catalog
 * `code` are skipped, and errors sharing a name and message share one verdict.
 *
 * `new` is the column to alert on: a failure the catalog does not describe.
 *
 * @example
 * ```ts
 * import { billingErrors, authErrors } from './errors'
 *
 * createSignals({ signals: [knownError([billingErrors, authErrors])] })
 * // event.signals['known-error'] → { value: 'billing.PAYMENT_DECLINED', confidence: 1 }
 * ```
 */
export function knownError(errors: ReadonlyArray<KnownErrors>): Signal {
  const choice: Record<string, string> = {}
  for (const entry of errors.flatMap(entriesOf)) {
    if (entry.code === NEW) throw new Error(`[evlog/signals] knownError: the code "${NEW}" is reserved for errors the catalog does not describe`)
    choice[entry.code] = describe(entry)
  }
  const codes = new Set(Object.keys(choice))
  if (codes.size === 0) throw new Error('[evlog/signals] knownError needs at least one catalog entry')
  choice[NEW] = 'None of the above: a failure none of these entries describes'

  const errorOf = (e: SignalInput): { name?: unknown, message?: unknown, code?: unknown } | undefined =>
    typeof e.error === 'object' && e.error !== null ? e.error as { name?: unknown, message?: unknown, code?: unknown } : undefined

  return defineSignal({
    name: 'known-error',
    when: (e) => {
      const error = errorOf(e)
      return error !== undefined && !(typeof error.code === 'string' && codes.has(error.code))
    },
    ask: 'Which entry of our error catalog describes this failure, or is it a new one?',
    choice,
    cacheKey: (e) => {
      const error = errorOf(e)!
      return JSON.stringify([String(error.name ?? 'Error'), String(error.message ?? '')])
    },
  })
}
