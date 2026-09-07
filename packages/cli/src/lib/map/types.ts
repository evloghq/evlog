import type { ParseFn } from './parse'
import type { ProjectFacts } from './project-facts'

/** Frameworks the `map` command can scan (adapter selection key). */
export type Framework = 'nuxt' | 'nitro' | 'next' | 'tanstack-start' | 'hono' | 'express' | 'fastify' | 'elysia'

/** Route shape as detected on disk, before observability checks run. */
export type RouteKind = 'api' | 'page' | 'middleware' | 'server-action' | 'cron' | 'websocket'

/**
 * One rule `map` runs against an entry point.
 *
 * Covers both categories: requirements, which cost score points when they fail,
 * and opportunities, which never do. Requirement results land in
 * {@link RouteEntry.checks}, opportunities in {@link RouteEntry.suggestions}.
 */
export type CheckId =
  | 'wide-event'
  | 'context'
  | 'structured-errors'
  | 'audit'
  | 'error-handling'
  | 'page-error-handling'
  | 'error-catalog'
  | 'audit-coverage'
  | 'ai-logging'
  | 'auth-identity'

export interface HandlerLocation {
  line: number
  column: number
}

export interface CheckEvidence {
  file: string
  line: number
  snippet?: string
}

export interface CheckResult {
  status: 'pass' | 'fail' | 'n/a'
  evidence?: CheckEvidence
  message?: string
  /**
   * The author turned this check off with an `evlog-map-disable` comment.
   *
   * Always paired with `status: 'n/a'`, so it costs no score. Kept as its own
   * field rather than inferred from the message: a CI job that wants to know how
   * much of a green score is suppressed should not have to parse prose.
   */
  suppressed?: true
}

export interface Sensitivity {
  level: 'high' | 'medium' | 'none'
  reasons: string[]
}

/** Route extracted from the filesystem, before checks run. */
export interface RawRouteEntry {
  framework: Framework
  kind: RouteKind
  method: string | null
  path: string
  file: string
  handler: HandlerLocation | null
}

/** A scanned route with checks, sensitivity, and score attached. */
export interface RouteEntry extends RawRouteEntry {
  id: string
  /** Requirement results. These, and only these, move the score. */
  checks: Partial<Record<CheckId, CheckResult>>
  /**
   * Opportunity results — features the project already uses that this entry
   * point could benefit from. Kept apart from {@link checks} so a suggestion is
   * never mistaken for a failure, by a reader or by a CI gate.
   */
  suggestions: Partial<Record<CheckId, CheckResult>>
  sensitivity: Sensitivity
  score: number
}

/** The `evlog.map.json` shape written to disk. */
export interface MapFile {
  version: 1
  generatedAt: string
  /**
   * The CLI version that wrote this map, for the `--baseline` compatibility
   * check. Absent on maps written before version reporting existed, which the
   * baseline check treats as "unknown" rather than failing.
   */
  cliVersion?: string
  /**
   * Rule-set version, bumped only when a rule's semantics change.
   *
   * A package release that adds an unrelated feature must not force every
   * project to regenerate its baseline, so this is not the package version: it
   * moves only when a verdict this map records could change for code the PR
   * did not touch. Absent on pre-versioning maps, treated as "unknown".
   */
  ruleSetVersion?: number
  framework: Framework
  projectName: string
  score: number
  routes: RouteEntry[]
}

export interface ScanContext {
  projectRoot: string
  framework: Framework
  projectName: string
  hasEvlog: boolean
  verbose: boolean
  /**
   * Read-and-parse for this scan, memoized per path.
   *
   * Adapters and the scan itself want the same files, so they share one parser
   * and each file goes through oxc once. Defaults to an uncached read.
   */
  parse?: ParseFn
}

export interface FrameworkAdapter {
  framework: Framework
  extractRoutes: (ctx: ScanContext) => Promise<RawRouteEntry[]>
  /**
   * evlog identifiers the framework injects without an import.
   *
   * Framework knowledge belongs here rather than in the rules: a rule asks
   * "is this evlog's logger?" and the adapter is what makes an un-imported
   * `useLogger()` a legitimate answer. Only evlog's own names go here — h3's
   * `createError` is auto-imported too, but it is not evidence of evlog.
   */
  evlogAutoImports?: readonly string[]
  /**
   * Whether a request logger exists without the handler asking for one.
   *
   * `ambient` means the framework integration emits an event per request on its
   * own (evlog's Nitro plugin does), so a handler that never calls `useLogger()`
   * still produces an event — just one with no business context. `explicit`
   * means nothing is emitted until the code opts in.
   */
  requestLogger: 'ambient' | 'explicit'
  /**
   * Per-project override for `requestLogger`, for frameworks where ambient
   * emission depends on app code (Hono's `app.use(evlog())`) rather than a
   * module the framework loads on its own.
   */
  resolveRequestLogger?: (ctx: ScanContext) => 'ambient' | 'explicit'
}

export type Grade = 'excellent' | 'good' | 'needs-work' | 'at-risk'

/**
 * A suggestion whose work is one edit for the whole project.
 *
 * Kept out of {@link RouteEntry.suggestions} so it is never counted per entry
 * point: `evlog/better-auth` is installed once, not once per handler.
 */
export interface ProjectSuggestion {
  id: CheckId
  message: string
  /** Where it was first noticed — a place to start reading, not the only fix. */
  evidence?: CheckEvidence
}

export interface ScanResult {
  map: MapFile
  grade: Grade
  /** What the project already adopted — why the suggestions are what they are. */
  project: ProjectFacts
  /** Opportunities that are one project-wide edit rather than per-entry-point work. */
  suggestions: ProjectSuggestion[]
  /** Problems found while scanning — a disable comment naming an unknown check. */
  warnings: string[]
  summary: {
    instrumented: number
    partial: number
    dark: number
    exempt: number
    /** Checks turned off by an `evlog-map-disable` comment, across the project. */
    suppressedChecks: number
  }
}
