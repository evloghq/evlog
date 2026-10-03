import type { WiringInput, WiringPlan } from '../init/wiring'
import type { RawRouteEntry, ScanContext } from '../map/types'

/**
 * How the CLI recognizes a framework from its `package.json` and config files.
 *
 * The most specific match wins, so a framework built on another (Nuxt on
 * Nitro) outranks it when both match.
 */
export interface FrameworkDetection {
  /** Any of these in `dependencies` or `devDependencies` is a match. */
  deps: readonly string[]
  /** Globs relative to the package root; any hit is a match. */
  configs?: readonly string[]
  /** Any of these dependencies rules the framework out. */
  unlessDeps?: readonly string[]
  specificity: number
}

/** The code `evlog map <file>` suggests, in the framework's own handler syntax. */
export interface FrameworkShape {
  /** How a handler acquires its request logger. */
  loggerCall: string
  /** Wrap suggested statements in the handler declaration for `route`. */
  handler: (route: RawRouteEntry, body: readonly string[]) => string[]
}

/** Route discovery for `evlog map`, loaded only when a scan runs. */
export interface MapAdapter {
  extractRoutes: (ctx: ScanContext) => Promise<RawRouteEntry[]>
  /**
   * Per-project override for {@link FrameworkDefinition.requestLogger}, for
   * frameworks where ambient emission depends on app code (Hono's
   * `app.use(evlog())`) rather than a module the framework loads on its own.
   */
  resolveRequestLogger?: (ctx: ScanContext) => 'ambient' | 'explicit'
}

/** The file plan `evlog init` writes for a framework. Pure: reads the project, writes nothing. */
export type InitPlanner = (input: WiringInput) => WiringPlan

/**
 * Everything the CLI knows about a framework.
 *
 * The definition itself stays free of parser and template code: `map` and
 * `init` are loaders, so `evlog doctor` lists every framework without paying
 * for any scanner. A framework is one directory under `lib/frameworks/` with
 * this definition in `index.ts`, route discovery in `map.ts` and, when
 * `evlog init` can wire it, a planner in `init.ts`.
 */
export interface FrameworkDefinition<TId extends string = string> {
  id: TId
  /** Display name, e.g. `Next.js`. */
  label: string
  /** Integration guide, as a path under `https://evlog.dev`. */
  docs: string
  detect: FrameworkDetection
  /** How a handler obtains its request logger, as written in the `AGENTS.md` block. */
  accessor: string
  /**
   * Whether a request logger exists without the handler asking for one.
   *
   * `ambient` means the framework integration emits an event per request on its
   * own (evlog's Nitro plugin does), so a handler that never calls `useLogger()`
   * still produces an event, just one with no business context. `explicit`
   * means nothing is emitted until the code opts in.
   */
  requestLogger: 'ambient' | 'explicit'
  /**
   * evlog identifiers the framework injects without an import.
   *
   * Framework knowledge belongs here rather than in the rules: a rule asks
   * "is this evlog's logger?" and the definition is what makes an un-imported
   * `useLogger()` a legitimate answer. Only evlog's own names go here: h3's
   * `createError` is auto-imported too, but it is not evidence of evlog.
   */
  evlogAutoImports?: readonly string[]
  /**
   * Member under which the integration parks the request logger on the request
   * object, e.g. `log` for Express's `req.log`. A handler that calls
   * `req.log.set(…)` is instrumented without ever naming `useLogger`.
   */
  requestLoggerMember?: string
  shape: FrameworkShape
  map: () => Promise<MapAdapter>
  init?: () => Promise<InitPlanner>
}

/** Identity with inference: keeps each definition's literal `id` and the presence of `init`. */
export function defineFramework<const T extends FrameworkDefinition>(definition: T): T {
  return definition
}
