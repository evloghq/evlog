import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { parseError } from 'evlog'

/** The `app.onError` handler the Hono page documents, for scenarios whose page is about something else. */
export function respond(error: Error, c: Context) {
  const parsed = parseError(error)

  return c.json(
    { message: parsed.message, why: parsed.why, fix: parsed.fix, link: parsed.link },
    parsed.status as ContentfulStatusCode,
  )
}
