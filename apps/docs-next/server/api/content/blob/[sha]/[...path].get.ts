/**
 * The search artifacts (`manifest.json`, the snapshot) of the commit production serves, at a URL that
 * names it, so a cached copy never mixes two commits. Any other commit is a 404.
 */
export default defineEventHandler(async (event) => {
  const sha = parseCommitSha(getRouterParam(event, 'sha') ?? '')
  const content = await getProdContent()
  if (!sha || sha !== getHeadSha()) {
    throw createError({ statusCode: 404, statusMessage: 'Not the served commit' })
  }

  const request = toWebRequest(event)
  const url = new URL(request.url)
  url.pathname = url.pathname.replace(`/blob/${sha}`, '')
  return content.handler(new Request(url, request))
})
