import type { AuditActionDefinition, AuditActor, AuditFields, AuditTarget } from './types'

/**
 * Input accepted by `log.audit()`, `audit()`, and `withAudit()`.
 *
 * `outcome` defaults to `'success'`. `id`, `timestamp`, `version` and `context` are filled
 * when the record is made; `signature`, `prevHash` and `hash` by `signed()`.
 */
export interface AuditInput {
  action: string
  actor: AuditActor
  target?: AuditTarget
  tenantId?: string
  outcome?: AuditFields['outcome']
  reason?: string
  changes?: AuditFields['changes']
  metadata?: Record<string, unknown>
  causationId?: string
  correlationId?: string
}

/** Options for {@link defineAuditAction}. Same shape as {@link AuditActionDefinition}. */
export type DefineAuditActionOptions = AuditActionDefinition

/**
 * Define a typed audit action with optional fixed target type and catalog metadata.
 *
 * Returns a curried helper that fills in the action name (and target shape
 * if provided) so call sites stay terse and the action set is discoverable
 * in one place. Metadata (`description`, `severity`, `requiresChanges`, …)
 * is exposed on the factory for introspection, docs, and review tooling.
 *
 * @example
 * ```ts
 * const refund = defineAuditAction('invoice.refund', {
 *   target: 'invoice',
 *   severity: 'high',
 *   requiresChanges: true,
 *   redactPaths: ['cardNumber'],
 * })
 *
 * log.audit(refund({
 *   actor: { type: 'user', id: user.id },
 *   target: { id: 'inv_889' }, // type inferred as 'invoice'
 *   outcome: 'success',
 * }))
 * ```
 */
export function defineAuditAction<
  const TAction extends string,
  const TOptions extends DefineAuditActionOptions = DefineAuditActionOptions,
>(action: TAction, options?: TOptions): DefinedAuditAction<TAction, TOptions> {
  const targetType = options?.target
  const factory = ((input) => {
    const merged: AuditInput = {
      ...(input as AuditInput),
      action,
    }
    if (targetType && input.target && !input.target.type) {
      merged.target = { ...input.target, type: targetType } as AuditTarget
    }
    return merged
  }) as DefinedAuditAction<TAction, TOptions>

  Object.defineProperties(factory, {
    action: { value: action, enumerable: true },
    target: { value: options?.target, enumerable: true },
    description: { value: options?.description, enumerable: true },
    severity: { value: options?.severity, enumerable: true },
    requiresChanges: { value: options?.requiresChanges, enumerable: true },
    requiresReason: { value: options?.requiresReason, enumerable: true },
    redactPaths: { value: options?.redactPaths, enumerable: true },
  })

  return factory
}

/**
 * Return type of {@link defineAuditAction}. Accepts a partial input (no
 * `action`, target type pre-filled when provided).
 */
export type DefinedAuditAction<
  TAction extends string = string,
  TOptions extends DefineAuditActionOptions = DefineAuditActionOptions,
> =
  & ((
    input: TOptions['target'] extends string
      ? Omit<AuditInput, 'action' | 'target'> & { target?: Omit<AuditTarget, 'type'> & { type?: TOptions['target'] } }
      : Omit<AuditInput, 'action'>,
  ) => AuditInput)
  & {
    readonly action: TAction
    readonly target: TOptions['target']
    readonly description: TOptions['description']
    readonly severity: TOptions['severity']
    readonly requiresChanges: TOptions['requiresChanges']
    readonly requiresReason: TOptions['requiresReason']
    readonly redactPaths: TOptions['redactPaths']
  }
