import { readErrorField } from '../utils'
import { isEvlogError } from './error-brand'

/** Logged after `name`, `message` and `stack`, before `cause`. */
const ERROR_FIELDS = ['code', 'status', 'statusText', 'statusCode', 'statusMessage', 'data', 'internal', 'why', 'fix', 'link'] as const

const NONE: readonly string[] = []

/**
 * The payload fields (`data`, `internal`) an error's own `toJSON` leaves out,
 * which its serialized form leaves out too. `EvlogError#toJSON` shapes the HTTP
 * response and omits `internal`, which logs keep, so it does not count.
 */
function payloadFieldsHiddenBy(error: Error): readonly string[] {
  const { toJSON } = error as { toJSON?: unknown }
  if (typeof toJSON !== 'function' || isEvlogError(error)) return NONE
  const shown: unknown = toJSON.call(error)
  return ['data', 'internal'].filter(key => typeof shown !== 'object' || shown === null || !(key in shown))
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
   */
  function serialize(error: Error, ancestors: WeakSet<object>): Record<string, unknown> {
    const { cause } = error
    ancestors.add(error)

    if (isWrapperOf(error, cause) && !ancestors.has(cause)) {
      const serialized = serialize(cause, ancestors)
      const hidden = payloadFieldsHiddenBy(error)
      for (const key of ['statusCode', 'statusMessage', 'data'] as const) {
        const value = readErrorField(error, key)
        if (value !== undefined && !hidden.includes(key)) serialized[key] = walk(value, ancestors)
      }
      ancestors.delete(error)
      return serialized
    }

    const serialized: Record<string, unknown> = {
      name: error.name,
      message: error.message,
      stack: formatStack(error.stack),
    }
    const hidden = payloadFieldsHiddenBy(error)
    for (const key of ERROR_FIELDS) {
      const value = readErrorField(error, key)
      if (value !== undefined && !hidden.includes(key)) serialized[key] = walk(value, ancestors)
    }
    if (isH3InputOf(error, cause)) {
      if (cause.fatal !== undefined) serialized.fatal = cause.fatal
      if (cause.unhandled !== undefined) serialized.unhandled = cause.unhandled
    } else if (cause !== undefined) {
      serialized.cause = walk(cause, ancestors)
    }
    ancestors.delete(error)
    return serialized
  }

  /** Copies an object or array only once one of its values changes, so an event without errors is returned as it is. */
  function walk(value: unknown, ancestors: WeakSet<object>): unknown {
    if (value === null || typeof value !== 'object') return value
    if (ancestors.has(value)) return '[Circular]'
    if (value instanceof Error) return serialize(value, ancestors)
    if (typeof (value as { toJSON?: unknown }).toJSON === 'function') return value

    ancestors.add(value)
    let copy: unknown
    if (Array.isArray(value)) {
      let items: unknown[] | undefined
      for (let i = 0; i < value.length; i++) {
        const item: unknown = value[i]
        const result = walk(item, ancestors)
        if (items) items[i] = result
        else if (!Object.is(result, item)) (items = value.slice())[i] = result
      }
      copy = items
    } else {
      const entries = Object.entries(value)
      let changed = false
      for (const entry of entries) {
        const result = walk(entry[1], ancestors)
        if (!Object.is(result, entry[1])) {
          entry[1] = result
          changed = true
        }
      }
      if (changed) {
        // Keep the prototype so a copied class instance is still replaced, not merged, by a later set().
        const proto = Object.getPrototypeOf(value)
        copy = Object.fromEntries(entries)
        if (proto !== Object.prototype) Object.setPrototypeOf(copy, proto)
      }
    }
    ancestors.delete(value)
    return copy ?? value
  }

  return {
    serializeError: error => serialize(error, new WeakSet()),
    serializeErrorsIn: value => walk(value, new WeakSet()),
  }
}
