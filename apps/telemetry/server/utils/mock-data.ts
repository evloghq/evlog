// Explicit import (unlike the rest of `server/utils/`) because this module's
// pure functions are unit-tested directly with plain vitest, outside Nitro's
// auto-import context.
import type { FieldValueRow } from '../../shared/utils/adoption-shape'
import { splitFieldStats, toFieldStats, toStackedSeries, toVersionAdoption } from '../../shared/utils/adoption-shape'
import { MAX_FRAMEWORK_SERIES, PROMOTED_FIELD_KEYS, frameworkSeries } from '../../shared/utils/field-dimensions'
import { DURATION_BUCKETS, durationBucketIndex, nodeMajor } from '../../shared/utils/duration-buckets'
import { emptyActivityPoint, fillTimeline, previousTimelineBucketKeys, timelineBucketKey, timelineBucketKeys, timelineGranularity } from '../../shared/utils/timeline-buckets'
import { classifySource, sourceToken } from '../../shared/utils/sources'
import { previousWindow, rangeToCutoff } from './query-filters'

const DAY_MS = 24 * 60 * 60 * 1000

interface WeightedOption {
  weight: number
}

/**
 * Versions ship over time rather than all at once, so the adoption chart has
 * a real rollout to draw: a run takes the newest version released by the time
 * it happened, with a slice of stragglers still on the one before.
 */
interface MockRelease {
  version: string
  /** How long before "now" this version shipped. */
  releasedDaysAgo: number
}

const MOCK_TOOLS: (WeightedOption & { name: string, releases: MockRelease[] })[] = [
  {
    name: 'evlog-cli',
    weight: 0.88,
    releases: [
      { version: '0.3.7', releasedDaysAgo: 60 },
      { version: '0.4.0', releasedDaysAgo: 38 },
      { version: '0.4.2', releasedDaysAgo: 17 },
      { version: '0.5.0', releasedDaysAgo: 5 },
    ],
  },
  {
    name: 'my-other-tool',
    weight: 0.12,
    releases: [
      { version: '1.1.4', releasedDaysAgo: 60 },
      { version: '1.2.0', releasedDaysAgo: 21 },
    ],
  },
]

/** Share of runs that lag one release behind the newest one available to them. */
const MOCK_STRAGGLER_RATE = 0.25

const MOCK_ENVIRONMENTS: (WeightedOption & { name: string })[] = [
  { name: 'development', weight: 0.55 },
  { name: 'preview', weight: 0.18 },
  { name: 'production', weight: 0.22 },
  { name: 'ci', weight: 0.05 },
]

const MOCK_COMMANDS = ['doctor', 'telemetry status', 'telemetry enable', 'telemetry disable']
const MOCK_ERROR_CODES = ['ENOENT', 'ETIMEDOUT', 'CONFIG_INVALID']
const MOCK_NODE_VERSIONS = ['v20.11.1', 'v22.4.0', 'v18.20.2']
const MOCK_PROVIDERS = [null, 'github_actions', 'vercel', 'netlify']
const MOCK_AGENTS = [null, null, 'cursor', 'claude-code', 'copilot', 'codex']
const MOCK_OSES: (WeightedOption & { os: string, archs: string[] })[] = [
  { os: 'darwin', archs: ['arm64', 'arm64', 'x64'], weight: 0.62 },
  { os: 'linux', archs: ['x64', 'arm64'], weight: 0.3 },
  { os: 'win32', archs: ['x64'], weight: 0.08 },
]
const MOCK_RUN_COUNT = 1400
/**
 * Twice the widest range (30d) so the 30-day view still has a full previous
 * window to compare itself against — otherwise every delta on the KPI cards
 * would read as "no baseline" on the sample data.
 */
const MOCK_DAYS_SPAN = 60
/**
 * Skews run ages toward the present (`age = rng^EXPONENT * span`), so usage
 * grows over the dataset the way a tool's actually does. Deltas then come out
 * positive instead of hovering around zero.
 */
const MOCK_AGE_SKEW = 1.7
const MOCK_SEED = 42

/**
 * Machines adopt the tool progressively — index 0 has been around since the
 * start of the dataset, the last one showed up yesterday. A run can only pick
 * a machine that already existed when it happened, which is what gives the
 * adoption chart a real new-vs-returning split instead of every machine
 * appearing on the oldest bucket.
 */
const MOCK_MACHINE_COUNT = 64
const MOCK_MACHINES = Array.from({ length: MOCK_MACHINE_COUNT }, (_, i) => ({
  id: `mock-machine-${i.toString(16).padStart(4, '0')}`,
  joinedDaysAgo: MOCK_DAYS_SPAN * (1 - i / MOCK_MACHINE_COUNT),
}))

/** Candidate flag keys — a run gets a random subset, mirroring real CLI usage. */
const MOCK_FLAG_POOL: { key: string, values: (boolean | number | string)[] }[] = [
  { key: 'verbose', values: [true, false] },
  { key: 'dryRun', values: [true, false] },
  { key: 'format', values: ['json', 'text', 'pretty'] },
]

/**
 * Candidate custom fields — a run gets a random subset, mirroring
 * `telemetry.set()` usage.
 *
 * The framework and grade keys are the ones the Adoption tab promotes into
 * their own panels, so the sample dataset has to carry them or those panels
 * demo empty. Values are repeated to weight the draw: a flat distribution
 * across four frameworks makes the chart look broken rather than sampled.
 */
const MOCK_CUSTOM_POOL: { key: string, values: (boolean | number | string)[] }[] = [
  { key: 'filesChanged', values: [1, 3, 7, 12, 28] },
  { key: 'cacheHit', values: [true, false] },
  { key: 'plan', values: ['free', 'pro', 'enterprise'] },
  { key: 'initFramework', values: ['nuxt', 'nuxt', 'nuxt', 'next', 'next', 'nitro', 'tanstack-start', 'hono'] },
  { key: 'mapFramework', values: ['nuxt', 'nuxt', 'nuxt', 'nuxt', 'next', 'next', 'nitro', 'tanstack-start', 'tanstack-start', 'hono', 'hono'] },
  { key: 'mapGrade', values: ['good', 'good', 'good', 'needs-work', 'needs-work', 'excellent', 'at-risk'] },
  /* Spread inside the bands, not just on the thresholds — the histogram exists
     to show where in a band scores actually land. */
  { key: 'mapScore', values: [94, 88, 82, 76, 74, 71, 68, 63, 55, 47, 38] },
]

/** Deterministic PRNG (mulberry32) — same seed, same dataset, every process. */
function mulberry32(seed: number) {
  let a = seed
  return function random(): number {
    a |= 0
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function weightedPick<T extends WeightedOption>(rng: () => number, items: T[]): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0)
  let roll = rng() * total
  for (const item of items) {
    roll -= item.weight
    if (roll <= 0) return item
  }
  return items[items.length - 1]!
}

function pick<T>(rng: () => number, items: T[]): T {
  return items[Math.floor(rng() * items.length)]!
}

/** Picks a random subset (0-`pool.length`) of key/value pairs from a pool, deterministically. */
function pickFields(rng: () => number, pool: { key: string, values: (boolean | number | string)[] }[]): Record<string, boolean | number | string> {
  const fields: Record<string, boolean | number | string> = {}
  for (const { key, values } of pool) {
    if (rng() < 0.6) fields[key] = pick(rng, values)
  }
  return fields
}

/** Newest release available `ageDays` ago, with a slice of stragglers still one version behind. */
function pickVersion(rng: () => number, releases: MockRelease[], ageDays: number): string {
  const available = releases.filter(release => release.releasedDaysAgo >= ageDays)
  const latest = available.at(-1) ?? releases[0]!
  const behind = available.at(-2)
  return behind && rng() < MOCK_STRAGGLER_RATE ? behind.version : latest.version
}

/** A machine that already existed `ageDays` ago — never one that joins later. */
function pickMachineId(rng: () => number, ageDays: number): string {
  const eligible = MOCK_MACHINES.filter(machine => machine.joinedDaysAgo >= ageDays)
  return pick(rng, eligible.length > 0 ? eligible : [MOCK_MACHINES[0]!]).id
}

/** Deterministic env snapshot for one mock run — mirrors `@evlog/telemetry`'s `EnvInfo`. */
function buildMockEnv(rng: () => number): RunEnvInfo {
  const osEntry = weightedPick(rng, MOCK_OSES)
  return {
    node: pick(rng, MOCK_NODE_VERSIONS),
    ci: rng() < 0.2,
    provider: pick(rng, MOCK_PROVIDERS),
    tty: rng() < 0.7,
    agent: pick(rng, MOCK_AGENTS),
    os: osEntry.os,
    arch: pick(rng, osEntry.archs),
  }
}

let cachedRuns: RunRow[] | undefined
let cachedDetails: Map<number, RunDetail> | undefined

/** Generates (once per process) a plausible dataset spanning the last 30 days. */
export function getMockRuns(): RunRow[] {
  ensureMockDataset()
  return cachedRuns!
}

/** Full record for one mock run (flags/custom/env) — powers the row-detail slide-over in mock mode. */
export function getMockRunDetail(id: number): RunDetail | undefined {
  ensureMockDataset()
  return cachedDetails!.get(id)
}

function ensureMockDataset(): void {
  if (cachedRuns && cachedDetails) return

  const rng = mulberry32(MOCK_SEED)
  const now = Date.now()

  const drafts = Array.from({ length: MOCK_RUN_COUNT }, () => {
    const tool = weightedPick(rng, MOCK_TOOLS)
    const environment = weightedPick(rng, MOCK_ENVIRONMENTS)
    const command = pick(rng, MOCK_COMMANDS)
    const ageDays = rng() ** MOCK_AGE_SKEW * MOCK_DAYS_SPAN
    const outcome: 'success' | 'error' = rng() < 0.92 ? 'success' : 'error'
    const durationMs = Math.round(80 + rng() * (command === 'doctor' ? 2500 : 400))

    return {
      timestampMs: now - ageDays * DAY_MS,
      tool: tool.name,
      version: pickVersion(rng, tool.releases, ageDays),
      command,
      durationMs,
      outcome,
      errorCode: outcome === 'error' ? pick(rng, MOCK_ERROR_CODES) : null,
      environment: environment.name,
      machineId: pickMachineId(rng, ageDays),
      flags: pickFields(rng, MOCK_FLAG_POOL),
      custom: pickFields(rng, MOCK_CUSTOM_POOL),
      env: buildMockEnv(rng),
    }
  })

  // Ascending by time so `id` mirrors a real `BIGSERIAL` (oldest = smallest).
  drafts.sort((a, b) => a.timestampMs - b.timestampMs)

  const rows: RunRow[] = []
  const details = new Map<number, RunDetail>()

  drafts.forEach((draft, index) => {
    const id = index + 1
    const timestamp = new Date(draft.timestampMs).toISOString()
    const row: RunRow = {
      id,
      tool: draft.tool,
      version: draft.version,
      command: draft.command,
      durationMs: draft.durationMs,
      outcome: draft.outcome,
      errorCode: draft.errorCode,
      environment: draft.environment,
      machineId: draft.machineId,
      timestamp,
    }
    rows.push(row)
    details.set(id, {
      ...row,
      idempotencyKey: `mock-${id}`,
      flags: draft.flags,
      custom: draft.custom,
      env: draft.env,
      receivedAt: timestamp,
    })
  })

  cachedRuns = rows
  cachedDetails = details
}

/** Mirrors `buildRunsWhere` — `window` overrides the range cutoff for the previous-period baseline. */
function filterMockRuns(runs: RunRow[], filter: RunsFilter, window?: { from: Date, to: Date }): RunRow[] {
  const from = (window?.from ?? rangeToCutoff(filter.range)).getTime()
  const to = window ? window.to.getTime() : Number.POSITIVE_INFINITY
  return runs.filter((run) => {
    const at = new Date(run.timestamp).getTime()
    if (at < from || at >= to) return false
    if (filter.tool && run.tool !== filter.tool) return false
    if (filter.environment && run.environment !== filter.environment) return false
    if (filter.source && sourceToken(sourceOf(run)) !== sourceToken(filter.source)) return false
    return true
  })
}

/** The source a mock run came from — reads the env block off its detail record. */
function sourceOf(run: RunRow): SourceRef {
  return classifySource(getMockRunDetail(run.id)!.env)
}

const SORT_EXTRACTORS: Record<RunSortKey, (run: RunRow) => string | number> = {
  timestamp: run => run.timestamp,
  tool: run => run.tool,
  command: run => run.command,
  environment: run => run.environment,
  outcome: run => run.outcome,
  durationMs: run => run.durationMs,
  machineId: run => run.machineId ?? '',
}

/** Mirrors `runs.get.ts`'s Drizzle `.orderBy()` — sorts a copy, doesn't mutate `runs`. */
function sortMockRuns(runs: RunRow[], sort: RunSortKey, order: SortOrder): RunRow[] {
  const extract = SORT_EXTRACTORS[sort]
  const dir = order === 'asc' ? 1 : -1
  return [...runs].sort((a, b) => {
    const av = extract(a)
    const bv = extract(b)
    if (av < bv) return -dir
    if (av > bv) return dir
    return 0
  })
}

function tallyBy<TLabel extends string>(runs: RunRow[], key: (run: RunRow) => string, label: TLabel): ({ [P in TLabel]: string } & { count: number })[] {
  const counts = new Map<string, number>()
  for (const run of runs) counts.set(key(run), (counts.get(key(run)) ?? 0) + 1)
  return [...counts.entries()]
    .map(([value, count]) => ({ [label]: value, count }) as { [P in TLabel]: string } & { count: number })
    .sort((a, b) => b.count - a.count)
}

/** Groups runs by their timeline bucket, mirroring SQL's `group by date_trunc(...)`. */
function groupByBucket(runs: RunRow[], granularity: TimelineGranularity): [string, RunRow[]][] {
  const buckets = new Map<string, RunRow[]>()
  for (const run of runs) {
    const bucket = timelineBucketKey(run.timestamp, granularity)
    const existing = buckets.get(bucket)
    if (existing) existing.push(run)
    else buckets.set(bucket, [run])
  }
  return [...buckets.entries()]
}

/** Totals over an arbitrary set of runs — the current window and its predecessor share this. */
function totalsFor(runs: RunRow[]): PreviousTotals {
  const durations = runs.map(r => r.durationMs).sort((a, b) => a - b)
  const success = runs.filter(r => r.outcome === 'success').length
  return {
    total: runs.length,
    success,
    errors: runs.length - success,
    machines: new Set(runs.map(r => r.machineId)).size,
    avgDurationMs: runs.length > 0 ? Math.round(durations.reduce((sum, d) => sum + d, 0) / runs.length) : 0,
    p95DurationMs: percentile(durations, 0.95),
  }
}

/** Mirrors `server/api/telemetry/stats.get.ts`'s SQL aggregation, in memory. */
export function computeMockStats(filter: RunsFilter): StatsResponse {
  const runs = filterMockRuns(getMockRuns(), filter)
  const previousRunRows = filterMockRuns(getMockRuns(), filter, previousWindow(filter.range))
  const previous = totalsFor(previousRunRows)

  const success = runs.filter(r => r.outcome === 'success').length
  const errors = runs.length - success
  const machines = new Set(runs.map(r => r.machineId)).size
  const avgDurationMs = runs.length > 0
    ? Math.round(runs.reduce((sum, r) => sum + r.durationMs, 0) / runs.length)
    : 0

  const environments = tallyBy(runs, r => r.environment, 'environment') as EnvironmentCount[]
  const tools = tallyBy(runs, r => r.tool, 'tool') as ToolCount[]

  const commandGroups = new Map<string, { count: number, success: number, totalDuration: number, durations: number[] }>()
  for (const run of runs) {
    const group = commandGroups.get(run.command) ?? { count: 0, success: 0, totalDuration: 0, durations: [] }
    group.count++
    if (run.outcome === 'success') group.success++
    group.totalDuration += run.durationMs
    group.durations.push(run.durationMs)
    commandGroups.set(run.command, group)
  }
  const commands: CommandStat[] = [...commandGroups.entries()]
    .map(([command, group]) => ({
      command,
      count: group.count,
      successRate: group.count > 0 ? group.success / group.count : 0,
      avgDurationMs: group.count > 0 ? Math.round(group.totalDuration / group.count) : 0,
      p95DurationMs: percentile(group.durations.sort((a, b) => a - b), 0.95),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  // Pre-fill every bucket in the range so the chart always plots a full,
  // fixed-width timeline instead of shrinking to whichever buckets have events.
  const granularity = timelineGranularity(filter.range)
  const timeline = fillTimeline(
    timelineBucketKeys(filter.range),
    groupByBucket(runs, granularity).map(([bucket, bucketRuns]) => {
      const durations = bucketRuns.map(r => r.durationMs).sort((a, b) => a - b)
      return {
        bucket,
        success: bucketRuns.filter(r => r.outcome === 'success').length,
        errors: bucketRuns.filter(r => r.outcome === 'error').length,
        machines: new Set(bucketRuns.map(r => r.machineId)).size,
        avgDurationMs: Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length),
        p95DurationMs: percentile(durations, 0.95),
      }
    }),
    emptyActivityPoint,
  )

  const previousRuns = fillTimeline(
    previousTimelineBucketKeys(filter.range),
    groupByBucket(previousRunRows, granularity).map(([bucket, bucketRuns]) => ({ bucket, count: bucketRuns.length })),
    bucket => ({ bucket, count: 0 }),
  ).map(point => point.count)

  // env-level aggregations read the full detail record (RunRow has no env block).
  const envs = runs.map(run => getMockRunDetail(run.id)!.env)

  const sourceCounts = new Map<string, SourceCount>()
  for (const env of envs) {
    const source = classifySource(env)
    const key = sourceToken(source)
    const entry = sourceCounts.get(key) ?? { ...source, count: 0 }
    entry.count++
    sourceCounts.set(key, entry)
  }
  const sources: SourceCount[] = [...sourceCounts.values()].sort((a, b) => b.count - a.count)

  const nodeCounts = new Map<string, number>()
  for (const env of envs) {
    const major = nodeMajor(env.node)
    nodeCounts.set(major, (nodeCounts.get(major) ?? 0) + 1)
  }
  const nodeVersions: VersionCount[] = [...nodeCounts.entries()]
    .map(([version, count]) => ({ version, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  const toolVersionCounts = new Map<string, number>()
  for (const run of runs) toolVersionCounts.set(run.version, (toolVersionCounts.get(run.version) ?? 0) + 1)
  const toolVersions: VersionCount[] = [...toolVersionCounts.entries()]
    .map(([version, count]) => ({ version, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  const osCounts = new Map<string | null, number>()
  for (const env of envs) osCounts.set(env.os, (osCounts.get(env.os) ?? 0) + 1)
  const os: OsCount[] = [...osCounts.entries()]
    .map(([value, count]) => ({ os: value, count }))
    .sort((a, b) => b.count - a.count)

  const errorGroups = new Map<string, { count: number, lastSeen: string }>()
  for (const run of runs) {
    if (run.outcome !== 'error' || !run.errorCode) continue
    const group = errorGroups.get(run.errorCode) ?? { count: 0, lastSeen: run.timestamp }
    group.count++
    if (run.timestamp > group.lastSeen) group.lastSeen = run.timestamp
    errorGroups.set(run.errorCode, group)
  }
  const errorCodes: ErrorCodeStat[] = [...errorGroups.entries()]
    .map(([errorCode, group]) => ({ errorCode, count: group.count, lastSeen: group.lastSeen }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  const sortedDurations = runs.map(r => r.durationMs).sort((a, b) => a - b)
  const histogramCounts = DURATION_BUCKETS.map(bucket => ({ bucket: bucket.label, count: 0 }))
  for (const duration of sortedDurations) histogramCounts[durationBucketIndex(duration)]!.count++
  const durations: DurationStats = {
    p50: percentile(sortedDurations, 0.5),
    p95: percentile(sortedDurations, 0.95),
    histogram: histogramCounts,
  }

  const lastEventAt = runs.length > 0
    ? runs.reduce((max, run) => (run.timestamp > max ? run.timestamp : max), runs[0]!.timestamp)
    : null

  return {
    range: filter.range,
    filter: {
      tool: filter.tool,
      environment: filter.environment,
      source: filter.source ? sourceToken(filter.source) : undefined,
    },
    granularity,
    totals: { total: runs.length, success, errors, machines, avgDurationMs },
    previous,
    environments,
    tools,
    commands,
    timeline,
    previousRuns,
    sources,
    nodeVersions,
    toolVersions,
    os,
    errorCodes,
    durations,
    lastEventAt,
    mock: true,
  }
}

/** Mirrors `getAdoptionForFilter()`'s SQL aggregation, in memory. */
export function computeMockAdoption(filter: RunsFilter): AdoptionResponse {
  const all = getMockRuns()
  const runs = filterMockRuns(all, filter)
  const granularity = timelineGranularity(filter.range)
  const keys = timelineBucketKeys(filter.range)
  const buckets = groupByBucket(runs, granularity)

  // First-seen is computed over the whole dataset, unfiltered, exactly like the
  // `first_seen` CTE — a machine is only new the first time it is ever seen.
  const firstSeen = new Map<string, string>()
  for (const run of all) {
    if (!run.machineId) continue
    const current = firstSeen.get(run.machineId)
    if (!current || run.timestamp < current) firstSeen.set(run.machineId, run.timestamp)
  }

  const versionRows = buckets.flatMap(([bucket, bucketRuns]) => {
    const counts = new Map<string, number>()
    for (const run of bucketRuns) counts.set(run.version, (counts.get(run.version) ?? 0) + 1)
    return [...counts.entries()].map(([version, count]) => ({ bucket, version, count }))
  })
  const { versions, points } = toVersionAdoption(versionRows, keys)

  const machines = fillTimeline(
    keys,
    buckets.map(([bucket, bucketRuns]) => {
      const seen = new Set(bucketRuns.map(run => run.machineId).filter((id): id is string => id !== null))
      const fresh = [...seen].filter(id => timelineBucketKey(firstSeen.get(id)!, granularity) === bucket)
      return { bucket, active: seen.size, new: fresh.length }
    }),
    bucket => ({ bucket, active: 0, new: 0 }),
  )

  const punchcardCells = new Map<string, PunchcardCell>()
  for (const run of runs) {
    const date = new Date(run.timestamp)
    // `getUTCDay()` is 0 (Sunday) to 6, while SQL's `isodow` is 1 (Monday) to 7.
    const weekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay()
    const hour = date.getUTCHours()
    const key = `${weekday}-${hour}`
    const cell = punchcardCells.get(key) ?? { weekday, hour, count: 0 }
    cell.count++
    punchcardCells.set(key, cell)
  }

  const customSplit = splitFieldStats(tallyFields(runs, detail => detail.custom), PROMOTED_FIELD_KEYS)

  /* Mirrors the SQL `coalesce(mapFramework, initFramework)` — a run reporting
     both counts once, under `map`'s answer. */
  const frameworkRows = buckets.flatMap(([bucket, bucketRuns]) => {
    const counts = new Map<string, number>()
    for (const run of bucketRuns) {
      const { custom } = getMockRunDetail(run.id)!
      const framework = custom.mapFramework ?? custom.initFramework
      if (typeof framework !== 'string') continue
      const series = frameworkSeries(framework)
      counts.set(series, (counts.get(series) ?? 0) + 1)
    }
    return [...counts.entries()].map(([series, count]) => ({ bucket, series, count }))
  })
  const frameworkTimeline = toStackedSeries(frameworkRows, keys, MAX_FRAMEWORK_SERIES)

  return {
    range: filter.range,
    granularity,
    versions,
    versionAdoption: points,
    machines,
    punchcard: [...punchcardCells.values()],
    flags: toFieldStats(tallyFields(runs, detail => detail.flags)),
    custom: customSplit.fields,
    dimensions: customSplit.dimensions,
    frameworks: frameworkTimeline.series,
    frameworkAdoption: frameworkTimeline.points,
    mock: true,
  }
}

/** Mirrors the `jsonb_each_text` breakdown — one row per observed key/value pair. */
function tallyFields(runs: RunRow[], select: (detail: RunDetail) => Record<string, boolean | number | string>): FieldValueRow[] {
  const rows = new Map<string, FieldValueRow>()
  for (const run of runs) {
    const detail = getMockRunDetail(run.id)!
    for (const [key, value] of Object.entries(select(detail))) {
      const mapKey = `${key} ${value}`
      const row = rows.get(mapKey) ?? { key, value: String(value), count: 0, errors: 0 }
      row.count++
      if (run.outcome === 'error') row.errors++
      rows.set(mapKey, row)
    }
  }
  return [...rows.values()]
}

/** Linear-interpolated percentile, mirroring Postgres's `percentile_cont`. Expects `sorted` ascending. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const rank = p * (sorted.length - 1)
  const low = Math.floor(rank)
  const high = Math.ceil(rank)
  const lowValue = sorted[low]!
  const highValue = sorted[high]!
  return Math.round(lowValue + (highValue - lowValue) * (rank - low))
}

export interface MockRunsPageOptions {
  sort: RunSortKey
  order: SortOrder
  page: number
  pageSize: number
}

/** Mirrors `server/api/telemetry/runs.get.ts`'s sorted, offset-paginated query, in memory. */
export function computeMockRunsPage(filter: RunsFilter, { sort, order, page, pageSize }: MockRunsPageOptions): RunsResponse {
  const filtered = sortMockRuns(filterMockRuns(getMockRuns(), filter), sort, order)
  const start = (page - 1) * pageSize

  return {
    runs: filtered.slice(start, start + pageSize),
    total: filtered.length,
  }
}
