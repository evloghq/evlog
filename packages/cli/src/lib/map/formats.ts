import { relative, resolve, sep } from 'node:path'
import type { BaselineComparison } from './baseline'
import { hasRegressed } from './baseline'
import { prioritize } from './report'
import { getRule } from './rules/index'
import type { CheckId, CheckResult, RouteEntry, ScanResult } from './types'

/** One check to point at, with where it points. */
interface Finding {
  file: string
  line: number
  check: CheckId
  message: string
}

/**
 * Where the scanned project sits. Scan paths are relative to the project; the
 * runner resolves them against the checkout, so when the two differ (a package
 * in a monorepo scanned with `--cwd`) the path is rebased on the workspace.
 */
export interface Location {
  projectRoot: string
  /** `GITHUB_WORKSPACE` on a runner; unset locally, where paths stay as scanned. */
  workspace?: string
}

export interface AnnotationOptions {
  minScore?: number
  /**
   * Most findings to emit. GitHub keeps ten annotations per level per step and
   * drops the rest without a word, so past that the list is not a list.
   */
  limit: number
}

function rebase(file: string, location: Location): string {
  if (!location.workspace) return file
  return relative(location.workspace, resolve(location.projectRoot, file)).split(sep).join('/')
}

/** The failing requirements of one entry point, with the evidence line when a check has one. */
function failures(route: RouteEntry): Finding[] {
  const out: Finding[] = []
  for (const [check, result] of Object.entries(route.checks) as [CheckId, CheckResult][]) {
    if (result.status !== 'fail') continue
    out.push({
      file: result.evidence?.file ?? route.file,
      line: result.evidence?.line ?? route.handler?.line ?? 1,
      check,
      message: result.message ?? getRule(check)?.question ?? check,
    })
  }
  return out
}

/**
 * Checks that passed in the baseline and no longer do. These are the author's;
 * everything else on the map predates the pull request and is already in the
 * score.
 */
function regressions(scan: ScanResult, baseline: BaselineComparison): Finding[] {
  const routes = new Map(scan.map.routes.map(route => [route.id, route]))
  return baseline.regressions.flatMap((regression) => {
    const route = routes.get(regression.routeId)
    if (!route) return []
    const failed = failures(route).find(finding => finding.check === regression.check)
    if (failed) return [failed]
    return [
      {
        file: route.file,
        line: route.handler?.line ?? 1,
        check: regression.check,
        message: `${regression.check} passed in ${baseline.source.label} and is now silenced`,
      }
    ]
  })
}

/* GitHub reads workflow commands off stdout and unescapes these three in the
   message and these five in the properties; anything else passes through. */
function escapeMessage(text: string): string {
  return text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}

function escapeProperty(text: string): string {
  return escapeMessage(text).replace(/:/g, '%3A').replace(/,/g, '%2C')
}

function annotation(level: 'error' | 'warning' | 'notice', properties: Record<string, string>, message: string): string {
  const props = Object.entries(properties).map(([key, value]) => `${key}=${escapeProperty(value)}`).join(',')
  return `::${level}${props ? ` ${props}` : ''}::${escapeMessage(message)}`
}

/**
 * GitHub Actions workflow commands, one line per finding, for stdout.
 *
 * With a baseline, the findings are the regressions and they are errors: the
 * pull request caused them. Without one, they are the FIX FIRST list the report
 * prints, worst entry point first, as warnings. Either list stops at `limit`.
 * The closing line carries the score, as an error when the gate failed, so the
 * run is readable without the log.
 */
export function formatGithubAnnotations(
  scan: ScanResult,
  baseline: BaselineComparison | null,
  location: Location,
  options: AnnotationOptions,
): string {
  const findings = baseline ? regressions(scan, baseline) : prioritize(scan.map.routes).flatMap(failures)
  const level = baseline ? 'error' : 'warning'
  const lines = findings.slice(0, options.limit).map(finding => annotation(
    level,
    { file: rebase(finding.file, location), line: String(finding.line), title: `evlog map: ${finding.check}` },
    finding.message,
  ))

  const { score } = scan.map
  const { dark, instrumented, partial } = scan.summary
  const hidden = findings.length - lines.length
  const summary = `score ${score}/100 (${scan.grade}): ${instrumented} instrumented, ${partial} partial, ${dark} dark${
     hidden > 0 ? `; ${hidden} more finding${hidden === 1 ? '' : 's'} not shown` : ''}`

  if (options.minScore !== undefined && score < options.minScore) {
    lines.push(annotation('error', { title: 'evlog map' }, `${summary}; below --min-score ${options.minScore}`))
  } else if (baseline && hasRegressed(baseline)) {
    lines.push(annotation('error', { title: 'evlog map' }, `${summary}; regressed against ${baseline.source.label}`))
  } else {
    lines.push(annotation('notice', { title: 'evlog map' }, summary))
  }

  return lines.join('\n')
}
