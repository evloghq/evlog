/** `GET /api/telemetry/adoption` — protected. Version rollout, machine growth, punchcard, and flag/field usage. */
export default defineEventHandler(async (event): Promise<CursorStamped<AdoptionResponse>> => {
  await requireDashboardSession(event)
  const log = useLogger(event)

  const filter = parseRunsFilter(getQuery(event))
  log.set({ query: filter })

  return getCachedAdoptionForFilter(filter)
})
