import type { LogLevel } from '../types'

/**
 * OpenTelemetry severity numbers per evlog log level.
 * @see https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-severitynumber
 */
export const OTEL_SEVERITY_NUMBER: Record<LogLevel, number> = {
  trace: 1,
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
  fatal: 21,
}

export const OTEL_SEVERITY_TEXT: Record<LogLevel, string> = {
  trace: 'TRACE',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
  fatal: 'FATAL',
}
