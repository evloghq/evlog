import type { InstrumentationOptions } from './instrumentation-create'

/** Request payload passed to Next.js `onRequestError` (App Router). */
export interface NextInstrumentationRequest {
  path: string
  method: string
  headers: Record<string, string>
}

/** Routing context passed to Next.js `onRequestError`. */
export interface NextInstrumentationErrorContext {
  routerKind: string
  routePath: string
  routeType: string
  renderSource: string
}

/**
 * What your instrumentation module should export for use with {@link defineNodeInstrumentation}
 * (typically the return values of `createInstrumentation()` from `evlog/next/instrumentation/create`).
 */
export interface NodeInstrumentationModule {
  register: () => void | Promise<void>
  onRequestError: (
    error: { digest?: string } & Error,
    request: NextInstrumentationRequest,
    context: NextInstrumentationErrorContext,
  ) => void | Promise<void>
}

function isLoader(
  value: (() => Promise<NodeInstrumentationModule>) | InstrumentationOptions,
): value is () => Promise<NodeInstrumentationModule> {
  return typeof value === 'function'
}

function createOptionsLoader(options: InstrumentationOptions): () => Promise<NodeInstrumentationModule> {
  return async () => {
    // Next.js inlines NEXT_RUNTIME in every module it bundles: the Node.js build
    // includes this import, the Edge build drops the branch with it.
    if (process.env.NEXT_RUNTIME === 'nodejs') {
      const { createInstrumentation } = await import('./instrumentation-create')
      return createInstrumentation(options)
    }
    throw new Error('[evlog] createInstrumentation only runs in the Node.js runtime')
  }
}

/**
 * Hooks returned by {@link defineNodeInstrumentation} for root `instrumentation.ts`.
 *
 * - `register` — async startup hook; initializes the global logger on Node.js only.
 * - `onRequestError` — logs SSR/RSC errors outside `withEvlog` via {@link NextInstrumentationRequest}
 *   and {@link NextInstrumentationErrorContext}.
 */
export type NodeInstrumentationHooks = {
  /** Next.js instrumentation startup hook (Node.js runtime only). */
  register: () => Promise<void>
  /** Next.js global request error handler (Node.js runtime only). */
  onRequestError: (
    error: { digest?: string } & Error,
    request: NextInstrumentationRequest,
    context: NextInstrumentationErrorContext,
  ) => Promise<void>
}

/** Options for {@link defineNodeInstrumentation} or a custom Node-only module loader. */
export type DefineNodeInstrumentationInput =
  | InstrumentationOptions
  | (() => Promise<NodeInstrumentationModule>)

/**
 * Root `instrumentation.ts` entry: load evlog only in the Node.js runtime so Edge bundles stay clean.
 * Caches the dynamic `import()` so `register` and repeated `onRequestError` share one module instance.
 *
 * @example
 * ```ts
 * // instrumentation.ts
 * import { defineNodeInstrumentation } from 'evlog/next/instrumentation'
 *
 * export const { register, onRequestError } = defineNodeInstrumentation({
 *   service: 'my-app',
 *   captureOutput: true,
 * })
 * ```
 */
export function defineNodeInstrumentation(
  loaderOrOptions: DefineNodeInstrumentationInput,
): NodeInstrumentationHooks {
  const loader = isLoader(loaderOrOptions) ? loaderOrOptions : createOptionsLoader(loaderOrOptions)
  let cached: Promise<NodeInstrumentationModule> | undefined

  function load(): Promise<NodeInstrumentationModule> {
    cached ??= loader()
    return cached
  }

  return {
    async register() {
      if (process.env.NEXT_RUNTIME !== 'nodejs') return
      const mod = await load()
      await mod.register()
    },
    async onRequestError(
      error: { digest?: string } & Error,
      request: NextInstrumentationRequest,
      context: NextInstrumentationErrorContext,
    ) {
      if (process.env.NEXT_RUNTIME !== 'nodejs') return
      const mod = await load()
      await mod.onRequestError(error, request, context)
    },
  }
}
