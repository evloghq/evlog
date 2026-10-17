import type { Log, LogLevel, TransportConfig } from '../../types'
import { createErrorSerializer } from '../../shared/serialize-error'
import { cssColors, escapeFormatString, formatMessage, getCssLevelColor, hasMessageSpecifiers, isBrowser, isLevelEnabled, isLogLevel, isoNow } from '../../utils'

const { serializeErrorsIn } = createErrorSerializer()

/**
 * Browser DevTools often hide or bucket `console.debug` under "Verbose" in a way that looks like
 * nothing happened. Use `console.log` for debug-level client output so it shows with the default
 * Info filter; the structured payload still has `level: 'debug'`.
 */
function browserConsoleMethod(level: LogLevel): 'log' | 'info' | 'warn' | 'error' {
  if (level === 'debug' || level === 'trace') return 'log'
  if (level === 'fatal') return 'error'
  return level as 'info' | 'warn' | 'error'
}

let clientEnabled = true
let clientConsole = true
let clientPretty = true
let clientMinLevel: LogLevel = 'debug'
let clientService = 'client'
let transportEnabled = false
let transportEndpoint = '/api/_evlog/ingest'
let transportCredentials: RequestCredentials = 'same-origin'
let identityContext: Record<string, unknown> = {}

export function setIdentity(identity: Record<string, unknown>): void {
  identityContext = { ...identity }
}

export function clearIdentity(): void {
  identityContext = {}
}


export function initLog(options: { enabled?: boolean, console?: boolean, pretty?: boolean, minLevel?: LogLevel, service?: string, transport?: TransportConfig } = {}): void {
  clientEnabled = typeof options.enabled === 'boolean' ? options.enabled : true
  clientConsole = typeof options.console === 'boolean' ? options.console : true
  clientPretty = typeof options.pretty === 'boolean' ? options.pretty : true
  // Nuxt public runtime config turns an unset `minLevel` into `''`.
  clientMinLevel = isLogLevel(options.minLevel) ? options.minLevel : 'debug'
  clientService = options.service ?? 'client'
  transportEnabled = options.transport?.enabled ?? false
  transportEndpoint = options.transport?.endpoint ?? '/api/_evlog/ingest'
  transportCredentials = options.transport?.credentials ?? 'same-origin'
}

/**
 * Update the minimum log level at runtime (e.g. enable verbose client logs from a debug toggle).
 */
export function setMinLevel(level: LogLevel): void {
  clientMinLevel = level
}

async function sendToServer(event: Record<string, unknown>): Promise<void> {
  if (!transportEnabled) return

  try {
    await fetch(transportEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      keepalive: true,
      credentials: transportCredentials,
    })
  } catch {
    // Silently fail - don't break the app
  }
}

/** The fields every client event starts with, ahead of the logged fields. */
function eventHead(level: LogLevel) {
  return { timestamp: isoNow(), level, service: clientService, ...identityContext }
}

/**
 * The pretty console gets the event as it was logged, so DevTools shows a live
 * Error with its stack. Only the JSON line and the transport need it serialized.
 */
function emitLog(level: LogLevel, event: Record<string, unknown>): void {
  if (!clientEnabled) return
  if (!isLevelEnabled(level, clientMinLevel)) return

  const head = eventHead(level)
  const method = browserConsoleMethod(level)
  if (clientConsole && clientPretty) {
    const { level: lvl, service, ...rest } = { ...head, ...event }
    console[method](`%c[${escapeFormatString(String(service))}]%c ${lvl}`, getCssLevelColor(lvl), cssColors.reset, rest)
  }

  const printsJson = clientConsole && !clientPretty
  if (!printsJson && !transportEnabled) return

  const formatted = { ...head, ...(serializeErrorsIn(event) as Record<string, unknown>) }
  if (printsJson) console[method](JSON.stringify(formatted))
  sendToServer(formatted)
}

function emitTaggedLog(level: LogLevel, tag: string, message: string): void {
  if (!clientEnabled) return
  if (!isLevelEnabled(level, clientMinLevel)) return
  if (clientPretty) {
    if (clientConsole) {
      console[browserConsoleMethod(level)](`%c[${escapeFormatString(tag)}]%c ${escapeFormatString(message)}`, getCssLevelColor(level), cssColors.reset)
    }
    sendToServer({ ...eventHead(level), tag, message })
  } else {
    emitLog(level, { tag, message })
  }
}

function createLogMethod(level: LogLevel) {
  return function logMethod(tagOrEvent: string | Error | Record<string, unknown>, message?: string, ...args: unknown[]): void {
    // Call-time check: avoid relying on import.meta.client (can be false in some mixed bundles).
    if (!isBrowser()) {
      return
    }

    if (typeof tagOrEvent === 'string') {
      if (message === undefined) {
        emitTaggedLog(level, 'log', formatMessage(tagOrEvent, args))
      } else if (hasMessageSpecifiers(tagOrEvent)) {
        // A specifier in the first string marks a pino-style format string,
        // not a tag: `log.info('user %s', name)` must not log the name as a tag.
        emitTaggedLog(level, 'log', formatMessage(tagOrEvent, [message, ...args]))
      } else {
        emitTaggedLog(level, tagOrEvent, formatMessage(message, args))
      }
    } else if (tagOrEvent instanceof Error) {
      emitLog(level, { error: tagOrEvent })
    } else if (typeof tagOrEvent === 'object') {
      emitLog(level, tagOrEvent)
    } else {
      emitTaggedLog(level, 'log', String(tagOrEvent))
    }
  }
}

const _clientLog: Log = {
  info: createLogMethod('info'),
  error: createLogMethod('error'),
  warn: createLogMethod('warn'),
  debug: createLogMethod('debug'),
  fatal: createLogMethod('fatal'),
  trace: createLogMethod('trace'),
}

export { _clientLog as log }
