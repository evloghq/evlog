import type { EvlogMapRuleId } from 'evlog'
import type { FileFacts } from '../facts'
import type { ParseResult } from '../parse'
import { walkAst } from '../parse'
import type { Suppression } from '../directives'
import { collectSuppressions, suppressionMessage } from '../directives'
import { getRouteExemption, isSkipped } from '../exemptions'
import type { ProjectFacts } from '../project-facts'
import type { CheckId, CheckResult, Framework, ScanContext } from '../types'
import { lineSnippet } from '../utils'
import { aiLoggingRule } from './ai-logging'
import { auditRule } from './audit'
import { auditCoverageRule } from './audit-coverage'
import { authIdentityRule } from './auth-identity'
import { contextRule } from './context'
import { errorCatalogRule } from './error-catalog'
import { errorHandlingRule } from './error-handling'
import { pageErrorHandlingRule } from './page-error-handling'
import { structuredErrorsRule } from './structured-errors'
import { wideEventRule } from './wide-event'
import type {
  FrameworkCapabilities,
  MapRule,
  OpportunityRule,
  RequirementRule,
  RuleContext,
  RuleListeners,
  RuleReport,
  RuleTarget,
} from './types'

/** Literal-typed registry, so the ids can be checked against {@link CheckId}. */
const REGISTRY = [
  wideEventRule,
  contextRule,
  structuredErrorsRule,
  auditRule,
  errorHandlingRule,
  pageErrorHandlingRule,
  errorCatalogRule,
  auditCoverageRule,
  aiLoggingRule,
  authIdentityRule,
] as const

/**
 * The registry and the published {@link CheckId} union must describe the same
 * set of rules, in both directions. `evlog.map.json` is a public contract, so
 * drift here would silently change what consumers receive — this fails the
 * build instead of the next release.
 */
type RegisteredId = typeof REGISTRY[number]['id']
type AssertIdsMatch = [RegisteredId] extends [CheckId]
  ? [CheckId] extends [RegisteredId] ? true : never
  : never
const idsMatch: AssertIdsMatch = true
void idsMatch

/* `map.rules` in evlog.config is typed by the core package, so its ids must
   be the ones this registry runs. */
type AssertConfigIdsMatch = [EvlogMapRuleId] extends [CheckId]
  ? [CheckId] extends [EvlogMapRuleId] ? true : never
  : never
const configIdsMatch: AssertConfigIdsMatch = true
void configIdsMatch

/**
 * Every observability rule, in report order.
 *
 * Adding a rule is one new file plus one line in {@link REGISTRY}. Nothing else
 * needs to change: weight, column title, docs link, and applicability all
 * travel with the rule.
 */
export const RULES: readonly MapRule[] = REGISTRY

/**
 * Version of the rule set as written into `evlog.map.json`.
 *
 * Bump this only when a rule's semantics change in a way that could flip a
 * verdict for code a PR did not touch: a tightened check, a new requirement, a
 * reweighting. A release that adds a map feature without moving any verdict
 * must leave it alone, or every project would be forced to regenerate its
 * baseline for nothing. Written beside the CLI version so `--baseline` can
 * tell a stale committed map apart from a merely older one.
 */
export const RULE_SET_VERSION = 1

/** Why a check is `n/a` when `evlog.config` turns it off. */
export const RULE_OFF_MESSAGE = 'turned off in evlog.config'

const RULES_BY_ID = new Map<CheckId, MapRule>(RULES.map(rule => [rule.id, rule]))

/** Look up a rule's metadata — weight, title, docs link, suggested fix. */
export function getRule(id: CheckId): MapRule | undefined {
  return RULES_BY_ID.get(id)
}

/** Whether a rule's question makes any sense for this target at all. */
function isRelevant(rule: MapRule, target: RuleTarget, framework: Framework): boolean {
  if (!rule.appliesTo.kinds.includes(target.kind)) return false
  if (rule.appliesTo.frameworks && !rule.appliesTo.frameworks.includes(framework)) return false
  return true
}

function toCheckResult(report: RuleReport, target: RuleTarget, source: string): CheckResult {
  const line = reportLine(report, target)
  return {
    status: 'fail',
    message: report.message,
    evidence: {
      file: target.file,
      line,
      snippet: report.snippet ? lineSnippet(source, line) : undefined,
    },
  }
}

/** The line a finding points at — what a `-next-line` directive has to cover. */
function reportLine(report: RuleReport, target: RuleTarget): number {
  return report.line ?? target.handler?.line ?? 1
}

/**
 * A finding the author waived with a comment.
 *
 * `n/a` rather than `pass`: the rule did find something, and calling that a pass
 * would read as coverage the entry point does not have. The evidence points at
 * the comment, so a reader can find the decision and the reason behind it.
 */
function toSuppressedResult(suppression: Suppression, target: RuleTarget): CheckResult {
  return {
    status: 'n/a',
    suppressed: true,
    message: suppressionMessage(suppression),
    evidence: { file: target.file, line: suppression.declaredAt },
  }
}

/** One entry point, parsed and reduced to facts, ready for the rules. */
export interface RuleRun {
  ctx: ScanContext
  target: RuleTarget
  parsed: ParseResult | null
  facts: FileFacts | null
  project: ProjectFacts
  capabilities: FrameworkCapabilities
}

/** Requirement results and opportunity results, kept apart. */
export interface RuleResults {
  checks: Partial<Record<CheckId, CheckResult>>
  suggestions: Partial<Record<CheckId, CheckResult>>
  /** Problems with the file's own `evlog-map-disable` comments, e.g. a typo'd id. */
  warnings: string[]
}

/**
 * Run every applicable rule against one entry point in a single AST pass.
 *
 * Rules that are irrelevant by kind or framework are left out of the result
 * entirely; rules that are relevant but gated by `when` (sensitivity, presence
 * of a fetch, whether the project uses a feature) are reported as `n/a`, so the
 * map distinguishes "this question makes no sense here" from "this question does
 * not apply right now".
 */
export function runRules(run: RuleRun): RuleResults {
  return runRuleSet(RULES, run)
}

/**
 * {@link runRules} against an explicit set of rules.
 *
 * Exposed so a single rule can be exercised in isolation — the equivalent of
 * ESLint's `RuleTester`, which is what makes a false positive a local fix
 * rather than an archaeology session.
 */
export function runRuleSet(rules: readonly MapRule[], run: RuleRun): RuleResults {
  const { ctx, target, parsed, facts } = run
  const results: RuleResults = { checks: {}, suggestions: {}, warnings: [] }
  const bucket = (rule: MapRule): Partial<Record<CheckId, CheckResult>> =>
    rule.category === 'requirement' ? results.checks : results.suggestions
  const relevant = rules.filter(rule => isRelevant(rule, target, ctx.framework))
  /* Depends only on the route's path and file, so it holds even for a file we
     cannot read — an exempt health check stays exempt when it fails to parse. */
  const exemption = getRouteExemption(target)
  /* A check turned off for the project is `n/a` as a requirement and silence
     as an opportunity, the same way a check that does not apply is. */
  const turnedOff = (rule: MapRule): boolean => {
    if (!ctx.rulesOff?.has(rule.id)) return false
    if (rule.category === 'requirement') results.checks[rule.id] = { status: 'n/a', message: RULE_OFF_MESSAGE }
    return true
  }

  if (!parsed || !facts) {
    /* A file that will not parse is a real failure, but only of requirements —
       we have no basis to suggest anything about code we could not read. */
    for (const rule of relevant) {
      if (rule.category !== 'requirement' || turnedOff(rule)) continue
      if (exemption && isSkipped(exemption, rule.id)) {
        results.checks[rule.id] = { status: 'n/a', message: exemption.reason }
        continue
      }
      results.checks[rule.id] = {
        status: 'fail',
        message: 'file failed to parse',
        evidence: { file: target.file, line: 1, snippet: undefined },
      }
    }
    return results
  }

  /* Validated against the whole registry rather than `rules`, so exercising one
     rule in isolation never turns a valid id into a warning. */
  const suppressions = collectSuppressions(parsed.comments, parsed.lines)
  for (const { id, declaredAt } of suppressions.unknown(RULES.map(rule => rule.id))) {
    results.warnings.push(`${target.file}:${declaredAt} disables "${id}", which is not a check evlog map runs`)
  }
  const active: Array<{ rule: MapRule, listeners: RuleListeners, reports: RuleReport[] }> = []

  for (const rule of relevant) {
    if (turnedOff(rule)) continue
    if (exemption && isSkipped(exemption, rule.id)) {
      bucket(rule)[rule.id] = { status: 'n/a', message: exemption.reason }
      continue
    }

    const base = {
      target,
      facts,
      project: run.project,
      framework: ctx.framework,
      capabilities: run.capabilities,
      hasEvlog: ctx.hasEvlog,
      source: parsed.source,
    }
    if (rule.appliesTo.when && !rule.appliesTo.when(base)) {
      /* An opportunity that does not apply is silence, not a row in the report:
         "you could use a feature you don't use" is noise. */
      if (rule.category === 'requirement') results.checks[rule.id] = { status: 'n/a' }
      continue
    }

    const reports: RuleReport[] = []
    const context: RuleContext = { ...base, report: report => reports.push(report) }
    active.push({ rule, listeners: rule.create(context), reports })
  }

  /* One walk shared by every rule, dispatched by node type. Skipped entirely
     when no rule asked for nodes, which is the common case now that the facts
     already answer most questions. */
  const withNodeListeners = active.filter(entry => hasNodeListeners(entry.listeners))
  if (withNodeListeners.length > 0) {
    walkAst(parsed.program, (node) => {
      for (const entry of withNodeListeners) {
        entry.listeners[node.type]?.(node)
      }
    })
  }

  for (const entry of active) {
    entry.listeners.onEnd?.()
    const [first] = entry.reports
    /* An opportunity with nothing to say is left out entirely. */
    if (entry.rule.category === 'opportunity' && !first) continue

    if (first) {
      /* Directives are resolved once a rule has something to say, rather than
         before it runs: a disabled check is a failure the author chose not to
         see, so a rule that would have passed is still reported as passing, and
         one that never applied stays a plain `n/a`. That keeps the count of
         disabled checks equal to the number of findings actually waived. */
      const disabled = suppressions.file(entry.rule.id)
        ?? suppressions.at(entry.rule.id, reportLine(first, target))
      if (disabled) {
        if (entry.rule.category === 'requirement') {
          results.checks[entry.rule.id] = toSuppressedResult(disabled, target)
        }
        continue
      }
    }

    bucket(entry.rule)[entry.rule.id] = first
      ? toCheckResult(first, target, parsed.source)
      : { status: 'pass' as const }
  }

  return results
}

/** Rules that move the score, in report order. */
export const REQUIREMENTS: readonly RequirementRule[] = RULES.filter(
  (rule): rule is RequirementRule => rule.category === 'requirement',
)

/** Rules that suggest going further, in report order. */
export const OPPORTUNITIES: readonly OpportunityRule[] = RULES.filter(
  (rule): rule is OpportunityRule => rule.category === 'opportunity',
)

/** Whether a rule registered anything beyond the end-of-pass hook. */
function hasNodeListeners(listeners: RuleListeners): boolean {
  return Object.keys(listeners).some(key => key !== 'onEnd')
}

export { HANDLER_KINDS } from './types'
export type {
  FixSlot,
  FrameworkCapabilities,
  MapRule,
  OpportunityRule,
  RequirementRule,
  RuleContext,
  RuleListeners,
  RuleTarget,
  SuggestContext,
} from './types'
