<script setup lang="ts">
useHead({ title: 'evlog telemetry' })

const { clear } = useUserSession()
const authRequired = useAuthRequired()
const route = useRoute()
const router = useRouter()

// Nuxt UI's <USelect> reserves the empty string for "cleared" — using it as a
// real option's value trips a Reka UI invariant, so use a sentinel instead.
const ALL = '__all__'

const VALID_RANGES: StatsRange[] = ['24h', '7d', '30d']
const VALID_SORTS: RunSortKey[] = ['timestamp', 'tool', 'command', 'environment', 'outcome', 'durationMs', 'machineId']
const PAGE_SIZE = 25

type Tab = 'overview' | 'performance' | 'adoption' | 'explorer'

const TABS: { value: Tab, label: string, icon: string }[] = [
  { value: 'overview', label: 'Overview', icon: 'i-nucleo-gauge' },
  { value: 'performance', label: 'Performance', icon: 'i-nucleo-dial' },
  { value: 'adoption', label: 'Adoption', icon: 'i-nucleo-rocket' },
  { value: 'explorer', label: 'Explorer', icon: 'i-nucleo-layers' },
]

function queryString(key: string): string | undefined {
  const value = route.query[key]
  return typeof value === 'string' ? value : undefined
}

function queryNumber(key: string, fallback: number): number {
  const n = Number(queryString(key))
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback
}

// All filter/sort/pagination/detail state lives in the URL — shareable links,
// working back/forward, and a reload always reproduces the same view.
const tab = ref<Tab>(TABS.some(t => t.value === queryString('tab')) ? queryString('tab') as Tab : 'overview')
const range = ref<StatsRange>((VALID_RANGES as string[]).includes(queryString('range') ?? '') ? queryString('range') as StatsRange : '7d')
const tool = ref(queryString('tool') ?? ALL)
const environment = ref(queryString('environment') ?? ALL)
// Held as its URL token rather than a `SourceRef`, so the select, the URL and
// the card's selected state all compare with `===`.
const source = ref(queryString('source') ?? ALL)
const sort = ref<RunSortKey>((VALID_SORTS as string[]).includes(queryString('sort') ?? '') ? queryString('sort') as RunSortKey : 'timestamp')
const order = ref<SortOrder>(queryString('order') === 'asc' ? 'asc' : 'desc')
const page = ref(queryNumber('page', 1))
const selectedRunId = ref<number | null>(queryNumber('run', 0) || null)

const urlQuery = computed(() => {
  const query: Record<string, string> = {}
  if (tab.value !== 'overview') query.tab = tab.value
  if (range.value !== '7d') query.range = range.value
  if (tool.value !== ALL) query.tool = tool.value
  if (environment.value !== ALL) query.environment = environment.value
  if (source.value !== ALL) query.source = source.value
  if (sort.value !== 'timestamp') query.sort = sort.value
  if (order.value !== 'desc') query.order = order.value
  if (page.value !== 1) query.page = String(page.value)
  if (selectedRunId.value) query.run = String(selectedRunId.value)
  return query
})

watch(urlQuery, query => router.replace({ query }), { flush: 'post' })

// Any filter/sort change invalidates the current page — jump back to page 1.
watch([range, tool, environment, source, sort, order], () => {
  page.value = 1
})

// Drives the "Reset filters" button — hidden when the view already matches
// the defaults, so it never appears as a no-op action.
const hasActiveFilters = computed(() =>
  range.value !== '7d'
  || tool.value !== ALL
  || environment.value !== ALL
  || source.value !== ALL
  || sort.value !== 'timestamp'
  || order.value !== 'desc',
)

/** Resets filters and sort to their defaults; the watcher above takes care of resetting `page`. Leaves the open run detail untouched. */
function resetFilters() {
  range.value = '7d'
  tool.value = ALL
  environment.value = ALL
  source.value = ALL
  sort.value = 'timestamp'
  order.value = 'desc'
}

const rangeOptions = [
  { label: 'Last 24 hours', value: '24h' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
]

const statsQuery = computed(() => ({
  range: range.value,
  tool: tool.value === ALL ? undefined : tool.value,
  environment: environment.value === ALL ? undefined : environment.value,
  source: source.value === ALL ? undefined : source.value,
}))

const statsAsync = useFetch<CursorStamped<StatsResponse>>(
  '/api/telemetry/stats',
  { query: statsQuery, watch: [statsQuery] },
)

const runsQuery = computed(() => ({
  range: range.value,
  tool: tool.value === ALL ? undefined : tool.value,
  environment: environment.value === ALL ? undefined : environment.value,
  source: source.value === ALL ? undefined : source.value,
  sort: sort.value,
  order: order.value,
  page: page.value,
  pageSize: PAGE_SIZE,
}))

// The runs page and the adoption aggregates are the two most expensive reads
// in the app and each backs a single tab, so they're only fetched while that
// tab is on screen. `immediate` follows the tab the page *loads* on, so a
// deep link to `?tab=explorer` still server-renders with its data.
const explorerActive = computed(() => tab.value === 'explorer')
const adoptionActive = computed(() => tab.value === 'adoption')

const runsAsync = useFetch<RunsResponse>(
  '/api/telemetry/runs',
  { query: runsQuery, watch: false, immediate: explorerActive.value },
)

const adoptionAsync = useFetch<CursorStamped<AdoptionResponse>>(
  '/api/telemetry/adoption',
  { query: statsQuery, watch: false, immediate: adoptionActive.value },
)

watch([explorerActive, runsQuery], () => {
  if (explorerActive.value) runsAsync.refresh()
})

watch([adoptionActive, statsQuery], () => {
  if (adoptionActive.value) adoptionAsync.refresh()
})

// Dedicated newest-first page for the live feed — independent from the main
// table's sort/pagination so sorting by duration doesn't scramble the ticker.
// `withTotal: false` skips the range-wide `count(*)`: the ticker shows 8 rows
// and no pagination, so the number would be computed and thrown away.
const feedQuery = computed(() => ({
  range: range.value,
  tool: tool.value === ALL ? undefined : tool.value,
  environment: environment.value === ALL ? undefined : environment.value,
  source: source.value === ALL ? undefined : source.value,
  sort: 'timestamp',
  order: 'desc',
  page: 1,
  pageSize: 8,
  withTotal: 'false',
}))

const feedAsync = useFetch<RunsResponse>(
  '/api/telemetry/runs',
  { query: feedQuery, watch: [feedQuery] },
)

// The fetches above are deliberately started before this line and awaited
// together: `await useFetch(...)` several times in a row would only begin
// each request once the previous had come back, serialising the database
// round trips into the server-rendered response. The tab-scoped ones resolve
// immediately when their tab isn't the one being loaded.
await Promise.all([statsAsync, runsAsync, feedAsync, adoptionAsync])

const { data: stats, error: statsError, refresh: refreshStats } = statsAsync
const { data: runsData, error: runsError, status: runsStatus, refresh: refreshRuns } = runsAsync
const { data: feedData, error: feedError, refresh: refreshFeed } = feedAsync
const { data: adoption, status: adoptionStatus, refresh: refreshAdoption } = adoptionAsync

const runs = computed(() => runsData.value?.runs ?? [])
const runsTotal = computed(() => runsData.value?.total ?? 0)
const feedRuns = computed(() => feedData.value?.runs ?? [])

/**
 * Filter options are read off the stats response, which is itself filtered —
 * so the moment you pick a source, that response contains only that source and
 * the list collapses to the one value you already chose. There is then no way
 * back to the others without clearing the filter first.
 *
 * Each list is therefore remembered from the last response where its own
 * dimension was unconstrained. Picking a tool still narrows environments and
 * sources (those are genuinely the ones left), but never narrows the list you
 * are choosing from.
 */
function useUnfilteredSlice<T>(
  dimension: keyof AppliedFilter,
  read: (response: StatsResponse) => T[],
) {
  const remembered = ref<T[]>([]) as Ref<T[]>

  watchEffect(() => {
    const response = stats.value
    if (!response) return

    // The test is on the *response's* filter, not on the current one. Clearing
    // a filter updates the ref immediately while `data` still holds the
    // previous, filtered response — reading that would repopulate the panel
    // with the narrowed distribution, then correct itself when the real
    // response lands. That double update is exactly the flicker you get on
    // deselect.
    const applied = response.filter[dimension] !== undefined

    // Seeding on the first response matters for deep links: arriving on
    // `?source=agent:cursor` means the dimension is never unconstrained, so
    // without this the panel would open empty and stay that way.
    if (!applied || remembered.value.length === 0) {
      remembered.value = read(response)
    }
  })

  return remembered
}

/**
 * The Sources and Environments panels read from these rather than from the
 * live response, for the same reason and one more: filtering to a source makes
 * the response contain only that source, so the panel would collapse from
 * eight rows to one. Everything below it jumps up and the scroll position goes
 * with it.
 *
 * Showing the full distribution also makes the panel a better control — you
 * can pivot straight from one source to another instead of having to clear the
 * filter to see what the others were.
 */
const unfilteredSources = useUnfilteredSlice('source', s => s.sources)
const unfilteredEnvironments = useUnfilteredSlice('environment', s => s.environments)
const allTools = useUnfilteredSlice('tool', s => s.tools.map(t => ({ label: t.tool, value: t.tool })))

const toolOptions = computed(() => [{ label: 'All tools', value: ALL }, ...allTools.value])
const environmentOptions = computed(() => [
  { label: 'All environments', value: ALL },
  ...unfilteredEnvironments.value.map(e => ({ label: e.environment, value: e.environment })),
])
const sourceOptions = computed(() => [
  { label: 'All sources', value: ALL },
  ...unfilteredSources.value.map(item => ({
    label: sourceLabel(item),
    value: sourceToken(item),
    icon: sourceIcon(item),
  })),
])

/** The active source as a `SourceRef`, for `SourcesCard`'s selected row. */
const activeSource = computed(() => (source.value === ALL ? undefined : parseSourceToken(source.value)))

function onSourceSelect(next: SourceRef | undefined) {
  source.value = next ? sourceToken(next) : ALL
}

/** Applies a value picked from a run's right-click menu to the page filters. */
function onRowFilter({ field, value }: { field: 'tool' | 'environment', value: string }) {
  if (field === 'tool') tool.value = value
  else environment.value = value
}

function onSortChange({ sort: nextSort, order: nextOrder }: { sort: RunSortKey, order: SortOrder }) {
  sort.value = nextSort
  order.value = nextOrder
}

const paletteOpen = ref(false)
const helpOpen = ref(false)

/**
 * Keys for the things the toolbar already does, so a view you reach a hundred
 * times a day does not cost four clicks. The list the `?` sheet renders comes
 * back from the same call that binds them.
 */
const { groups: shortcutGroups } = useDashboardShortcuts({
  goToTab: (value: string) => {
    if (TABS.some(entry => entry.value === value)) tab.value = value as Tab
  },
  setRange: (value: string) => {
    if ((VALID_RANGES as string[]).includes(value)) range.value = value as StatsRange
  },
  resetFilters,
  toggleHelp: () => {
    helpOpen.value = !helpOpen.value
  },
})

const detailOpen = ref(false)
const runDetail = ref<RunDetail | null>(null)
const runDetailLoading = ref(false)

async function openRunDetail(id: number) {
  selectedRunId.value = id
  detailOpen.value = true
  runDetailLoading.value = true
  runDetail.value = null
  try {
    runDetail.value = await $fetch<RunDetail>(`/api/telemetry/runs/${id}`)
  } catch {
    runDetail.value = null
  } finally {
    runDetailLoading.value = false
  }
}

function closeRunDetail() {
  detailOpen.value = false
  selectedRunId.value = null
}

// Deep-linked run (`?run=123`) — reopen the slide-over without blocking the
// page's own stats/runs fetch above.
if (selectedRunId.value) {
  openRunDetail(selectedRunId.value)
}

const totals = computed(() => stats.value?.totals ?? { total: 0, success: 0, errors: 0, machines: 0, avgDurationMs: 0 })
const previous = computed(() => stats.value?.previous ?? { total: 0, success: 0, errors: 0, machines: 0, avgDurationMs: 0, p95DurationMs: 0 })
const timeline = computed(() => stats.value?.timeline ?? [])
const granularity = computed(() => stats.value?.granularity ?? 'day')

const successRate = computed(() => Math.round(percentageOf(totals.value.success, totals.value.total)))
const errorRate = computed(() => Math.round(percentageOf(totals.value.errors, totals.value.total)))
const p95DurationMs = computed(() => stats.value?.durations.p95 ?? 0)

// Success/error rates are already percentages, so their cards move in
// percentage *points* — a jump from 2% to 4% is "+2pt", not "+100%".
const previousSuccessRate = computed(() => percentageOf(previous.value.success, previous.value.total))
const previousErrorRate = computed(() => percentageOf(previous.value.errors, previous.value.total))

/** Per-bucket series behind each KPI card's sparkline, all read off the one timeline. */
const series = computed(() => ({
  runs: timeline.value.map(point => point.success + point.errors),
  successRate: timeline.value.map(point => percentageOf(point.success, point.success + point.errors)),
  errorRate: timeline.value.map(point => percentageOf(point.errors, point.success + point.errors)),
  machines: timeline.value.map(point => point.machines),
  avgDuration: timeline.value.map(point => point.avgDurationMs),
  p95Duration: timeline.value.map(point => point.p95DurationMs),
}))

// Live refresh, in two tiers.
//
// Every tick polls `/api/telemetry/cursor` (two indexed `max()` lookups) and
// only refetches stats/feed/runs when that token moved. The stats fetch is
// ~14 aggregate queries over the whole selected window, so an unchanged
// cursor must not recompute it: a sliding window a few minutes stale is
// cheaper than pinning Neon compute awake.
//
// Cadence starts at 10s, doubles while the cursor is unchanged (capped at
// 3 min), pauses while the tab is hidden, and stops after 5 min of no
// pointer/key/scroll/focus activity so a forgotten tab lets the database
// scale to zero. Interaction or focus resets the cadence and resumes.
//
// Paused while the run detail slideover is open so a manually sorted page
// never shifts mid-read.
const CURSOR_POLL_MS = 10_000
const CURSOR_POLL_MAX_MS = 180_000
const IDLE_MS = 300_000

/** `null` until a probe has successfully refreshed payloads against a cursor. */
let lastCursorId: number | null = null

// `useFetch`'s `refresh()` resolves even on a failed request (the error lands
// in its `.error` ref instead of rejecting), so re-throw here for
// `useLiveRefresh` to notice and `LiveIndicator` to stop claiming "Live"
// while requests are actually failing.
const { active: liveActive, lastError: liveError, toggle: toggleLive } = useLiveRefresh(
  async () => {
    const cursor = await $fetch<RunsCursor>('/api/telemetry/cursor')
    if (!cursorRequiresRefresh(lastCursorId, cursor.latestId)) return false

    const pending: Promise<unknown>[] = [
      refreshFeed(),
      refreshStats(),
    ]
    // Both are tab-scoped: refreshing a tab nobody is looking at would pay
    // for its queries and throw the result away.
    if (explorerActive.value) pending.push(refreshRuns())
    if (adoptionActive.value) pending.push(refreshAdoption())

    await Promise.all(pending)
    const error = statsError.value ?? runsError.value ?? feedError.value
    if (error) throw error
    // Commit only after the payloads succeed, and only as far as the memoized
    // ones reflect: either gap must retry on the next tick, not look like an
    // unchanged cursor.
    lastCursorId = reflectedCursor(cursor.latestId, adoptionActive.value ? [stats.value, adoption.value] : [stats.value])
    return true
  },
  { intervalMs: CURSOR_POLL_MS, maxIntervalMs: CURSOR_POLL_MAX_MS, idleMs: IDLE_MS, suspended: detailOpen },
)

async function onLogout() {
  await $fetch('/api/logout', { method: 'POST' })
  await clear()
  await navigateTo('/login')
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-[1440px] flex-col px-4 pb-16 sm:px-6 lg:px-8">
    <header class="flex flex-wrap items-center justify-between gap-3 py-4">
      <h1 class="flex items-center gap-2.5">
        <span class="flex items-baseline gap-0.5">
          <span class="font-pixel text-lg font-normal leading-none text-highlighted">evlog</span>
          <span class="text-lg leading-none text-primary">.</span>
        </span>
        <span aria-hidden="true" class="h-3.5 w-px bg-accented" />
        <span class="text-[13px] text-muted">Telemetry</span>
      </h1>

      <div class="flex flex-wrap items-center gap-1.5">
        <LiveIndicator :live="liveActive" :has-error="!!liveError" :last-event-at="stats?.lastEventAt ?? null" @toggle="toggleLive" />
        <UButton
          variant="outline"
          color="neutral"
          size="sm"
          class="h-8 gap-2 text-muted"
          @click="paletteOpen = true"
        >
          Search
          <span class="flex items-center gap-0.5">
            <UKbd value="meta" size="sm" />
            <UKbd value="K" size="sm" />
          </span>
        </UButton>
        <McpConnectButton />
        <UColorModeButton size="sm" class="h-8" />
        <UButton
          v-if="authRequired"
          variant="ghost"
          color="neutral"
          size="sm"
          icon="i-nucleo-log-out"
          @click="onLogout"
        >
          Sign out
        </UButton>
      </div>
    </header>

    <div class="divider-y sticky top-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 bg-default/80 px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <UTabs
        v-model="tab"
        :items="TABS"
        :content="false"
        activation-mode="manual"
        color="neutral"
        variant="link"
        :ui="{ list: 'border-b-0', trigger: 'text-[13px]' }"
      />

      <div class="flex flex-wrap items-center gap-1.5">
        <USelect
          v-model="range"
          :items="rangeOptions"
          value-key="value"
          size="sm"
          variant="ghost"
          class="w-32"
        />
        <USelect
          v-model="tool"
          :items="toolOptions"
          value-key="value"
          size="sm"
          variant="ghost"
          class="w-32"
        />
        <USelect
          v-model="environment"
          :items="environmentOptions"
          value-key="value"
          size="sm"
          variant="ghost"
          class="w-36"
        />
        <USelect
          v-model="source"
          :items="sourceOptions"
          value-key="value"
          size="sm"
          variant="ghost"
          class="w-36"
        />
        <UButton
          v-if="hasActiveFilters"
          variant="ghost"
          color="neutral"
          size="sm"
          icon="i-nucleo-refresh"
          aria-label="Reset filters"
          @click="resetFilters"
        />
      </div>
    </div>

    <div
      v-if="stats?.mock"
      class="surface-raised mt-4 flex items-center gap-2 rounded-[--radius-lg] bg-muted px-3 py-2 text-xs text-muted"
    >
      <UIcon name="i-nucleo-ufo" class="size-3.5 shrink-0 text-dimmed" />
      <p>
        Sample data — nothing has been ingested yet, so these are generated events. It switches to real ones the moment your first tool posts.
      </p>
    </div>

    <div class="flex flex-col gap-4 pt-4">

      <template v-if="tab === 'overview'">
        <div class="stagger-item grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
          <StatCard
            label="Total runs"
            :value="totals.total"
            icon="i-nucleo-code-editor"
            :delta="relativeDelta(totals.total, previous.total)"
            :series="series.runs"
          />
          <StatCard
            label="Success rate"
            :value="successRate"
            suffix="%"
            icon="i-nucleo-clipboard-check"
            :delta="pointDelta(successRate, previousSuccessRate)"
            delta-unit="points"
            :series="series.successRate"
          />
          <StatCard
            label="Error rate"
            :value="errorRate"
            suffix="%"
            icon="i-nucleo-triangle-warning"
            :delta="pointDelta(errorRate, previousErrorRate)"
            delta-unit="points"
            lower-is-better
            :series="series.errorRate"
          />
          <StatCard
            label="Unique machines"
            :value="totals.machines"
            icon="i-nucleo-laptop-mobile"
            :delta="relativeDelta(totals.machines, previous.machines)"
            :series="series.machines"
          />
          <StatCard
            label="Avg duration"
            :value="totals.avgDurationMs"
            suffix="ms"
            icon="i-nucleo-dial"
            :delta="relativeDelta(totals.avgDurationMs, previous.avgDurationMs)"
            lower-is-better
            :series="series.avgDuration"
          />
          <StatCard
            label="p95 duration"
            :value="p95DurationMs"
            suffix="ms"
            icon="i-nucleo-gauge"
            :delta="relativeDelta(p95DurationMs, previous.p95DurationMs)"
            lower-is-better
            :series="series.p95Duration"
          />
        </div>

        <div class="stagger-item grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
          <div class="flex flex-col gap-4 lg:col-span-2">
            <ActivityChart :timeline :granularity :previous-runs="stats?.previousRuns ?? []" />
            <SourcesCard :sources="unfilteredSources" :active="activeSource" @select="onSourceSelect" />
          </div>

          <div class="flex flex-col gap-4">
            <LiveFeed :runs="feedRuns" @row-click="run => openRunDetail(run.id)" />
            <EnvironmentBreakdown :environments="unfilteredEnvironments" />
          </div>
        </div>
      </template>

      <!--
        Independent columns, same reasoning as Adoption below. Error codes is
        three rows tall and Durations is a plot, so pairing either into a row
        with a full-height timeline buys nothing but whitespace.

        Split evenly rather than 2/1: this tab has four plots and one table, and
        at 2/1 the narrow rail could hold only the two smallest cards while the
        wide one ran twice as long.
      -->
      <template v-else-if="tab === 'performance'">
        <div class="stagger-item grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <div class="flex flex-col gap-4">
            <LatencyChart :timeline :granularity />
            <CommandsTable :commands="stats?.commands ?? []" />
          </div>

          <div class="flex flex-col gap-4">
            <ErrorRateChart :timeline :granularity />
            <DurationHistogram :durations="stats?.durations ?? { p50: 0, p95: 0, histogram: [] }" />
            <ErrorCodesCard :error-codes="stats?.errorCodes ?? []" />
          </div>
        </div>
      </template>

      <template v-else-if="tab === 'adoption'">
        <div v-if="adoptionStatus === 'pending' && !adoption" class="py-16 text-center text-sm text-muted">
          Loading adoption data…
        </div>

        <!--
          Two columns that flow independently — NOT a row grid.

          Every panel here has its own natural height, and a row grid aligns
          pairs of them: the shorter card in each row leaves a hole as tall as
          the difference, four times down the page. Independent columns let each
          one end where its content ends, so the only gap left is the one at the
          very bottom of the shorter column.

          Which makes the assignment the real work: panels are split so the two
          columns come out roughly level, with the wide column taking the plots
          (a timeline squeezed into a third of the width stops being readable)
          and the narrow one taking the lists. Rebalance this when a panel is
          added, rather than adding a row.
        -->
        <div v-else class="stagger-item grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
          <div class="flex flex-col gap-4 lg:col-span-2">
            <FrameworkAdoptionCard
              :dimensions="adoption?.dimensions ?? []"
              :frameworks="adoption?.frameworks ?? []"
              :points="adoption?.frameworkAdoption ?? []"
              :granularity="adoption?.granularity ?? granularity"
            />
            <VersionAdoptionChart
              :versions="adoption?.versions ?? []"
              :points="adoption?.versionAdoption ?? []"
              :granularity="adoption?.granularity ?? granularity"
            />
            <MachinesChart :machines="adoption?.machines ?? []" :granularity="adoption?.granularity ?? granularity" />
            <ActivityPunchcard :cells="adoption?.punchcard ?? []" />
          </div>

          <div class="flex flex-col gap-4">
            <ScoreDistributionCard :dimensions="adoption?.dimensions ?? []" />
            <VersionsCard
              :node-versions="stats?.nodeVersions ?? []"
              :tool-versions="stats?.toolVersions ?? []"
              :os="stats?.os ?? []"
            />
            <FieldsCard
              title="Flags"
              subtitle="Flags passed on the command line, and how often each one failed"
              :fields="adoption?.flags ?? []"
              empty-label="No flags in this range."
              as-flags
            />
            <FieldsCard
              title="Custom fields"
              subtitle="Values your tools set via telemetry.set(), grouped by the command that reports them"
              :fields="adoption?.custom ?? []"
              empty-label="No custom fields in this range."
              grouped
              :max-body-height="360"
            />
          </div>
        </div>
      </template>

      <template v-else>
        <div class="stagger-item flex flex-col gap-4">
          <RunsTable
            :runs
            :loading="runsStatus === 'pending'"
            :sort
            :order
            @sort-change="onSortChange"
            @row-click="run => openRunDetail(run.id)"
            @filter="onRowFilter"
          />
          <UPagination
            v-if="runsTotal > PAGE_SIZE"
            v-model:page="page"
            :total="runsTotal"
            :items-per-page="PAGE_SIZE"
            class="self-center"
          />
        </div>
      </template>

    </div>

    <CommandPalette
      v-model:open="paletteOpen"
      :tabs="TABS"
      :ranges="rangeOptions"
      :tools="toolOptions"
      :environments="environmentOptions"
      :sources="sourceOptions"
      :current="{ tab, range, tool, environment, source }"
      @update:tab="tab = $event as Tab"
      @update:range="range = $event as StatsRange"
      @update:tool="tool = $event"
      @update:environment="environment = $event"
      @update:source="source = $event"
      @reset="resetFilters"
    />

    <ShortcutsHelp v-model:open="helpOpen" :groups="shortcutGroups" />

    <USlideover
      v-model:open="detailOpen"
      inset
      title="Run detail"
      :description="runDetail ? `${runDetail.tool} · ${runDetail.command}` : undefined"
      @update:open="(open: boolean) => { if (!open) closeRunDetail() }"
    >
      <template #body>
        <RunDetailPanel :run="runDetail" :loading="runDetailLoading" />
      </template>
    </USlideover>
  </div>
</template>
