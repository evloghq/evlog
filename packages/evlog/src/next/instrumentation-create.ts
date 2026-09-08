import { registerDiskPrettyErrorSnippetReader } from '../shared/register-disk-snippet'
import type { DrainContext, EnvironmentContext, LogLevel, Log, RedactConfig, SamplingConfig } from '../types'
import type {
  NextInstrumentationErrorContext,
  NextInstrumentationRequest,
} from './instrumentation-gate'

type LoggerModule = typeof import('../logger')
type EvlogProcessOutputGlobal = import('../logger').EvlogProcessOutputGlobal

/** Options for capturing process stdout/stderr as structured log events. */
export interface CaptureOutputOptions {
  /** Capture stdout writes. @default true */
  stdout?: boolean
  /** Capture stderr writes. @default true */
  stderr?: boolean
  /**
   * Skip re-emitting chunks that match these patterns as log events.
   * When omitted, known Next.js Edge bundler warnings are ignored by default.
   */
  ignore?: Array<string | RegExp>
}

/** Default patterns skipped by {@link CaptureOutputOptions.ignore}. */
export const DEFAULT_CAPTURE_OUTPUT_IGNORE: Array<string | RegExp> = [
  'node-module-in-edge-runtime',
  'Edge Instrumentation',
  'https://nextjs.org/docs/messages/node-module-in-edge-runtime',
  'https://nextjs.org/docs/api-reference/edge-runtime',
  'Ecmascript file had an error',
  'A Node.js module is loaded',
  'A Node.js API is used',
  'not supported in the Edge Runtime',
  'not supported inthe Edge Runtime',
  'Import trace:',
]

/**
 * Configuration for {@link createInstrumentation} and {@link defineNodeInstrumentation}.
 * Controls global logger options and optional stdout/stderr capture (Node.js only).
 */
export interface InstrumentationOptions {
  /** Enable or disable all logging globally. @default true */
  enabled?: boolean
  /** Service name for all logged events. */
  service?: string
  /** Environment context overrides. */
  env?: Partial<EnvironmentContext>
  /** Enable pretty printing. @default true in development */
  pretty?: boolean
  /** Suppress built-in console output. @default false */
  silent?: boolean
  /** Sampling configuration for filtering logs. */
  sampling?: SamplingConfig
  /** Minimum severity for the global `log` API. @default 'debug' */
  minLevel?: LogLevel
  /** When pretty is disabled, emit JSON strings or raw objects. @default true */
  stringify?: boolean
  /** Drain callback called with every emitted event. */
  drain?: (ctx: DrainContext) => void | Promise<void>
  /** Auto-redaction configuration for PII protection. @default true in production */
  redact?: boolean | RedactConfig
  /** Capture stdout/stderr as structured log events (Node.js only). */
  captureOutput?: boolean | CaptureOutputOptions
}

interface InstrumentationResult {
  register: () => void | Promise<void>
  onRequestError: (
    error: { digest?: string } & Error,
    request: NextInstrumentationRequest,
    context: NextInstrumentationErrorContext,
  ) => void | Promise<void>
}

let patching = false
let loggerPromise: Promise<LoggerModule> | undefined
let stdoutPatched = false
let stderrPatched = false
let activeCaptureOutput:
  | {
      log: Log
      ignore: Array<string | RegExp>
      stdout: boolean
      stderr: boolean
      silent: boolean
    }
  | undefined

function loadLogger(): Promise<LoggerModule> {
  loggerPromise ??= import('../logger')
  return loggerPromise
}

type AfterFn = (task: () => unknown) => void

let cachedAfter: AfterFn | null | undefined

async function resolveAfter(): Promise<AfterFn | null> {
  if (cachedAfter !== undefined) return cachedAfter
  try {
    const mod = await import('next/server')
    cachedAfter = typeof mod.after === 'function' ? mod.after : null
  } catch {
    cachedAfter = null
  }
  return cachedAfter
}

function createLifecycleSafeDrain(
  drain: (ctx: DrainContext) => void | Promise<void>,
  after: AfterFn | null,
): (ctx: DrainContext) => void | Promise<void> {
  if (!after) return drain
  return (ctx: DrainContext): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      const run = async (): Promise<void> => {
        try {
          await drain(ctx)
          // Buffered drains finish enqueueing before their batches are delivered.
          const { settled } = drain as { settled?: () => Promise<void> }
          if (typeof settled === 'function') await settled()
          resolve()
        } catch (error) {
          reject(error)
        }
      }
      try {
        // Next must receive the delivery promise to keep the invocation alive.
        after(run)
      } catch {
        // Startup and background logs may have no active Next request scope.
        void run()
      }
    })
  }
}

function resolveCaptureOutputOptions(
  captureOutput: InstrumentationOptions['captureOutput'],
): CaptureOutputOptions | undefined {
  if (!captureOutput) return undefined
  if (captureOutput === true) {
    return { stdout: true, stderr: true, ignore: DEFAULT_CAPTURE_OUTPUT_IGNORE }
  }
  return {
    stdout: captureOutput.stdout ?? true,
    stderr: captureOutput.stderr ?? true,
    ignore: captureOutput.ignore ?? DEFAULT_CAPTURE_OUTPUT_IGNORE,
  }
}

function shouldIgnoreCapturedOutput(message: string, ignore: Array<string | RegExp>): boolean {
  return ignore.some((pattern) => {
    if (typeof pattern === 'string') return message.includes(pattern)
    return pattern.test(message)
  })
}

function applyCaptureOutput(config: CaptureOutputOptions, logApi: Log, silent: boolean): void {
  activeCaptureOutput = {
    log: logApi,
    ignore: config.ignore ?? DEFAULT_CAPTURE_OUTPUT_IGNORE,
    stdout: config.stdout !== false,
    stderr: config.stderr !== false,
    silent,
  }

  const proc = globalThis.process

  if (activeCaptureOutput.stdout && !stdoutPatched) {
    const originalStdoutWrite = proc.stdout.write.bind(proc.stdout)
    ;(globalThis as EvlogProcessOutputGlobal).__evlogNativeStdoutWrite = originalStdoutWrite
    stdoutPatched = true
    proc.stdout.write = function(chunk: unknown, ...args: unknown[]): boolean {
      const message = String(chunk).trimEnd()
      const active = activeCaptureOutput
      if (
        !patching
        && message.length > 0
        && active?.stdout
        && !shouldIgnoreCapturedOutput(message, active.ignore)
      ) {
        patching = true
        try {
          active.log.info({ source: 'stdout', message })
        } finally {
          patching = false
        }
        if (!active.silent) {
          return true
        }
      }
      return originalStdoutWrite(chunk as string, ...args as [])
    } as typeof process.stdout.write
  }

  if (activeCaptureOutput.stderr && !stderrPatched) {
    const originalStderrWrite = proc.stderr.write.bind(proc.stderr)
    stderrPatched = true
    proc.stderr.write = function(chunk: unknown, ...args: unknown[]): boolean {
      const message = String(chunk).trimEnd()
      const active = activeCaptureOutput
      if (
        !patching
        && message.length > 0
        && active?.stderr
        && !shouldIgnoreCapturedOutput(message, active.ignore)
      ) {
        patching = true
        try {
          active.log.error({ source: 'stderr', message })
        } finally {
          patching = false
        }
        if (!active.silent) {
          return true
        }
      }
      return originalStderrWrite(chunk as string, ...args as [])
    } as typeof process.stderr.write
  }
}

/**
 * Create Next.js instrumentation hooks (`register`, `onRequestError`).
 *
 * Load via dynamic `import()` from root `instrumentation.ts` (Node.js runtime only).
 * Load via dynamic `import()` from root `instrumentation.ts` with {@link defineNodeInstrumentation}.
 */
export function createInstrumentation(options: InstrumentationOptions = {}): InstrumentationResult {
  let registered = false
  let registerPromise: Promise<void> | undefined
  const captureOutputOptions = resolveCaptureOutputOptions(options.captureOutput)

  function register(): void | Promise<void> {
    if (registered) return
    if (registerPromise) return registerPromise

    registerPromise = loadLogger().then(async ({ initLogger, lockLogger, log }) => {
      const after = options.drain ? await resolveAfter() : null
      initLogger({
        enabled: options.enabled,
        env: {
          service: options.service,
          ...options.env,
        },
        pretty: options.pretty,
        silent: options.silent,
        sampling: options.sampling,
        minLevel: options.minLevel,
        stringify: options.stringify,
        drain: options.drain ? createLifecycleSafeDrain(options.drain, after) : undefined,
        redact: options.redact,
      })
      lockLogger()
      if (process.env.NEXT_RUNTIME === 'nodejs') {
        await registerDiskPrettyErrorSnippetReader()
      }

      if (captureOutputOptions && process.env.NEXT_RUNTIME === 'nodejs') {
        applyCaptureOutput(captureOutputOptions, log, options.silent ?? false)
      }
      registered = true
    }).catch((error) => {
      registerPromise = undefined
      throw error
    })
    return registerPromise
  }

  function onRequestError(
    error: { digest?: string } & Error,
    request: { path: string; method: string; headers: Record<string, string> },
    context: { routerKind: string; routePath: string; routeType: string; renderSource: string },
  ): void | Promise<void> {
    return loadLogger().then(({ log }) => {
      log.error({
        message: error.message,
        digest: error.digest,
        stack: error.stack,
        path: request.path,
        method: request.method,
        routerKind: context.routerKind,
        routePath: context.routePath,
        routeType: context.routeType,
        renderSource: context.renderSource,
      })
    })
  }

  return { register, onRequestError }
}
