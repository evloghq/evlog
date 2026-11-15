import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { cliErrors } from '../errors'
import { version as CLI_VERSION } from '../../../package.json'
import { classifyRouteObservability, scoreGlobal } from './score'
import { RULE_SET_VERSION } from './rules/index'
import type { CheckId, MapFile, RouteEntry } from './types'
import { routeKey } from './utils'
import { MAP_FILE_NAME } from './write'

/** Where a baseline map was read from — the label keeps the spelling the user typed. */
export interface BaselineSource {
  kind: 'file' | 'git'
  label: string
}

/** A requirement that used to pass on this entry point and no longer does. */
export interface CheckRegression {
  routeId: string
  path: string
  method: string | null
  file: string
  check: CheckId
  /** Both gate; the distinction is printed because the fix differs. */
  to: 'fail' | 'suppressed'
}

/** A requirement that was failing in the baseline and now passes. */
export interface CheckFix {
  routeId: string
  path: string
  method: string | null
  file: string
  check: CheckId
}

/** An entry point that exists now and did not exist in the baseline. */
export interface AddedRoute {
  path: string
  method: string | null
  file: string
  /** No requirement passes on it — the case a baseline gate is meant to surface. */
  dark: boolean
}

/** Result of scoring the current scan against a committed map. */
export interface BaselineComparison {
  source: BaselineSource
  baselineScore: number
  score: number
  /**
   * Score movement across the entry points that existed in the baseline.
   *
   * Not `current.score - baseline.score`: that is a weighted average over every
   * route, so a new dark endpoint drags it down and would fail the pull
   * requests this comparison promises not to fail.
   */
  delta: number
  /** `current.score - baseline.score`, for the report. Never gates. */
  totalDelta: number
  /** Requirements that went from pass to fail or suppressed. These gate. */
  regressions: CheckRegression[]
  /** Requirements that went from fail to pass — the report's good news. */
  fixed: CheckFix[]
  added: AddedRoute[]
  /** Ids present in the baseline and gone from the scan (deleted routes). */
  removed: { path: string, method: string | null }[]
}

/** Whether a git ref resolves to a commit in this repository. */
function refExists(cwd: string, ref: string): boolean {
  try {
    execFileSync('git', ['-C', cwd, 'rev-parse', '--verify', '--quiet', ref], {
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    return true
  } catch {
    return false
  }
}

function readGitBaseline(cwd: string, ref: string): string | null {
  try {
    const prefix = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-prefix'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return execFileSync('git', ['-C', cwd, 'show', `${ref}:${prefix}${MAP_FILE_NAME}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch {
    return null
  }
}

function parseMapFile(raw: string, label: string): MapFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw cliErrors.MAP_BASELINE_INVALID({ source: label, reason: 'not valid JSON' })
  }
  const map = parsed as Partial<MapFile>
  if (map?.version !== 1 || !Array.isArray(map.routes) || typeof map.score !== 'number') {
    throw cliErrors.MAP_BASELINE_INVALID({ source: label, reason: 'not an evlog.map.json (version 1)' })
  }
  return map as MapFile
}

/**
 * Read the map to compare against. Local-only: no network, no token, no
 * repository access, so a private repo gates like a public one.
 *
 * @param spec - `git:<ref>` to read the committed copy through git, otherwise a
 * path. Defaults to `evlog.map.json`, falling back to `git:HEAD`.
 */
export function loadBaseline(projectRoot: string, spec?: string): { map: MapFile, source: BaselineSource } {
  if (spec?.startsWith('git:')) {
    const ref = spec.slice(4) || 'HEAD'
    if (!refExists(projectRoot, ref)) throw cliErrors.MAP_BASELINE_REF_NOT_FOUND({ ref })
    const raw = readGitBaseline(projectRoot, ref)
    if (raw === null) throw cliErrors.MAP_BASELINE_NOT_COMMITTED({ ref })
    return { map: parseMapFile(raw, spec), source: { kind: 'git', label: spec } }
  }

  if (spec) {
    const path = isAbsolute(spec) ? spec : resolve(projectRoot, spec)
    let raw: string
    try {
      raw = readFileSync(path, 'utf8')
    } catch {
      throw cliErrors.MAP_BASELINE_NOT_FOUND({ source: spec })
    }
    return { map: parseMapFile(raw, spec), source: { kind: 'file', label: spec } }
  }

  try {
    const raw = readFileSync(resolve(projectRoot, MAP_FILE_NAME), 'utf8')
    return { map: parseMapFile(raw, MAP_FILE_NAME), source: { kind: 'file', label: MAP_FILE_NAME } }
  } catch {
    /* Run twice in a row, the second scan would otherwise compare against the
       first one's output. */
    const raw = readGitBaseline(projectRoot, 'HEAD')
    if (raw === null) throw cliErrors.MAP_BASELINE_NOT_FOUND({ source: MAP_FILE_NAME })
    return { map: parseMapFile(raw, 'git:HEAD'), source: { kind: 'git', label: 'git:HEAD' } }
  }
}

function checkIds(route: RouteEntry): CheckId[] {
  return Object.keys(route.checks) as CheckId[]
}

/**
 * Each baseline entry point with the one it is now.
 *
 * By id first. An id gains or loses its file when another entry point starts
 * or stops sharing the method and path, so what the ids leave unpaired is
 * paired by method, path and file. One that also moved file is paired with
 * the lowest-scoring entry point left with its method and path: nothing says
 * which of them it became, and the gate would rather fail a move than pass a
 * regression.
 */
function pairRoutes(baseline: readonly RouteEntry[], current: readonly RouteEntry[]): Map<RouteEntry, RouteEntry> {
  const currentById = new Map(current.map(route => [route.id, route]))
  const pairs = new Map<RouteEntry, RouteEntry>()
  for (const before of baseline) {
    const after = currentById.get(before.id)
    if (after) pairs.set(before, after)
  }

  const paired = new Set(pairs.values())
  const unpaired = new Set(current.filter(route => !paired.has(route)))
  const pairLowest = (matches: (before: RouteEntry, route: RouteEntry) => boolean) => {
    for (const before of baseline) {
      if (pairs.has(before)) continue
      const [after] = [...unpaired].filter(route => matches(before, route)).sort((a, b) => a.score - b.score)
      if (!after) continue
      pairs.set(before, after)
      unpaired.delete(after)
    }
  }
  pairLowest((before, route) => route.file === before.file && routeKey(route) === routeKey(before))
  pairLowest((before, route) => routeKey(route) === routeKey(before))
  return pairs
}

/**
 * Compare a fresh scan against a baseline, per entry point and per check.
 *
 * The unit is the requirement, not the score: a refactor that instruments one
 * route and breaks another leaves the number untouched. A deleted route is not
 * a regression, and a new dark one is reported but does not gate — that bar is
 * `--min-score`'s job.
 */
export function compareToBaseline(baseline: MapFile, current: MapFile, source: BaselineSource): BaselineComparison {
  const pairs = pairRoutes(baseline.routes, current.routes)
  const paired = new Set(pairs.values())

  const regressions: CheckRegression[] = []
  const fixed: CheckFix[] = []
  const removed: { path: string, method: string | null }[] = []

  for (const before of baseline.routes) {
    const after = pairs.get(before)
    if (!after) {
      removed.push({ path: before.path, method: before.method })
      continue
    }

    for (const id of checkIds(before)) {
      const was = before.checks[id]
      const now = after.checks[id]
      if (!was || !now) continue

      const entry = { routeId: after.id, path: after.path, method: after.method, file: after.file, check: id }

      if (was.status === 'pass' && now.status === 'fail') {
        regressions.push({ ...entry, to: 'fail' })
      } else if (was.status === 'pass' && now.status === 'n/a' && now.suppressed) {
        regressions.push({ ...entry, to: 'suppressed' })
      } else if (was.status === 'fail' && now.status === 'pass') {
        fixed.push(entry)
      }
    }
  }

  const added: AddedRoute[] = current.routes
    .filter(route => !paired.has(route))
    .map(route => ({
      path: route.path,
      method: route.method,
      file: route.file,
      // The scan's own classifier, so an exempt route stays exempt here.
      dark: classifyRouteObservability(route) === 'dark',
    }))

  const carried = current.routes.filter(route => paired.has(route))
  const carriedBefore = baseline.routes.filter(route => pairs.has(route))

  return {
    source,
    baselineScore: baseline.score,
    score: current.score,
    delta: scoreGlobal(carried) - scoreGlobal(carriedBefore),
    totalDelta: current.score - baseline.score,
    regressions,
    fixed,
    added,
    removed,
  }
}

/** Whether the comparison should fail the command (exit 1). */
export function hasRegressed(comparison: BaselineComparison): boolean {
  return comparison.regressions.length > 0 || comparison.delta < 0
}

/**
 * Whether a committed baseline is comparable to the running CLI.
 *
 * Returns `'unknown'` (the caller warns rather than fails) when the map
 * predates version reporting, and throws a usage error when the rule set moved
 * underneath the committed file. Same reasoning as a malformed `--min-score`:
 * a gate that reports a regression it cannot justify is worse than one that
 * admits it cannot run.
 */
export type BaselineVersionStatus = 'ok' | 'unknown'

export function checkBaselineVersion(baseline: Pick<MapFile, 'cliVersion' | 'ruleSetVersion'>): BaselineVersionStatus {
  if (baseline.ruleSetVersion === undefined) return 'unknown'
  if (baseline.ruleSetVersion === RULE_SET_VERSION) return 'ok'
  throw cliErrors.MAP_BASELINE_VERSION_MISMATCH({
    baselineCli: baseline.cliVersion ?? 'unknown',
    runningCli: CLI_VERSION,
    baselineRuleSet: baseline.ruleSetVersion,
    runningRuleSet: RULE_SET_VERSION,
  })
}
