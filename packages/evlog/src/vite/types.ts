import type { LogLevel, SamplingConfig, TransportConfig } from '../types'

export interface AutoImportsOptions {
  /** Which symbols to auto-import @default ['log', 'createEvlogError', 'parseError'] */
  imports?: string[]
  /** Path for generated TypeScript declarations. Set to false to disable. @default 'auto-imports.d.ts' */
  dts?: string | false
}

export interface ClientOptions {
  /** Service name for client logs @default 'client' */
  service?: string
  /** Enable pretty printing on client @default true in dev */
  pretty?: boolean
  /** Enable console output on client @default true */
  console?: boolean
  /** Minimum severity for client `log` calls (trace and debug < info < warn < error < fatal) @default 'debug' */
  minLevel?: LogLevel
  /** Transport configuration for sending client logs to the server */
  transport?: TransportConfig
}

export interface EvlogViteOptions {
  /** Service name @default 'app' */
  service?: string
  /** Environment name (auto-detected if not set) */
  environment?: string
  /** Enable/disable logging globally @default true */
  enabled?: boolean
  /** Enable pretty printing @default true in dev */
  pretty?: boolean
  /** Suppress console output @default false */
  silent?: boolean
  /** Sampling configuration */
  sampling?: SamplingConfig
  /** Minimum severity for the global `log` API (not request wide events) @default 'debug' */
  minLevel?: LogLevel
  /** Emit JSON strings or raw objects @default true */
  stringify?: boolean
  /** Opt-in auto-imports for log, createEvlogError, parseError */
  autoImports?: boolean | AutoImportsOptions
  /** Log levels to strip from production builds. Set to [] to disable. @default ['debug'] */
  strip?: LogLevel[]
  /** Inject source file:line into log calls. When 'dev', active only during development. @default false */
  sourceLocation?: boolean | 'dev'
  /** Client-side logging configuration */
  client?: ClientOptions
}
