import { join } from 'node:path'
import { version as CLI_VERSION } from '../../../package.json'
import { getFramework } from '../frameworks'
import { glob } from '../glob'
import { countSuppressed } from './directives'
import { buildFileFacts } from './facts'
import type { FileFacts } from './facts'
import { createParseCache, parseFile } from './parse'
import { handlerReach } from './reach'
import { collectProjectFacts, readPackageJson } from './project-facts'
import type { ProjectFacts } from './project-facts'
import { RULE_SET_VERSION, getRule, runRules } from './rules/index'
import type { FrameworkCapabilities } from './rules/index'
import { classifySensitivity } from './sensitivity'
import { classifyRouteObservability, gradeFromScore, hasScoredRoutes, scoreGlobal, scoreRoute } from './score'
import type {
  CheckId,
  CheckResult,
  EventShape,
  ExtractedRoute,
  MapFile,
  ProjectSuggestion,
  RawRouteEntry,
  RouteEntry,
  ScanContext,
  ScanResult,
} from './types'
import { relativeFromRoot, routeIds } from './utils'

interface AnalyseInput {
  ctx: ScanContext
  extracted: ExtractedRoute
  id: string
  project: ProjectFacts
  capabilities: FrameworkCapabilities
  /** {@link ProjectFacts.evlogPackages} with the framework's own `evlogModules`. */
  evlogPackages: ReadonlyMap<string, ReadonlySet<string>>
}

/**
 * Analyse one entry point: read it once, derive the facts of the code it
 * runs, classify sensitivity from those facts, then run the rules against them.
 *
 * Sensitivity has to come before the rules because `audit` is gated on it.
 */
function analyseRoute(input: AnalyseInput): { route: RouteEntry, warnings: string[] } {
  const { ctx, id, project, capabilities } = input
  const { scope, recorded, ...raw } = input.extracted
  const parsed = (ctx.parse ?? parseFile)(join(ctx.projectRoot, raw.file))
  const reach = parsed && scope ? handlerReach(parsed, scope) : undefined
  const facts = parsed
    ? buildFileFacts(parsed, {
      evlogAutoImports: capabilities.evlogAutoImports,
      evlogBarrels: project.evlogBarrels,
      evlogPackages: input.evlogPackages,
      requestLoggerMembers: capabilities.requestLoggerMembers,
      middlewareRegistered: capabilities.requestLogger === 'ambient',
      reach,
    })
    : null

  const sensitivity = facts
    ? classifySensitivity(raw, facts)
    : { level: 'none' as const, reasons: [] }
  const { checks, suggestions, warnings } = runRules({
    ctx,
    target: { ...raw, sensitivity, ...(recorded !== undefined && { recorded }) },
    parsed,
    facts,
    reach,
    project,
    capabilities,
  })

  const event = facts ? eventShape(facts) : undefined
  return {
    route: {
      ...raw,
      id,
      checks,
      suggestions,
      sensitivity,
      ...(event ? { event } : {}),
      score: scoreRoute(checks),
    },
    warnings,
  }
}

/** The fields and audit actions the handler's event carries, or nothing when it carries neither. */
function eventShape(facts: FileFacts): EventShape | undefined {
  const fields = [...new Set(facts.loggerCalls('set').flatMap(call => call.fields))]
  const audit = facts.loggerCalls('audit').map(call => call.literals.get('action')).filter(action => action !== undefined)
  return fields.length > 0 || audit.length > 0 ? { fields, audit: [...new Set(audit)] } : undefined
}

/** Extract entry points for `ctx.framework`, run the rules, and score them. */
export async function scan(input: ScanContext): Promise<ScanResult> {
  /* One parser for the whole run: the adapter and the analysis below read the
     same files, and Next emits one entry per exported method. */
  const read = input.parse ?? createParseCache()
  /* A file with a syntax error has no program to read routes or facts from.
     Handing it on as parsed would score whatever is left of it, so it goes on
     as unparsable and is reported. */
  const broken = new Map<string, string[]>()
  let ctx: ScanContext = {
    ...input,
    parse: (file) => {
      const parsed = read(file)
      if (!parsed || parsed.errors.length === 0) return parsed
      broken.set(relativeFromRoot(input.projectRoot, file), parsed.errors)
      return null
    },
  }
  const definition = getFramework(ctx.framework)
  const adapter = await definition.map()
  const capabilities: FrameworkCapabilities = {
    requestLogger: adapter.resolveRequestLogger?.(ctx) ?? definition.requestLogger,
    evlogAutoImports: definition.evlogAutoImports ?? [],
    requestLoggerMembers: definition.requestLoggerMembers,
  }

  const evlogModules = new Map(Object.entries(definition.evlogModules ?? {}).map(([source, names]) => [source, new Set(names)]))
  const project = collectProjectFacts(ctx, {
    packageJson: readPackageJson(ctx.projectRoot),
    evlogAutoImports: capabilities.evlogAutoImports,
    evlogModules,
  })
  /* An app that reaches evlog only through a wrapper package has none of its
     own under pnpm, and the rules would tell it to adopt evlog. */
  if (!ctx.hasEvlog && project.evlogPackages.size > 0) ctx = { ...ctx, hasEvlog: true }
  const evlogPackages = new Map([...project.evlogPackages, ...evlogModules])

  const found = await adapter.extractRoutes(ctx)
  /* A file the adapter could not parse and listed nothing for declares routes
     nobody can name. One failing entry point stands in for them, so a score
     never rises because a file broke. */
  const listed = new Set(found.map(route => route.file))
  const extracted: ExtractedRoute[] = [
    ...found,
    ...[...broken.keys()].filter(file => !listed.has(file)).map((file): RawRouteEntry => ({
      framework: ctx.framework,
      kind: 'api',
      method: null,
      path: '*',
      file,
      handler: null,
    })),
  ]
  const ignored = new Set(ctx.ignore?.length ? glob(ctx.ignore, ctx.projectRoot).map(file => relativeFromRoot(ctx.projectRoot, file)) : [])
  const kept = extracted.filter(raw => !ignored.has(raw.file))
  const ids = routeIds(kept)
  const analysed = kept.map((route, index) => analyseRoute({ ctx, extracted: route, id: ids[index]!, project, capabilities, evlogPackages }))
  const routes = analysed.map(entry => entry.route)
  const unparsed = [...broken]
    .filter(([file]) => !ignored.has(file))
    .map(([file, errors]) => ({ file, errors }))
  const warnings = [
    ...unparsed.map(({ file, errors }) => `${file} failed to parse: ${ctx.verbose ? errors.join(', ') : errors[0]}`),
    ...analysed.flatMap(entry => entry.warnings),
  ]
  const suggestions = hoistProjectSuggestions(routes)

  const globalScore = scoreGlobal(routes)

  const tally = { instrumented: 0, partial: 0, dark: 0, exempt: 0, suppressedChecks: 0 }
  for (const route of routes) {
    tally[classifyRouteObservability(route)]++
    tally.suppressedChecks += countSuppressed(route)
  }

  const map: MapFile = {
    version: 1,
    generatedAt: new Date().toISOString(),
    cliVersion: CLI_VERSION,
    ruleSetVersion: RULE_SET_VERSION,
    framework: ctx.framework,
    projectName: ctx.projectName,
    score: globalScore,
    routes,
  }

  return {
    map,
    grade: hasScoredRoutes(routes) ? gradeFromScore(globalScore) : 'unscored',
    summary: tally,
    project,
    suggestions,
    warnings,
    unparsed,
    ignored: extracted.length - routes.length,
  }
}

/**
 * Move project-scoped suggestions off the routes and into one list.
 *
 * Installing `evlog/better-auth` is a single edit, so leaving a copy on every
 * entry point where auth is in play would make the report claim there are five
 * things to do. The first entry point that raised it keeps the evidence, which
 * is where the reader should look first.
 */
function hoistProjectSuggestions(routes: RouteEntry[]): ProjectSuggestion[] {
  const hoisted = new Map<CheckId, ProjectSuggestion>()

  for (const route of routes) {
    for (const [id, result] of Object.entries(route.suggestions) as [CheckId, CheckResult][]) {
      const rule = getRule(id)
      if (rule?.category !== 'opportunity' || rule.scope !== 'project') continue
      delete route.suggestions[id]
      if (hoisted.has(id) || result.status !== 'fail') continue
      hoisted.set(id, {
        id,
        message: result.message ?? rule.question,
        evidence: result.evidence,
      })
    }
  }

  return [...hoisted.values()]
}
