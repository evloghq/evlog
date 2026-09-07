import { EvlogError } from 'evlog'
import type { CliContext } from '../core/context'
import { EXIT_FAIL, EXIT_USAGE } from '../core/output'
import { defineEvlogCommand } from '../lib/command'
import type { CliDebug } from '../lib/debug'
import { createNoopCliDebug } from '../lib/debug'
import { cliErrors } from '../lib/errors'
import { resolveEvlog, resolveProject } from '../lib/project'
import type { ProjectInfo } from '../lib/project'
import { checkBaselineVersion, compareToBaseline, hasRegressed, loadBaseline } from '../lib/map/baseline'
import type { BaselineComparison } from '../lib/map/baseline'
import { detectFramework } from '../lib/map/detect'
import {
  findEntryPoint,
  formatBaseline,
  formatEntryPointNotFound,
  formatGate,
  formatMapInspect,
  formatMapMatrix,
  formatMapReport as formatMapReportView,
  formatMapWarnings,
} from '../lib/map/report'
import { scan } from '../lib/map/scan'
import { recordMapRun, resolveGate } from '../lib/map/telemetry'
import type { MapView } from '../lib/map/telemetry'
import type { Framework, ScanContext, ScanResult } from '../lib/map/types'
import { writeMapFile } from '../lib/map/write'

const FRAMEWORKS: readonly Framework[] = ['nuxt', 'nitro', 'next', 'tanstack-start', 'hono', 'express', 'fastify', 'elysia']

function isFramework(value: string): value is Framework {
  return (FRAMEWORKS as readonly string[]).includes(value)
}

/** Typed result of `evlog map` — rendered by {@link formatMapReport}. */
export interface MapResult {
  project: Pick<ProjectInfo, 'cwd' | 'root' | 'packageDir' | 'kind' | 'packageName'>
  framework: Framework
  frameworkWarnings: string[]
  scan: ScanResult
  /** Path `evlog.map.json` was written to, or `null` with `--no-write`. */
  mapPath: string | null
  /** Diff against the committed map, when `--baseline` was passed. */
  baseline: BaselineComparison | null
  /** Baseline problems that do not stop the run — a map that predates version reporting. */
  baselineWarnings: string[]
}

/**
 * Scan `ctx.cwd` for routes and score their wide-event coverage (monorepo-aware).
 * Pure with respect to the context except for the `evlog.map.json` write.
 */
export async function runMap(
  ctx: CliContext,
  log: CliDebug = createNoopCliDebug(),
  options: { framework?: Framework, noWrite?: boolean, verbose?: boolean, baseline?: string | true } = {},
): Promise<MapResult> {
  const project = await log.step(
    'resolveProject',
    () => resolveProject(ctx.cwd),
    p => ({
      cwd: ctx.cwd,
      project: { kind: p.kind, root: p.root, packageDir: p.packageDir, name: p.packageName },
    }),
  )

  const { framework, warnings } = await log.step(
    'detectFramework',
    () => detectFramework(project, options.framework),
    r => ({ framework: r.framework, frameworkWarnings: r.warnings }),
  )

  const resolved = await log.step(
    'resolveEvlog',
    () => resolveEvlog(project),
    r => ({ hasEvlog: !!r.install }),
  )

  const scanCtx: ScanContext = {
    projectRoot: project.packageDir,
    framework,
    projectName: project.packageName ?? 'unknown',
    hasEvlog: !!resolved.install,
    verbose: options.verbose ?? false,
  }

  /* Read before the scan writes: `writeMapFile` overwrites `evlog.map.json` in
     place, so loading the baseline afterwards would compare this run against
     itself and never report a regression. */
  const baselineMap = options.baseline
    ? await log.step(
      'loadBaseline',
      () => loadBaseline(project.packageDir, typeof options.baseline === 'string' ? options.baseline : undefined),
      r => ({ baselineSource: r.source.label, baselineScore: r.map.score }),
    )
    : null

  /* A map written before version reporting cannot prove its rule set matches
     the running one, so it gets a warning instead of a gate: hard-failing every
     project on upgrade would punish the ones that never saw the feature. */
  const baselineWarnings: string[] = []
  if (baselineMap && checkBaselineVersion(baselineMap.map) === 'unknown') {
    baselineWarnings.push(
      `the baseline ${baselineMap.source.label} predates map version reporting, so its rule set cannot be verified; regenerate it with evlog map`,
    )
  }

  const scanResult = await log.step(
    'scan',
    () => scan(scanCtx),
    r => ({ routes: r.map.routes.length, score: r.map.score, grade: r.grade }),
  )

  const baseline = baselineMap
    ? compareToBaseline(baselineMap.map, scanResult.map, baselineMap.source)
    : null

  /* A run that just reported a regression must not overwrite the file it
     compared against: doing so moves the ratchet down to the worse state, and
     the same command run a second time reports no regression and exits 0. */
  const wouldClobberBaseline = baseline !== null && hasRegressed(baseline)

  let mapPath: string | null = null
  if (!options.noWrite && !wouldClobberBaseline) {
    mapPath = await log.step('writeMapFile', () => writeMapFile(project.packageDir, scanResult.map))
  }

  log.set({ steps: ['done'] })

  return {
    project,
    framework,
    frameworkWarnings: warnings,
    scan: scanResult,
    mapPath,
    baseline,
    baselineWarnings,
  }
}

/**
 * Pick the view for the flags that were passed.
 *
 * The three views answer three different questions — "how am I doing", "show me
 * everything", "explain this one file" — so they are separate renderers rather
 * than one renderer with three modes. Rendering lives in `lib/map/report`; this
 * function only routes.
 */
export function formatMapReport(
  ctx: CliContext,
  result: MapResult,
  options: { all?: boolean, entry?: string, minScore?: number } = {},
): string {
  const sections: string[] = []

  /* Framework detection and disable-comment problems share one channel: both
     mean "the numbers below were produced under an assumption you should see",
     and both have to appear above every view rather than only the default one. */
  const warnings = [...result.frameworkWarnings, ...result.baselineWarnings, ...result.scan.warnings]
  if (warnings.length > 0) {
    sections.push(formatMapWarnings(ctx, warnings))
  }

  if (options.entry) {
    const route = findEntryPoint(result.scan, options.entry)
    sections.push(route
      ? formatMapInspect(ctx, result.scan, route)
      : formatEntryPointNotFound(ctx, result.scan, options.entry))
  } else if (options.all) {
    sections.push(formatMapMatrix(ctx, result.scan))
  } else {
    sections.push(formatMapReportView(ctx, result.scan, { mapPath: result.mapPath }))
  }

  if (result.baseline) {
    sections.push(formatBaseline(ctx, result.baseline))
  }

  if (options.minScore !== undefined) {
    sections.push(formatGate(ctx, result.scan, options.minScore))
  }

  return sections.join('\n')
}

function parseFrameworkArg(value: unknown): Framework | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  if (!isFramework(value)) {
    throw cliErrors.MAP_INVALID_FRAMEWORK({ value })
  }
  return value
}

/**
 * Read `--min-score`, rejecting anything that is not a whole 0-100.
 *
 * The whole string has to parse: `parseInt` reads `80oops` as 80 and `abc` as
 * nothing at all, and a threshold that quietly becomes `undefined` turns the
 * gate off — CI then reports success for a bar it never checked.
 */
function parseMinScoreArg(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  const threshold = Number(value)
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 100) {
    throw cliErrors.MAP_INVALID_MIN_SCORE({ value })
  }
  return threshold
}

/**
 * Read `--baseline`, which is a flag and an option at once.
 *
 * Bare (`--baseline`) means "the committed map, wherever it is"; with a value it
 * is a path or a `git:<ref>`. citty hands a bare string flag back as `true` or
 * as an empty string depending on how it was written, and both spellings mean
 * the same thing to a user.
 */
function parseBaselineArg(value: unknown): string | true | undefined {
  if (value === true) return true
  if (typeof value !== 'string') return undefined
  return value.length > 0 ? value : true
}

/**
 * `evlog map` — static observability map: Lighthouse for wide events.
 * Logic lives in {@link runMap}; this file owns the citty surface.
 */
export default defineEvlogCommand('map', {
  meta: { name: 'map', description: 'Static observability map — Lighthouse for wide events' },
  args: {
    entry: { type: 'positional', required: false, description: 'Inspect one entry point by route or file path' },
    cwd: { type: 'string', description: 'Project directory (default: current)' },
    framework: { type: 'string', description: 'Override framework detection (nuxt, nitro, next, tanstack-start, hono, express, fastify, elysia)' },
    all: { type: 'boolean', description: 'Every entry point, as a check matrix' },
    minScore: { type: 'string', description: 'Exit 1 if the global score is below this threshold' },
    baseline: {
      type: 'string',
      description: 'Compare against the committed evlog.map.json and exit 1 on regression (path, or git:<ref>)',
    },
    // `default: true` + citty's `--no-write` negation — declaring this as `noWrite`
    // directly would not work: citty's parser treats any `--no-x` flag as negating
    // `x`, not as setting `noX` (see `wantsHeader`'s `--no-header` argv fallback).
    write: { type: 'boolean', default: true, description: 'Write evlog.map.json (--no-write to skip)' },
    verbose: { type: 'boolean', description: 'Show per-file parse warnings' },
  },
  async run({ args, cli, log, ui }) {
    const cwd = typeof args.cwd === 'string' && args.cwd.length > 0 ? args.cwd : undefined
    const ctx = cwd ? { ...cli, cwd } : cli

    const entry = typeof args.entry === 'string' && args.entry.length > 0 ? args.entry : undefined
    const view: MapView = entry ? 'inspect' : args.all ? 'all' : 'summary'

    let result: MapResult
    let threshold: number | undefined
    let framework: Framework | undefined
    try {
      /* Before the scan, not after: an unusable threshold should cost nothing,
         and validating it afterwards means the command reads the whole project
         and writes evlog.map.json before admitting it cannot gate on it. */
      threshold = parseMinScoreArg(args.minScore)
      framework = parseFrameworkArg(args.framework)
      result = await runMap(ctx, log, {
        framework,
        noWrite: !args.write,
        verbose: args.verbose,
        baseline: parseBaselineArg(args.baseline),
      })
    } catch (error) {
      if (error instanceof EvlogError) {
        log.finding({ code: error.code ?? 'cli.MAP_FAILED', why: error.why, fix: error.fix, link: error.link }, { status: 'fail' })
        ui.done({
          jsonMode: args.json,
          json: { error: { code: error.code, message: error.message, why: error.why, fix: error.fix } },
          human: error.fix ? `${error.message}\n→ ${error.fix}` : error.message,
        })
        /* A baseline whose rule set does not match is a usage error, not a
           check failure: the app did not get worse, the comparison is invalid. */
        ui.exit(error.code === cliErrors.MAP_BASELINE_VERSION_MISMATCH.code ? EXIT_USAGE : EXIT_FAIL)
        return
      }
      throw error
    }

    recordMapRun({
      scan: result.scan,
      frameworkForced: framework !== undefined,
      gate: resolveGate({ minScore: threshold !== undefined, baseline: result.baseline !== null }),
      minScore: threshold,
      baseline: result.baseline,
      view,
      wrote: result.mapPath !== null,
    })

    ui.done({
      jsonMode: args.json,
      json: {
        map: result.scan.map,
        summary: result.scan.summary,
        mapPath: result.mapPath,
        ...(result.baseline ? { baseline: result.baseline } : {}),
      },
      human: formatMapReport(ctx, result, { all: args.all, entry, minScore: threshold }),
    })

    if (threshold !== undefined && result.scan.map.score < threshold) {
      ui.exit(EXIT_FAIL)
      return
    }

    if (result.baseline && hasRegressed(result.baseline)) {
      ui.exit(EXIT_FAIL)
    }
  },
})
