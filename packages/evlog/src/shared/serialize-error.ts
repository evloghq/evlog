import { evlogErrorDataKey, isEvlogError } from './error-brand'

/**
 * Logged after `name`, `message` and `stack`, before `cause`. The status text
 * is `message` itself, so `statusText` and `statusMessage` are not logged.
 */
const ERROR_FIELDS = ['code', 'status', 'data', 'internal', 'why', 'fix', 'link'] as const

function readErrorField(error: Error, key: string): unknown {
  return (error as unknown as Record<string, unknown>)[key]
}

/** A plain write to `__proto__` replaces the prototype instead of storing a field. */
function defineField(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key === '__proto__') Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
  else target[key] = value
}

/**
 * The HTTP status, read from `status` and falling back to h3's `statusCode`.
 * Logs carry `status` only; the fallback covers h3 errors, which still name it `statusCode`.
 */
function statusOf(error: Error): unknown {
  return readErrorField(error, 'status') ?? readErrorField(error, 'statusCode')
}

/**
 * The payload to log. An EvlogError's `data` getter adds `code`, `why`, `fix`
 * and `link` for the HTTP response; logs carry those at the top level, so they
 * read the payload as it was passed.
 */
function dataOf(error: Error): unknown {
  return isEvlogError(error) ? (error as unknown as Record<symbol, unknown>)[evlogErrorDataKey] : readErrorField(error, 'data')
}

/**
 * An error's own `toJSON` output, which decides how the payload fields (`data`,
 * `internal`) are logged: a field it leaves out is not logged and a field it
 * rewrites is logged as rewritten. `EvlogError#toJSON` shapes the HTTP response
 * and omits `internal`, which logs keep, so it does not count.
 */
function payloadShownBy(error: Error): Record<string, unknown> | undefined {
  const { toJSON } = error as { toJSON?: unknown }
  if (typeof toJSON !== 'function' || isEvlogError(error)) return undefined
  const shown: unknown = toJSON.call(error)
  return typeof shown === 'object' && shown !== null ? shown as Record<string, unknown> : {}
}

function payloadOf(error: Error, key: 'data' | 'internal', shown: Record<string, unknown> | undefined): unknown {
  if (shown) return Object.hasOwn(shown, key) ? shown[key] : undefined
  return key === 'data' ? dataOf(error) : readErrorField(error, key)
}

/**
 * h3 wraps a thrown error in an H3Error that keeps the original as `cause` and
 * reads its stack from it, so the pair describe the same failure. Serializing
 * both repeats the message, the stack and the payload.
 */
function isWrapperOf(error: Error, cause: unknown): cause is Error {
  return cause instanceof Error
    && cause !== error
    && cause.message === error.message
    && cause.stack === error.stack
}

const H3_INPUT_FIELDS: Record<string, string> = {
  message: 'message',
  stack: 'stack',
  statusCode: 'statusCode',
  status: 'statusCode',
  statusMessage: 'statusMessage',
  statusText: 'statusMessage',
  data: 'data',
  fatal: 'fatal',
  unhandled: 'unhandled',
}

/**
 * h3's `createError({ statusCode, message })` keeps the options object itself
 * as `cause`. It only restates fields the error already carries, so it counts
 * as a copy when every key is one h3 reads and every value matches the error.
 */
function isH3InputOf(error: Error, cause: unknown): cause is Record<string, unknown> {
  if (typeof cause !== 'object' || cause === null || cause instanceof Error || Array.isArray(cause)) return false
  const keys = Object.keys(cause)
  if (keys.length === 0) return false
  const causeRecord = cause as Record<string, unknown>
  return keys.every((key) => {
    const target = H3_INPUT_FIELDS[key]
    if (!target) return false
    const value = causeRecord[key]
    if (value === undefined || value === readErrorField(error, target)) return true
    return target === 'statusCode' && Number(value) === readErrorField(error, 'statusCode')
  })
}

const SCAN_DEPTH = 16

// Copy-free check run before `walk`, which tracks ancestors and lists keys
// for every object. Past `SCAN_DEPTH` it answers true, so `walk` handles cycles.
function mayHoldError(value: object, depth: number): boolean {
  if (value instanceof Error || depth > SCAN_DEPTH) return true
  if (typeof (value as { toJSON?: unknown }).toJSON === 'function') return false
  if (Array.isArray(value)) {
    return value.some(item => item !== null && typeof item === 'object' && mayHoldError(item, depth + 1))
  }
  // Inherited enumerable keys only come from a custom prototype; `walk` reads own keys only.
  const custom = Object.getPrototypeOf(value) !== Object.prototype
  for (const key in value) {
    if (custom && !Object.hasOwn(value, key)) continue
    const item = (value as Record<string, unknown>)[key]
    if (item !== null && typeof item === 'object' && mayHoldError(item, depth + 1)) return true
  }
  return false
}

/** Serializes errors into the shape evlog logs, on the server and in the browser. */
export interface ErrorSerializer {
  /** `name`, `message` and `stack` live on the prototype, so a spread or `JSON.stringify` of an Error yields `{}`. */
  serializeError: (error: Error) => Record<string, unknown>
  /**
   * Serializes every Error inside `value` and replaces cycles with `'[Circular]'`.
   * Returns `value` itself when it holds neither. An object with its own `toJSON`
   * keeps it: a copy would drop what that method leaves out.
   */
  serializeErrorsIn: (value: unknown) => unknown
}

/**
 * Builds the error serializer a logger uses. Both loggers share one, so an
 * error is logged the same way on the server and in the browser.
 *
 * @param formatStack - Applied to every serialized stack. The server shortens
 * stacks in development; the browser keeps them as they are.
 */
export function createErrorSerializer(formatStack: (stack: string | undefined) => string | undefined = stack => stack): ErrorSerializer {
  /**
   * `ancestors` holds the errors and objects on the current path, so a value
   * reached twice through different branches is kept and only a cycle is cut.
   * The path is a few levels deep, so a scan of an array beats a WeakSet.
   */
  function serialize(error: Error, ancestors: object[]): Record<string, unknown> {
    const { cause } = error
    ancestors.push(error)

    if (isWrapperOf(error, cause) && !ancestors.includes(cause)) {
      // The cause already carries the message, which the wrapper repeats.
      const serialized = serialize(cause, ancestors)
      const status = statusOf(error)
      if (status !== undefined) serialized.status = status
      // h3 copies the cause's `data` onto the wrapper, so the cause already decided how it is logged.
      // For an EvlogError that copy also includes the guidance.
      const data = isEvlogError(cause) ? undefined : payloadOf(error, 'data', payloadShownBy(error))
      if (data !== undefined && data !== readErrorField(cause, 'data')) serialized.data = walk(data, ancestors)
      ancestors.pop()
      return serialized
    }

    const serialized: Record<string, unknown> = {
      name: error.name,
      message: error.message,
      stack: formatStack(error.stack),
    }
    const shown = payloadShownBy(error)
    for (const key of ERROR_FIELDS) {
      const value = key === 'status'
        ? statusOf(error)
        : key === 'data' || key === 'internal' ? payloadOf(error, key, shown) : readErrorField(error, key)
      if (value !== undefined) serialized[key] = walk(value, ancestors)
    }
    if (isH3InputOf(error, cause)) {
      if (cause.fatal !== undefined) serialized.fatal = cause.fatal
      if (cause.unhandled !== undefined) serialized.unhandled = cause.unhandled
    } else if (cause !== undefined) {
      serialized.cause = walk(cause, ancestors)
    }
    ancestors.pop()
    return serialized
  }

  /** Copies an object or array only once one of its values changes, so an event without errors is returned as it is. */
  function walk(value: unknown, ancestors: object[]): unknown {
    if (value === null || typeof value !== 'object') return value
    if (ancestors.includes(value)) return '[Circular]'
    if (value instanceof Error) return serialize(value, ancestors)
    if (typeof (value as { toJSON?: unknown }).toJSON === 'function') return value

    ancestors.push(value)
    let copy: unknown
    if (Array.isArray(value)) {
      let items: unknown[] | undefined
      for (let i = 0; i < value.length; i++) {
        const item: unknown = value[i]
        if (item === null || typeof item !== 'object') {
          if (items) items[i] = item
          continue
        }
        const result = walk(item, ancestors)
        if (items) items[i] = result
        else if (!Object.is(result, item)) (items = value.slice())[i] = result
      }
      copy = items
    } else {
      const record = value as Record<string, unknown>
      const keys = Object.keys(record)
      let fields: Record<string, unknown> | undefined
      for (let i = 0; i < keys.length; i++) {
        const item = record[keys[i]!]
        if (item === null || typeof item !== 'object') {
          if (fields) defineField(fields, keys[i]!, item)
          continue
        }
        const result = walk(item, ancestors)
        if (fields) {
          defineField(fields, keys[i]!, result)
        } else if (!Object.is(result, item)) {
          fields = {}
          for (let j = 0; j < i; j++) defineField(fields, keys[j]!, record[keys[j]!])
          defineField(fields, keys[i]!, result)
        }
      }
      if (fields) {
        // Keep the prototype so a copied class instance is still replaced, not merged, by a later set().
        const proto = Object.getPrototypeOf(value)
        if (proto !== Object.prototype) Object.setPrototypeOf(fields, proto)
      }
      copy = fields
    }
    ancestors.pop()
    return copy ?? value
  }

  return {
    serializeError: error => serialize(error, []),
    serializeErrorsIn: value => value !== null && typeof value === 'object' && mayHoldError(value, 0) ? walk(value, []) : value,
  }
}
