import { relative, resolve, sep } from 'node:path'
import { DOCS_URL } from '../../core/output'
import type { BaselineComparison } from './baseline'
import { hasRegressed } from './baseline'
import { RULES, getRule } from './rules/index'
import type { CheckId, CheckResult, RouteEntry, ScanResult } from './types'

/** One failed check with where it points, shared by both machine formats. */
interface Finding {
  route: RouteEntry
  check: CheckId
  result: CheckResult
  /** `error` for a baseline regression or a gate failure, `warning` for a requirement, `note` for an opportunity. */
  level: 'error' | 'warning' | 'note'
}

function regressionKeys(baseline: BaselineComparison | null): Set<string> {
  return new Set(baseline?.regressions.map(regression => `${regression.routeId}:${regression.check}`) ?? [])
}

/**
 * Every failed check in the scan, requirements then opportunities, in route
 * order. Suppressed checks are the author's decision and are left out.
 */
function findings(scan: ScanResult, baseline: BaselineComparison | null): Finding[] {
  const regressed = regressionKeys(baseline)
  const out: Finding[] = []
  for (const route of scan.map.routes) {
    for (const [check, result] of Object.entries(route.checks) as [CheckId, CheckResult][]) {
      if (result.status !== 'fail') continue
      out.push({ route, check, result, level: regressed.has(`${route.id}:${check}`) ? 'error' : 'warning' })
    }
    for (const [check, result] of Object.entries(route.suggestions) as [CheckId, CheckResult][]) {
      if (result.status !== 'fail') continue
      out.push({ route, check, result, level: 'note' })
    }
  }
  return out
}

/**
 * Where the scanned project sits. Scan paths are relative to the project; the
 * runner and code scanning resolve them against the checkout, so when the two
 * differ (a package in a monorepo scanned with `--cwd`) the path is rebased on
 * the workspace.
 */
export interface Location {
  projectRoot: string
  /** `GITHUB_WORKSPACE` on a runner; unset locally, where paths stay as scanned. */
  workspace?: string
}

function lineOf(finding: Finding): number {
  return finding.result.evidence?.line ?? finding.route.handler?.line ?? 1
}

function fileOf(finding: Finding, location: Location): string {
  const file = finding.result.evidence?.file ?? finding.route.file
  if (!location.workspace) return file
  return relative(location.workspace, resolve(location.projectRoot, file)).split(sep).join('/')
}

function messageOf(finding: Finding): string {
  return finding.result.message ?? getRule(finding.check)?.question ?? finding.check
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
 * A regression against the baseline and a score under `--min-score` are errors;
 * any other failing requirement is a warning; an opportunity is left out, since
 * it never costs the score and would read as noise on a pull request. The
 * closing notice carries the score so the run is readable without the log.
 */
export function formatGithubAnnotations(
  scan: ScanResult,
  baseline: BaselineComparison | null,
  location: Location,
  options: { minScore?: number } = {},
): string {
  const lines = findings(scan, baseline)
    .filter(finding => finding.level !== 'note')
    .map(finding => annotation(
      finding.level === 'error' ? 'error' : 'warning',
      { file: fileOf(finding, location), line: String(lineOf(finding)), title: `evlog map: ${finding.check}` },
      messageOf(finding),
    ))

  const { score } = scan.map
  const { dark, instrumented, partial } = scan.summary
  const summary = `score ${score}/100 (${scan.grade}): ${instrumented} instrumented, ${partial} partial, ${dark} dark`

  if (options.minScore !== undefined && score < options.minScore) {
    lines.push(annotation('error', { title: 'evlog map' }, `${summary}; below --min-score ${options.minScore}`))
  } else if (baseline && hasRegressed(baseline)) {
    lines.push(annotation('error', { title: 'evlog map' }, `${summary}; regressed against ${baseline.source.label}`))
  } else {
    lines.push(annotation('notice', { title: 'evlog map' }, summary))
  }

  return lines.join('\n')
}

/**
 * The scan as a SARIF 2.1.0 log, for GitHub code scanning and any other
 * consumer of the format. Every rule the scanner knows is declared, whether it
 * fired or not, so a result's `ruleId` always resolves.
 */
export function toSarif(
  scan: ScanResult,
  baseline: BaselineComparison | null,
  location: Location,
  version: string,
): Record<string, unknown> {
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'evlog',
            version,
            informationUri: `${DOCS_URL}/cli/map`,
            rules: RULES.map(rule => ({
              id: rule.id,
              name: rule.title,
              shortDescription: { text: rule.question },
              helpUri: `${DOCS_URL}${rule.docs}`,
              defaultConfiguration: { level: rule.category === 'requirement' ? 'warning' : 'note' },
              properties: { category: rule.category },
            })),
          },
        },
        results: findings(scan, baseline).map(finding => ({
          ruleId: finding.check,
          level: finding.level,
          message: { text: messageOf(finding) },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: fileOf(finding, location) },
                region: { startLine: lineOf(finding) },
              },
            }
          ],
        })),
      }
    ],
  }
}
