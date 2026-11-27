/**
 * Logging for the search worker.
 *
 * Triggered by `?debug=search` param.
 */
import type { ContentFile, Logger, RelationalDatabase } from 'comark-content/runtime'

const PREFIX = '[search:worker]'

let debug = false

/** Called on every `warmup`; once on, it stays on for the life of the worker. */
export function setDebug(value: boolean): void {
  debug = debug || value
}

export function isDebug(): boolean {
  return debug
}

export function log(...args: unknown[]): void {
  if (debug) console.info(PREFIX, ...args)
}

/** Milliseconds since `from`, for log lines. */
export function since(from: number): string {
  return `${(performance.now() - from).toFixed(1)}ms`
}

/**
 * Warn and error are deliberately ungated: the FTS plugin reports a missing snapshot through this
 * channel, and that failure is otherwise indistinguishable from "the query matched nothing".
 */
export const logger: Logger = {
  debug: (tag, ...args) => log(`${tag}:`, ...args),
  info: (tag, ...args) => log(`${tag}:`, ...args),
  warn: (tag, ...args) => console.warn(`${PREFIX} ${tag}:`, ...args),
  error: (tag, ...args) => console.error(`${PREFIX} ${tag}:`, ...args),
}

export function describeArtifact(decoded: unknown): string {
  const raw = Array.isArray(decoded) ? decoded : (decoded as { items?: unknown } | null)?.items
  if (Array.isArray(raw)) {
    const items = raw as ContentFile[]
    const documents = items.filter((item) => item.meta.kind === 'document')
    const withNodes = documents.filter((item) => item.nodes?.length)
    return `${items.length} item(s), ${documents.length} document(s), ${withNodes.length} with nodes`
  }
  return `${raw ? Object.keys(raw as Record<string, unknown>).length : 0} manifest item(s)`
}

/**
 * Mirrors the FTS plugin's `ownId` convention
 */
function sourceIdFor(content: { name: string, key: string }): string {
  return content.key ? `${content.name}@${content.key}` : content.name
}

export async function indexedRows(database: RelationalDatabase, content: { name: string, key: string }): Promise<number | string> {
  try {
    const rows = await database.all<{ n: number }>('SELECT count(*) as n FROM __fts_search WHERE source = ?', [sourceIdFor(content)])
    return rows?.[0]?.n ?? 'unknown'
  } catch (error) {
    return `unknown (${error instanceof Error ? error.message : String(error)})`
  }
}
