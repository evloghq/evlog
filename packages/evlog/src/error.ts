import type { ErrorOptions, EvlogErrorData } from './types'
import { colors, isServer } from './utils'
import { evlogErrorBrand, isEvlogError as hasEvlogErrorBrand } from './shared/error-brand'

/** Non-enumerable storage so `JSON.stringify(error)` never exposes internal context */
const evlogErrorInternalKey = Symbol.for('evlog.error.internal')

/** Non-enumerable storage; the payload reaches the wire through the `data` getter */
const evlogErrorDataKey = Symbol.for('evlog.error.data')

/**
 * Structured error with context for better debugging
 *
 * @example
 * ```ts
 * throw new EvlogError({
 *   code: 'GITHUB_RATE_LIMIT',
 *   message: 'Failed to sync repository',
 *   status: 503,
 *   why: 'GitHub API rate limit exceeded',
 *   fix: 'Wait 1 hour or use a different token',
 *   link: 'https://docs.github.com/en/rest/rate-limit',
 *   cause: originalError,
 * })
 * ```
 */
export class EvlogError extends Error {

  /**
   * Whether `error` is an `EvlogError`, including one thrown by a different
   * copy of evlog. Prefer this to `instanceof`: package managers routinely
   * install more than one physical copy (see #462), and `instanceof` then
   * silently reports `false`, downgrading a structured error to a bare 500.
   */
  static isEvlogError(error: unknown): error is EvlogError {
    return hasEvlogErrorBrand(error)
  }

  /** Stable, machine-readable identifier (e.g. `'PAYMENT_DECLINED'`). */
  readonly code?: string
  /** HTTP status code */
  readonly status: number
  readonly why?: string
  readonly fix?: string
  readonly link?: string

  /**
   * Backend-only context from `createError({ internal: … })`.
   * Omitted from {@link EvlogError#toJSON} and all framework HTTP serializers.
   */
  get internal(): Record<string, unknown> | undefined {
    return (this as EvlogError & { [evlogErrorInternalKey]?: Record<string, unknown> })[evlogErrorInternalKey]
  }

  constructor(options: ErrorOptions | string) {
    const opts = typeof options === 'string' ? { message: options } : options

    super(opts.message, { cause: opts.cause })

    this.name = 'EvlogError'
    this.code = opts.code
    this.status = opts.status ?? 500
    this.why = opts.why
    this.fix = opts.fix
    this.link = opts.link

    if (opts.internal !== undefined) {
      Object.defineProperty(this, evlogErrorInternalKey, {
        value: opts.internal,
        enumerable: false,
        writable: false,
        configurable: true,
      })
    }

    if (opts.data !== undefined) {
      Object.defineProperty(this, evlogErrorDataKey, {
        value: opts.data,
        enumerable: false,
        writable: false,
        configurable: true,
      })
    }

    // Maintain proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, EvlogError)
    }
  }

  /**
   * HTTP status text.
   *
   * @deprecated Removed in evlog v3. Use `message` instead.
   */
  get statusText(): string {
    return this.message
  }

  /**
   * HTTP status code.
   *
   * @deprecated Removed in evlog v3. Use `status` instead.
   */
  get statusCode(): number {
    return this.status
  }

  /**
   * HTTP status message.
   *
   * @deprecated Removed in evlog v3. Use `message` instead.
   */
  get statusMessage(): string {
    return this.message
  }

  /**
   * Structured data for serialization: the guidance fields, merged over the
   * payload passed as `createError({ data })`.
   */
  get data(): EvlogErrorData | undefined {
    const extra = (this as EvlogError & { [evlogErrorDataKey]?: Record<string, unknown> })[evlogErrorDataKey]
    if (!extra && !this.code && !this.why && !this.fix && !this.link) return undefined
    return {
      ...extra,
      ...(this.code !== undefined && { code: this.code }),
      ...(this.why !== undefined && { why: this.why }),
      ...(this.fix !== undefined && { fix: this.fix }),
      ...(this.link !== undefined && { link: this.link }),
    }
  }

  override toString(): string {
    const useColors = isServer()

    const red = useColors ? colors.red : ''
    const yellow = useColors ? colors.yellow : ''
    const cyan = useColors ? colors.cyan : ''
    const dim = useColors ? colors.dim : ''
    const reset = useColors ? colors.reset : ''
    const bold = useColors ? colors.bold : ''

    const lines: string[] = []

    lines.push(`${red}${bold}Error:${reset} ${this.message}`)

    if (this.code) {
      lines.push(`${dim}Code:${reset} ${this.code}`)
    }

    if (this.why) {
      lines.push(`${yellow}Why:${reset} ${this.why}`)
    }

    if (this.fix) {
      lines.push(`${cyan}Fix:${reset} ${this.fix}`)
    }

    if (this.link) {
      lines.push(`${dim}More info:${reset} ${this.link}`)
    }

    if (this.cause) {
      lines.push(`${dim}Caused by:${reset} ${(this.cause as Error).message}`)
    }

    return lines.join('\n')
  }

  toJSON(): Record<string, unknown> {
    const { data } = this
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      ...(data && { data }),
      ...(this.cause instanceof Error && {
        cause: { name: this.cause.name, message: this.cause.message },
      }),
    }
  }

}

Object.defineProperty(EvlogError.prototype, evlogErrorBrand, {
  value: true,
  enumerable: false,
})

/**
 * Create a structured error with context for debugging and user-facing messages.
 *
 * @param options - Error message string or full options object
 * @returns EvlogError with HTTP metadata (`status`, `statusText`) and `data`; also includes `statusCode` and `statusMessage` for legacy compatibility
 *
 * @example
 * ```ts
 * // Simple error
 * throw createError('Something went wrong')
 *
 * // Structured error with context
 * throw createError({
 *   code: 'PAYMENT_DECLINED',
 *   message: 'Payment failed',
 *   status: 402,
 *   why: 'Card declined by issuer',
 *   fix: 'Try a different payment method',
 *   link: 'https://docs.example.com/payments',
 * })
 * ```
 */
export function createError(options: ErrorOptions | string): EvlogError {
  return new EvlogError(options)
}

export { createError as createEvlogError }
