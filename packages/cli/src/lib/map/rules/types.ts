import type { Node } from 'oxc-parser'
import type { FileFacts } from '../facts'
import type { ProjectFacts } from '../project-facts'
import type { CheckId, Framework, RawRouteEntry, RouteKind, Sensitivity } from '../types'

/** Entry-point kinds that own a server-side wide event. */
export const HANDLER_KINDS: readonly RouteKind[] = ['api', 'server-action', 'middleware', 'cron']

/** The entry point a rule is looking at, with its sensitivity already resolved. */
export interface RuleTarget extends RawRouteEntry {
  sensitivity: Sensitivity
}

/** A gap a rule found. Reporting nothing means the rule passed. */
export interface RuleReport {
  message: string
  /** Defaults to the handler's line. */
  line?: number
  /** Attach the source line as evidence. */
  snippet?: boolean
}

export interface RuleContext {
  target: RuleTarget
  facts: FileFacts
  /** What the project has already adopted — the gate for every opportunity. */
  project: ProjectFacts
  framework: Framework
  /** What the framework integration does on its own, declared by its adapter. */
  capabilities: FrameworkCapabilities
  /** Whether evlog is installed at all — some rules phrase themselves differently. */
  hasEvlog: boolean
  source: string
  report: (report: RuleReport) => void
}

/** The parts of a {@link FrameworkAdapter} a rule is allowed to depend on. */
export interface FrameworkCapabilities {
  requestLogger: 'ambient' | 'explicit'
  evlogAutoImports: readonly string[]
  /** Member the integration parks the request logger under on the request object, e.g. `log` for `req.log`. */
  requestLoggerMember?: string
}

/**
 * Node-type listeners dispatched during the shared AST pass, plus `onEnd` for
 * verdicts that depend on the whole file ("nothing anywhere in this handler").
 *
 * Most rules only need `onEnd` because {@link FileFacts} already answers their
 * question; listeners are the escape hatch for anything the facts do not cover.
 */
export type RuleListeners = Partial<Record<Node['type'], (node: Node) => void>> & {
  onEnd?: () => void
}

/**
 * Which entry points a rule looks at.
 *
 * Declarative on purpose: rules used to guard themselves with an early
 * `return n/a`, which meant the same routing logic was written once per rule
 * and again in the runner. Here the runner is the only place that decides.
 */
export interface RuleApplicability {
  /**
   * Entry-point kinds. A rule that does not apply to a kind is left out of the
   * report entirely, rather than reported as not-applicable.
   */
  kinds: readonly RouteKind[]
  /** Restrict to specific frameworks. Omit for all of them. */
  frameworks?: readonly Framework[]
  /**
   * Last word before the rule runs, for conditions only known after parsing
   * (sensitivity, presence of a fetch, …). Returning `false` reports the rule
   * as not-applicable, which is visible in the map — unlike `kinds`.
   */
  when?: (context: Omit<RuleContext, 'report'>) => boolean
}

/**
 * Where a rule's fix belongs inside an entry point.
 *
 * The report composes the suggested shape from these slots, so a rule added
 * later lands in the snippet without anyone editing the renderer. `body` is the
 * default because most fixes are simply one more call among the work.
 *
 * - `setup` — before the work, e.g. acquiring the logger.
 * - `body` — among the work, e.g. an audit record.
 * - `guard` — wraps the work: the rule opens a `catch` and the report closes it.
 * - `exit` — how the entry point fails, e.g. the shape of a thrown error.
 */
export type FixSlot = 'setup' | 'body' | 'guard' | 'exit'

/**
 * What every rule declares about itself.
 *
 * A rule owns its column title, its documentation link, and the fix it
 * suggests, so that adding a rule means adding one file and one registry entry,
 * instead of editing six tables that have no way of telling you they went out
 * of sync.
 */
interface BaseRule {
  id: CheckId
  /** Column header in `--all`, kept to ~8 characters. */
  title: string
  /** The concrete thing the rule wants to see, e.g. `log.audit`. */
  expects: string
  /** The question this rule answers, as a sentence, for `--inspect`. */
  question: string
  /** Docs path, e.g. `/learn/lifecycle`. */
  docs: string
  appliesTo: RuleApplicability
  /** Code suggestion shown by `evlog map <file>`, aware of framework and project. */
  suggest?: (context: SuggestContext) => readonly string[]
  /** Where {@link BaseRule.suggest} belongs in the composed shape. Defaults to `body`. */
  fixSlot?: FixSlot
  create: (context: RuleContext) => RuleListeners
}

/** What a rule may use to shape its suggested code. */
export interface SuggestContext {
  target: RuleTarget
  framework: Framework
  /** Lets a suggestion name what the project already has, e.g. its catalog. */
  project: ProjectFacts
}

/** A rule whose failure is a real gap, and costs score points. */
export interface RequirementRule extends BaseRule {
  category: 'requirement'
  /** Points removed from an entry point's score when this rule fails. */
  weight: number
}

/**
 * A rule that suggests going further with a feature the project already uses.
 *
 * Opportunities carry no weight — the type makes it impossible to give one, so
 * a suggestion can never quietly turn into a penalty. Nobody is scored down for
 * not adopting a feature they never asked for; they are only pointed at more of
 * what they already chose.
 */
export interface OpportunityRule extends BaseRule {
  category: 'opportunity'
  /**
   * Where the work actually is.
   *
   * `entry-point` (the default) means each hit is its own edit. `project` means
   * the whole suggestion is one installation, done once — reporting it per entry
   * point would claim there are five things to do when there is one.
   */
  scope?: 'entry-point' | 'project'
}

export type MapRule = RequirementRule | OpportunityRule
