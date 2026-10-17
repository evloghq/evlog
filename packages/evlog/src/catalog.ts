import type { AuditActionDefinition, AuditTarget } from './types'
import { defineAuditAction, type AuditInput } from './audit-action'
import { EvlogError } from './error'

/**
 * Static metadata for a single entry in an error catalog.
 *
 * `message` is either a constant string or a function that receives required
 * params at the call site (typed). All other fields are templated defaults
 * that can be overridden at the call site.
 */
export interface ErrorCatalogEntry {
  /** HTTP status code. Leave unset for an error that is not an HTTP response. */
  status?: number
  /**
   * Either a constant string or a typed function whose params become required
   * arguments at the call site (`factory({ available, required })`).
   */
  message: string | ((params: never) => string)
  /** Why this error occurred (technical reason). */
  why?: string
  /** Actionable fix shown to the user. */
  fix?: string
  /** Link to documentation. */
  link?: string
  /** Free-form metadata for grouping / filtering (not surfaced on the wire). */
  tags?: readonly string[]
  /**
   * Backend-only context defaults. Merged with call-site `internal` (call-site wins).
   */
  internal?: Record<string, unknown>
}

/**
 * Subset of {@link import('./types').ErrorOptions} that callers may override
 * when invoking a catalog factory. `code` is always derived from the catalog
 * and intentionally excluded — pass `cause` here for error chaining.
 */
export interface ErrorFactoryOverrides {
  message?: string
  status?: number
  why?: string
  fix?: string
  link?: string
  internal?: Record<string, unknown>
  cause?: Error
}

/** @internal Extract the params object type from a templated message function. */
type MessageParams<TMessage> = TMessage extends (params: infer P) => string ? P : Record<string, never>

/**
 * Call-site argument type for a catalog factory:
 * - if `message` is a function: required params object merged with overrides
 * - if `message` is a string: optional overrides only
 */
export type ErrorFactoryOpts<TEntry extends ErrorCatalogEntry> =
  TEntry['message'] extends (params: infer _P) => string
    ? MessageParams<TEntry['message']> & ErrorFactoryOverrides
    : ErrorFactoryOverrides

/** @internal When message is a string, the call-site argument is optional. */
type FactoryArgs<TEntry extends ErrorCatalogEntry> =
  TEntry['message'] extends (params: never) => string
    ? [opts: ErrorFactoryOpts<TEntry>]
    : [opts?: ErrorFactoryOpts<TEntry>]

/**
 * A factory produced by {@link defineError} or each entry of
 * {@link defineErrorCatalog}. Calling it returns a fully-formed
 * {@link EvlogError} with the catalog's defaults applied. Static metadata
 * is exposed as readonly properties for introspection / refactor-safe
 * comparisons (`err.code === MyError.code`).
 */
export type DefinedError<TCode extends string, TEntry extends ErrorCatalogEntry> =
  & ((...args: FactoryArgs<TEntry>) => EvlogError)
  & {
    readonly code: TCode
    readonly status: number | undefined
    readonly message: TEntry['message']
    readonly why: TEntry['why']
    readonly fix: TEntry['fix']
    readonly link: TEntry['link']
    readonly tags: TEntry['tags']
    readonly internal: TEntry['internal']
  }

function buildEvlogError(
  code: string,
  entry: ErrorCatalogEntry,
  rawArgs: Record<string, unknown> | undefined,
): EvlogError {
  const args = rawArgs ?? {}
  const {
    message: messageOverride,
    status,
    why,
    fix,
    link,
    cause,
    internal: callInternal,
    ...maybeParams
  } = args as ErrorFactoryOverrides & Record<string, unknown>

  let message: string
  if (typeof messageOverride === 'string') {
    message = messageOverride
  } else if (typeof entry.message === 'function') {
    message = (entry.message as (p: unknown) => string)(maybeParams)
  } else {
    ({ message } = entry as { message: string })
  }

  let internal: Record<string, unknown> | undefined
  if (entry.internal || callInternal) {
    internal = { ...(entry.internal ?? {}), ...(callInternal ?? {}) }
  }

  return new EvlogError({
    code,
    message,
    status: status ?? entry.status,
    why: why ?? entry.why,
    fix: fix ?? entry.fix,
    link: link ?? entry.link,
    cause: cause as Error | undefined,
    internal,
  })
}

/**
 * Define a single, standalone error factory bound to a stable `code`.
 *
 * Each factory produces an {@link EvlogError} with the entry's defaults
 * applied. Call-site overrides (`cause`, `internal`, `message`, ...) are
 * shallow-merged onto those defaults.
 *
 * @example
 * ```ts
 * import { defineError } from 'evlog'
 *
 * export const PaymentDeclined = defineError('billing.PAYMENT_DECLINED', {
 *   status: 402,
 *   message: 'Card declined',
 *   why: 'Issuer declined the charge',
 *   fix: 'Try another card',
 * })
 *
 * throw PaymentDeclined()
 * throw PaymentDeclined({ cause: stripeErr, internal: { ref: 'ch_x' } })
 * ```
 *
 * @example Templated message with typed params
 * ```ts
 * export const InsufficientFunds = defineError('billing.INSUFFICIENT_FUNDS', {
 *   status: 402,
 *   message: ({ available, required }: { available: number, required: number }) =>
 *     `Insufficient funds: $${available}/$${required}`,
 * })
 *
 * throw InsufficientFunds({ available: 5, required: 100 })
 * ```
 */
export function defineError<
  const TCode extends string,
  const TEntry extends ErrorCatalogEntry,
>(code: TCode, entry: TEntry): DefinedError<TCode, TEntry> {
  const factory = ((...args: unknown[]) =>
    buildEvlogError(code, entry, args[0] as Record<string, unknown> | undefined)) as unknown as DefinedError<TCode, TEntry>

  Object.defineProperties(factory, {
    code: { value: code, enumerable: true },
    status: { value: entry.status, enumerable: true },
    message: { value: entry.message, enumerable: true },
    why: { value: entry.why, enumerable: true },
    fix: { value: entry.fix, enumerable: true },
    link: { value: entry.link, enumerable: true },
    tags: { value: entry.tags, enumerable: true },
    internal: { value: entry.internal, enumerable: true },
  })

  return factory
}

/** Map of error catalog entries keyed by their (UPPER_SNAKE) name. */
export interface ErrorCatalogMap {
  readonly [key: string]: ErrorCatalogEntry
}

/**
 * The object returned by {@link defineErrorCatalog}. Each map key becomes a
 * dot-accessed factory whose `code` is `${prefix}.${key}` (preserved casing).
 *
 * Catalog metadata (`_prefix`, `_codes`) is exposed as non-enumerable readonly
 * properties so it does not pollute iteration but is available for typing
 * (`declare module 'evlog'`) and runtime introspection.
 */
export type ErrorCatalog<TPrefix extends string, TMap extends ErrorCatalogMap> =
  & { [K in keyof TMap & string]: DefinedError<`${TPrefix}.${K}`, TMap[K]> }
  & {
    readonly _prefix: TPrefix
    readonly _codes: ReadonlyArray<`${TPrefix}.${keyof TMap & string}`>
  }

/**
 * Define a bundle of errors that share a common prefix. The wire `code` for
 * each entry is `${prefix}.${KEY}` (the key's casing is preserved — convention
 * is `UPPER_SNAKE_CASE`).
 *
 * Pair with `declare module 'evlog'` to surface autocomplete + literal-typed
 * `code` everywhere across the codebase.
 *
 * @example
 * ```ts
 * import { defineErrorCatalog } from 'evlog'
 *
 * export const billingErrors = defineErrorCatalog('billing', {
 *   PAYMENT_DECLINED: { status: 402, message: 'Card declined' },
 *   INSUFFICIENT_FUNDS: {
 *     status: 402,
 *     message: ({ available, required }: { available: number, required: number }) =>
 *       `Insufficient funds: $${available}/$${required}`,
 *   },
 * })
 *
 * declare module 'evlog' {
 *   interface RegisteredErrorCatalogs {
 *     billing: typeof billingErrors
 *   }
 * }
 *
 * throw billingErrors.PAYMENT_DECLINED()
 * throw billingErrors.INSUFFICIENT_FUNDS({ available: 5, required: 100 })
 * ```
 */
export function defineErrorCatalog<
  const TPrefix extends string,
  const TMap extends ErrorCatalogMap,
>(prefix: TPrefix, map: TMap): ErrorCatalog<TPrefix, TMap> {
  const out: Record<string, unknown> = {}
  const codes: string[] = []

  for (const key of Object.keys(map)) {
    const code = `${prefix}.${key}`
    out[key] = defineError(code, map[key])
    codes.push(code)
  }

  Object.defineProperties(out, {
    _prefix: { value: prefix, enumerable: false },
    _codes: { value: Object.freeze(codes), enumerable: false },
  })

  return out as ErrorCatalog<TPrefix, TMap>
}

/** Static metadata for a single entry in an audit catalog. */
export type AuditCatalogEntry = AuditActionDefinition

/** Map of audit catalog entries keyed by their (UPPER_SNAKE) name. */
export interface AuditCatalogMap {
  readonly [key: string]: AuditCatalogEntry
}

/** A factory produced by an audit catalog entry. Returns an {@link AuditInput}. */
export type DefinedCatalogAudit<TAction extends string, TEntry extends AuditCatalogEntry> =
  & ((
    input: TEntry['target'] extends string
      ? Omit<AuditInput, 'action' | 'target'> & { target?: Omit<AuditTarget, 'type'> & { type?: TEntry['target'] } }
      : Omit<AuditInput, 'action'>,
  ) => AuditInput)
  & {
    readonly action: TAction
    readonly target: TEntry['target']
    readonly description: TEntry['description']
    readonly severity: TEntry['severity']
    readonly requiresChanges: TEntry['requiresChanges']
    readonly requiresReason: TEntry['requiresReason']
    readonly redactPaths: TEntry['redactPaths']
  }

/**
 * The object returned by {@link defineAuditCatalog}. Mirrors
 * {@link ErrorCatalog} but each factory produces an {@link AuditInput}
 * (typically passed to `log.audit(...)`).
 */
export type AuditCatalog<TPrefix extends string, TMap extends AuditCatalogMap> =
  & { [K in keyof TMap & string]: DefinedCatalogAudit<`${TPrefix}.${K}`, TMap[K]> }
  & {
    readonly _prefix: TPrefix
    readonly _actions: ReadonlyArray<`${TPrefix}.${keyof TMap & string}`>
  }

/**
 * Define a bundle of audit actions that share a common prefix. The wire
 * `action` for each entry is `${prefix}.${KEY}`.
 *
 * Each entry produces a thin wrapper around {@link defineAuditAction} (target
 * type is fixed at definition time, action name is auto-prefixed).
 *
 * @example
 * ```ts
 * import { defineAuditCatalog } from 'evlog'
 *
 * export const billingAudit = defineAuditCatalog('billing', {
 *   INVOICE_REFUND: {
 *     target: 'invoice',
 *     severity: 'high',
 *     requiresChanges: true,
 *     description: 'Refund an invoice to the customer',
 *   },
 *   INVOICE_CREATE: { target: 'invoice' },
 * })
 *
 * declare module 'evlog' {
 *   interface RegisteredAuditCatalogs {
 *     billing: typeof billingAudit
 *   }
 * }
 *
 * log.audit(billingAudit.INVOICE_REFUND({
 *   actor: { type: 'user', id: u.id },
 *   target: { id: 'inv_889' },
 * }))
 * ```
 */
export function defineAuditCatalog<
  const TPrefix extends string,
  const TMap extends AuditCatalogMap,
>(prefix: TPrefix, map: TMap): AuditCatalog<TPrefix, TMap> {
  const out: Record<string, unknown> = {}
  const actions: string[] = []

  for (const key of Object.keys(map)) {
    const action = `${prefix}.${key}`
    const entry = map[key]
    out[key] = defineAuditAction(action, entry)
    actions.push(action)
  }

  Object.defineProperties(out, {
    _prefix: { value: prefix, enumerable: false },
    _actions: { value: Object.freeze(actions), enumerable: false },
  })

  return out as AuditCatalog<TPrefix, TMap>
}
