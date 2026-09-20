import { channelName } from './channel'
import { environment } from './environment'

/**
 * Routing shared by every gateway call. Schedule turns answer to nobody in
 * real time, so they sort on cost; every other surface has someone waiting and
 * sorts on time to first token. `zeroDataRetention` prunes the pool before the
 * sort sees it — on this model it drops the cheapest deployments, which keep
 * data — and the sort picks from the rest. Naming providers by hand pins that
 * choice to a list that rots as deployments, prices and health move.
 */
export function gatewayRouting(unattended = false) {
  return {
    caching: 'auto',
    sort: unattended ? 'cost' : 'ttft',
    zeroDataRetention: true,
  } as const
}

/**
 * Tags stamped on every gateway request. One tag per dimension, not a compound
 * string: the spend report groups by a single dimension at a time. The
 * reasoning tag names the routing decision for the turn (`low`, `medium`,
 * `high`, or `fallback` when the evaluator could not answer), so the spend
 * report can split routine turns from heavy ones. Absent when routing is off.
 */
export function sessionTags(kind?: string, reasoning?: string): string[] {
  const tags = [`evi:env:${environment()}`, `evi:surface:${channelName(kind)}`]
  if (reasoning) tags.push(`evi:reasoning:${reasoning}`)
  return tags
}

/** The Evi attribution tag for the environment this agent runs in. */
export function defaultReportTag(): string {
  return `evi:env:${environment()}`
}

/**
 * Comma-separated tags from env, or the attribution tag. Never empty: an
 * empty `tags` param on the Custom Reporting call is not "no match", it is
 * "no filter" — the account-wide totals this scoping exists to prevent.
 */
export function defaultReportTags(): string[] {
  const raw = process.env.AI_GATEWAY_REPORT_TAGS?.trim()
  const fallback = [defaultReportTag()]
  if (!raw) return fallback
  const tags = raw.split(',').map((tag) => tag.trim()).filter(Boolean)
  return tags.length ? tags : fallback
}

/** The dedicated Evi key that scopes historical, pre-tagging spend. */
export function reportApiKeyName(): string | undefined {
  return process.env.AI_GATEWAY_REPORT_API_KEY_NAME?.trim() || undefined
}

/** The caller-supplied part of a spend-report request. */
export interface ReportQueryInput {
  groupBy?: string
  tags?: string[]
  tagsMatch?: 'any' | 'all'
}

/** The resolved Custom Reporting query, one of two scoping modes. */
export interface ReportQuery {
  groupBy: string
  tags: string[] | undefined
  tagsMatch: 'any' | 'all' | undefined
  /** Set when key-name scoping applies; the rows are then filtered to this key. */
  keyName: string | undefined
}

/**
 * How a spend report is scoped to Evi. Key-name scope covers historical
 * untagged traffic on a dedicated key, but it spends the single `group_by`
 * slot on `api_key_name` to do it, so an explicit `groupBy` wins and falls
 * back to tag scoping — otherwise a digest asking for `tag` would quietly get
 * key-name rows instead.
 */
export function reportQuery(input: ReportQueryInput): ReportQuery {
  const keyName = input.groupBy ? undefined : reportApiKeyName()
  const tags = keyName ? undefined : (input.tags?.length ? input.tags : defaultReportTags())
  return {
    groupBy: keyName ? 'api_key_name' : (input.groupBy ?? 'model'),
    tags,
    tagsMatch: tags ? (input.tagsMatch ?? 'all') : undefined,
    keyName,
  }
}

type ReportRow = Record<string, unknown> & { api_key_name?: string }

function reportRows(payload: unknown): ReportRow[] {
  return payload && typeof payload === 'object' && Array.isArray((payload as { results?: unknown }).results)
    ? (payload as { results: ReportRow[] }).results
    : []
}

/**
 * The rows the caller may quote, with a scope receipt naming how they were
 * filtered. Notes are worded for the model: they forbid falling back to
 * account-wide totals, which the raw Custom Reporting payload always is.
 */
export function scopedReport(payload: unknown, query: ReportQuery) {
  const { groupBy, tags, tagsMatch, keyName } = query
  if (keyName) {
    const needle = keyName.toLowerCase()
    const results = reportRows(payload).filter(
      (row) => typeof row.api_key_name === 'string' && row.api_key_name.toLowerCase() === needle,
    )
    const note = results.length === 0
      ? `No rows matched AI_GATEWAY_REPORT_API_KEY_NAME="${keyName}". Do not quote account-wide totals.`
      : `Filtered to API key "${keyName}" only.`
    return {
      results,
      scope: {
        mode: 'api_key_name' as const,
        apiKeyName: keyName,
        matchedRows: results.length,
        groupBy,
        note: `${note} Custom Reporting is account-wide; empty results mean no attributable Evi spend, do not invent or fall back to team totals.`,
      },
    }
  }
  const results = reportRows(payload)
  const configuredKeyName = reportApiKeyName()
  return {
    results,
    scope: {
      mode: 'tags' as const,
      tags,
      tagsMatch,
      groupBy,
      matchedRows: results.length,
      note: configuredKeyName
        ? `Scoped by tags, not by API key "${configuredKeyName}", because groupBy="${groupBy}" was requested and key-name scoping needs the grouping for itself. Spend predating tagging is out of scope here; omit groupBy for the full historical figure. Do not fall back to account-wide totals.`
        : 'Scoped by tags only. Empty results usually mean traffic predates evi:env tagging (or set AI_GATEWAY_REPORT_API_KEY_NAME). Do not fall back to account-wide totals.',
    },
  }
}
