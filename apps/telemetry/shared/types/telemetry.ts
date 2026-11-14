/**
 * Auto-imported (via Nuxt's `shared/types/` convention) into both `app/` and
 * `server/` — no import statements needed on either side.
 */

export type StatsRange = '24h' | '7d' | '30d'

/** Columns the raw events browser can be sorted by. */
export type RunSortKey = 'timestamp' | 'tool' | 'command' | 'environment' | 'outcome' | 'durationMs' | 'machineId'

export type SortOrder = 'asc' | 'desc'

export interface EnvironmentCount {
  environment: string
  count: number
}

export interface ToolCount {
  tool: string
  count: number
}

export interface CommandStat {
  command: string
  count: number
  successRate: number
  avgDurationMs: number
  p95DurationMs: number
}

/** Bucket width of a timeline — hourly on the 24h range, daily otherwise. */
export type TimelineGranularity = 'hour' | 'day'

/**
 * One bucket of the activity timeline. Every metric the KPI cards trend on is
 * carried here, so a single grouped query backs both the activity chart and
 * every sparkline instead of one query per card.
 */
export interface ActivityPoint {
  /** `YYYY-MM-DD` (day granularity) or `YYYY-MM-DDTHH:00` (hour), UTC. */
  bucket: string
  success: number
  errors: number
  /** Distinct machines seen in this bucket. */
  machines: number
  avgDurationMs: number
  p95DurationMs: number
}

export interface StatsTotals {
  total: number
  success: number
  errors: number
  machines: number
  avgDurationMs: number
}

/**
 * Same totals over the window of equal length immediately before the current
 * one — the baseline every KPI card's delta is measured against.
 */
export interface PreviousTotals extends StatsTotals {
  p95DurationMs: number
}

/**
 * What kind of thing produced a run — see `classifySource()` in
 * `shared/utils/sources.ts` for how it's derived and why CI outranks agent.
 */
export type SourceKind = 'ci' | 'agent' | 'terminal' | 'automation'

/** One source: its kind, plus the provider/agent slug within that kind. */
export interface SourceRef {
  kind: SourceKind
  /** Provider slug (`github_actions`), agent slug (`claude-code`), or the kind itself. */
  id: string
}

/** Runs grouped by source, most frequent first. */
export interface SourceCount extends SourceRef {
  count: number
}

/** Generic `version → count` pair (Node majors, tool versions). */
export interface VersionCount {
  version: string
  count: number
}

/** Runs grouped by operating system platform — `os: null` for events from older clients. */
export interface OsCount {
  os: string | null
  count: number
}

/** Runs grouped by error code, most frequent first. */
export interface ErrorCodeStat {
  errorCode: string
  count: number
  /** ISO timestamp of the most recent occurrence. */
  lastSeen: string
}

/** One bar of the duration histogram — `bucket` is the shared label from `DURATION_BUCKETS`. */
export interface DurationBucket {
  bucket: string
  count: number
}

/** Duration percentiles plus the histogram (`DurationBucket[]`) backing `DurationHistogram`. */
export interface DurationStats {
  p50: number
  p95: number
  histogram: DurationBucket[]
}

/**
 * The filter a response was computed for, echoed back.
 *
 * Without it a client cannot tell whether the numbers in hand belong to the
 * filter it is currently showing or to the previous one — during a refetch
 * `data` still holds the old response, and anything derived from it is a lie
 * for those few hundred milliseconds.
 */
export interface AppliedFilter {
  tool?: string
  environment?: string
  /** The source as its URL token (`ci:github_actions`), or absent for all sources. */
  source?: string
}

export interface StatsResponse {
  range: StatsRange
  /** What this response was computed for — see {@link AppliedFilter}. */
  filter: AppliedFilter
  granularity: TimelineGranularity
  totals: StatsTotals
  /** Baseline for the period-over-period deltas — see {@link PreviousTotals}. */
  previous: PreviousTotals
  environments: EnvironmentCount[]
  tools: ToolCount[]
  commands: CommandStat[]
  /** Zero-filled activity buckets covering the whole range, oldest first. */
  timeline: ActivityPoint[]
  /**
   * Total runs per bucket one window earlier, aligned index-for-index with
   * `timeline` — the ghost line the activity chart draws behind the bars, so
   * the period-over-period change is visible rather than reduced to a badge.
   * All-zero when there is no prior data, in which case the chart omits it.
   */
  previousRuns: number[]
  /** Where the runs came from — CI providers, agents, terminals, automation. */
  sources: SourceCount[]
  nodeVersions: VersionCount[]
  toolVersions: VersionCount[]
  os: OsCount[]
  errorCodes: ErrorCodeStat[]
  durations: DurationStats
  /** ISO timestamp of the newest event in the current filter — `null` when empty. */
  lastEventAt: string | null
  /** `true` when this response is generated sample data (the `runs` table is empty). */
  mock: boolean
}

/**
 * One bucket of the tool-version adoption chart. `counts` is keyed by the
 * series listed in {@link AdoptionResponse.versions}, so the chart component
 * can read `point.counts[version]` directly for every stacked band.
 */
export interface VersionAdoptionPoint {
  bucket: string
  counts: Record<string, number>
}

/** Distinct machines per bucket, split by whether the dashboard had ever seen them before. */
export interface MachineActivityPoint {
  bucket: string
  /** Machines that ran at least once in this bucket. */
  active: number
  /** Subset of `active` whose very first run ever falls in this bucket. */
  new: number
}

/** One cell of the activity punchcard. `weekday` is 1 (Monday) to 7 (Sunday), `hour` is 0–23, both UTC. */
export interface PunchcardCell {
  weekday: number
  hour: number
  count: number
}

/** One observed value of a flag or custom field, with how often it accompanied a failed run. */
export interface FieldValueStat {
  value: string
  count: number
  errors: number
}

/** A flag or custom field key, with its value distribution — reads the `flags`/`custom` jsonb columns. */
export interface FieldStat {
  key: string
  count: number
  errors: number
  values: FieldValueStat[]
}

/**
 * Everything the Adoption tab needs. Split out of {@link StatsResponse}
 * because it costs five extra aggregations (two of them full jsonb scans)
 * that the other tabs never look at — so they're only paid for when that tab
 * is actually open.
 */
export interface AdoptionResponse {
  range: StatsRange
  granularity: TimelineGranularity
  /** Series names for `versionAdoption[].counts`, most used first. Rarer versions are merged into `other`. */
  versions: string[]
  versionAdoption: VersionAdoptionPoint[]
  machines: MachineActivityPoint[]
  punchcard: PunchcardCell[]
  flags: FieldStat[]
  custom: FieldStat[]
  /**
   * Custom keys promoted out of `custom` into their own panels — framework and
   * grade. Uncapped, so a dimension never loses to a busier counter.
   */
  dimensions: FieldStat[]
  /** Framework ids plotted by `frameworkAdoption`, most used first. */
  frameworks: string[]
  /** Framework mix per bucket — the distribution's movement, not just its current state. */
  frameworkAdoption: VersionAdoptionPoint[]
  /** `true` when this response is generated sample data (the `runs` table is empty). */
  mock: boolean
}

export interface RunRow {
  id: number
  tool: string
  version: string
  command: string
  durationMs: number
  outcome: 'success' | 'error'
  errorCode: string | null
  environment: string
  machineId: string | null
  timestamp: string
}

export interface RunsResponse {
  runs: RunRow[]
  /** Total rows matching the current filter (for `<UPagination>`), not just this page. */
  total: number
}

/**
 * Change token for the `runs` table, polled by the dashboard's live refresh on
 * its fast cadence so the expensive stats/runs queries only re-run once an
 * event has actually landed.
 */
export interface RunsCursor {
  /** Highest row id, or `0` when the table is empty (or serving mock data). */
  latestId: number
  /** ISO timestamp of the newest event — `null` when there is none. */
  latestAt: string | null
}

/**
 * A memoized aggregate tagged with the `runs` cursor (`max(id)`) it was
 * computed at. The server memo can serve a response that predates the latest
 * event, so a client compares this, not the probed cursor, to know what it has.
 */
export type CursorStamped<T> = T & {
  cursorId: number
}

/** Environment snapshot captured alongside a run — see `@evlog/telemetry`'s `EnvInfo`. */
export interface RunEnvInfo {
  node: string
  ci: boolean
  provider: string | null
  tty: boolean
  agent: string | null
  os: string | null
  arch: string | null
}

/** Full record for one run, including the wide-event metadata not needed by the list view. */
export interface RunDetail extends RunRow {
  idempotencyKey: string
  flags: Record<string, boolean | number | string>
  custom: Record<string, boolean | number | string>
  env: RunEnvInfo
  receivedAt: string
}
