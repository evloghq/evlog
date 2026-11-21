import type { WideEvent } from 'evlog'

/*
 * Reads wide events back from a Vercel project's runtime logs, where evlog
 * prints one JSON line per event. A source of the `evlog logs` engine, with no
 * dependency: the caller brings the token. Internal, like logs-query.
 */

/** The team, project and environment every read is pinned to. */
export interface VercelScope {
  teamId: string
  projectId: string
  environment: 'production' | 'preview'
}

function claimsOf(jwt: string): Record<string, unknown> | undefined {
  const [, payload] = jwt.split('.')
  if (!payload) return undefined
  try {
    const claims = JSON.parse(atob(payload.replaceAll('-', '+').replaceAll('_', '/'))) as unknown
    return typeof claims === 'object' && claims !== null ? claims as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

/**
 * The scope of a Vercel OIDC token, from its `owner_id`, `project_id` and
 * `environment` claims. Reads take it from the token and never from the
 * caller's input, so a query cannot reach another project. A development
 * token, which `vercel link` gives a local run, reads production: development
 * runs leave no runtime logs on Vercel.
 */
export function vercelScope(oidcToken: string): VercelScope | undefined {
  const claims = claimsOf(oidcToken)
  const { owner_id: teamId, project_id: projectId, environment } = claims ?? {}
  if (typeof teamId !== 'string' || typeof projectId !== 'string') return undefined
  return { teamId, projectId, environment: environment === 'preview' ? 'preview' : 'production' }
}

/** Vercel refused a request: the status and its message. */
export class VercelReadError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'VercelReadError'
  }
}

export interface VercelLogsRead {
  /** A Vercel API token, such as one Vercel Connect issues. */
  token: string
  scope: VercelScope
  since: Date
  until: Date
  /** A whole word Vercel matches before anything is parsed, such as a session id; anything else is ignored. */
  search?: string
  /** Most log lines to read; the newest come first. */
  maxLines: number
  fetchFn?: typeof fetch
}

export interface VercelLogsSummary {
  lines: number
  /** Lines Vercel cut to its size limit, which no longer parse as an event. */
  truncated: number
  /** Whether lines older than the last one read were left. */
  more: boolean
}

/**
 * A token from a Vercel Connect connector, asked for with a project's OIDC
 * token. Connect only issues it to a project the connector is attached to. This
 * is the request `getToken` from `@vercel/connect` sends, without that
 * package's framework peers.
 */
export async function requestConnectToken(oidcToken: string, connector: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const response = await fetchFn(`https://api.vercel.com/v1/connect/token/${encodeURIComponent(connector)}`, {
    method: 'POST',
    headers: { 'accept': 'application/json', 'content-type': 'application/json', 'authorization': `Bearer ${oidcToken}` },
    body: JSON.stringify({ subject: { type: 'app' }, scopes: ['*'] }),
  })
  if (!response.ok) throw new VercelReadError(response.status, (await response.text()).slice(0, 300))
  return (await response.json() as { token: string }).token
}

const PAGE_SIZE = 1000

function parseEvent(line: string): WideEvent | undefined {
  if (!line.startsWith('{')) return undefined
  try {
    const event = JSON.parse(line) as Record<string, unknown>
    return typeof event.timestamp === 'string' && typeof event.level === 'string' ? event as unknown as WideEvent : undefined
  } catch {
    return undefined
  }
}

/**
 * The events among a project's runtime log lines, newest first, through
 * Vercel's observability API, which `vercel logs` also reads. Lines that are
 * not evlog events are skipped; the summary counts the ones Vercel cut.
 */
export async function* readVercelLogs(read: VercelLogsRead): AsyncGenerator<WideEvent, VercelLogsSummary> {
  const fetchFn = read.fetchFn ?? fetch
  const { teamId, projectId, environment } = read.scope
  /* Vercel matches a bare term against whole words and rejects quoted phrases. */
  const search = read.search && /^[\w-]+$/.test(read.search) ? [read.search] : []
  const filter = [`environment:"${environment}"`, ...search].join(' AND ')
  let cursor: string | undefined
  let lines = 0
  let truncated = 0
  for (;;) {
    const limit = Math.min(PAGE_SIZE, read.maxLines - lines)
    const response = await fetchFn(`https://api.vercel.com/v1/observability/events?teamId=${encodeURIComponent(teamId)}`, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${read.token}`,
        'content-type': 'application/json',
        'x-vercel-observability-query-reason': 'evlog/logs',
      },
      body: JSON.stringify({
        event: 'vercel.log',
        scope: { ownerId: teamId, projectIds: [projectId] },
        timeRange: { start: read.since.toISOString(), end: read.until.toISOString() },
        select: ['message', 'truncated'],
        order: 'desc',
        limit,
        filter,
        ...(cursor && { cursor }),
      }),
    })
    if (!response.ok) throw new VercelReadError(response.status, (await response.text()).slice(0, 500))
    const page = await response.json() as {
      events: Array<{ message?: unknown, truncated?: unknown }>
      pagination: { hasMore: boolean, nextCursor: string | null }
    }
    for (const record of page.events) {
      lines += 1
      if (record.truncated === true) {
        truncated += 1
        continue
      }
      if (typeof record.message !== 'string') continue
      for (const line of record.message.split('\n')) {
        const event = parseEvent(line.trim())
        if (event) yield event
      }
    }
    const { hasMore, nextCursor } = page.pagination
    if (!hasMore || !nextCursor || nextCursor === cursor) return { lines, truncated, more: false }
    if (lines >= read.maxLines) return { lines, truncated, more: true }
    cursor = nextCursor
  }
}
