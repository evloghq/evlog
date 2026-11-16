/** `GET /api/telemetry/stats` — protected. Aggregates for the dashboard's KPI cards and charts. */
export default defineEventHandler(async (event): Promise<CursorStamped<StatsResponse>> => {
  await requireDashboardSession(event)
  const log = useLogger(event)

  const filter = parseRunsFilter(getQuery(event))
  log.set({ query: filter })

  return getCachedStatsForFilter(filter)
})
