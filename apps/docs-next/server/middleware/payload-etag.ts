/**
 * A weak ETag on `_payload.json`, so client-side navigation on prod pages (cached via `isr`) can
 * send a conditional request instead of always re-downloading the payload body.
 *
 * Vercel's edge answers `304` from a stored ISR entry once its response carries an `etag`.
 */
export default defineEventHandler(async (event) => {
  if (import.meta.dev) return

  const { pathname } = getRequestURL(event)
  if (!pathname.endsWith('/_payload.json')) return
  if (/^\/(?:tree|blob|pr)\//.test(pathname)) return

  let sha: string
  try {
    sha = await resolveProdSha()
  } catch {
    return
  }

  setResponseHeader(event, 'etag', `W/"${sha}"`)
})
