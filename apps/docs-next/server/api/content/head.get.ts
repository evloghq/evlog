/**
 * The commit SHA production content is pinned to, or `null` in dev.
 */
export default defineEventHandler(async () => {
  if (import.meta.dev) return { sha: null }

  // Same resolution as the pages (`getProdContent`), so the search artifacts the client hydrates
  // from can't come from a different commit than the rendered content — notably under a pin.
  return { sha: await resolveProdSha() }
})
