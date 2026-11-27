/**
 * Search worker: owns the browser-standalone `comark-content` instance (sqlite-wasm FTS5).
 *
 * Hydrated from the per-commit snapshot artifacts, every mode's (prod, blob, tree, pr) served from
 * its own SHA-pinned `/api/content/blob/<sha>` URL.
 *
 * Instances are cached by SHA:
 * - Prod is always kept
 * - One preview only is kept, evicted on the next switch
 */
import { comarkContent, DEFAULT_CONTENT_NAME, readArtifact } from 'comark-content/runtime'
import sqliteWasm from 'comark-content/database/sqlite-wasm'
import snapshot from 'comark-content/sources/snapshot'
import sqliteFullTextSearch from 'comark-content/plugins/sqlite-full-text-search'
import { ofetch } from 'ofetch'
import type { CacheArtifact, SearchOptions, SearchResult } from 'comark-content/runtime'
import { describeArtifact, indexedRows, isDebug, log, logger, setDebug, since } from './internal/search-logger'

export interface SearchTarget {
  apiBase: string
  sha: string | null
  isPreview: boolean
  origin: string
  debug: boolean
}

// Shared database for the worker's lifetime
const database = sqliteWasm()

function createInstance(fetchArtifact: (path: string) => Promise<CacheArtifact>, apiBase: string, sha: string | null) {
  const content = comarkContent({
    source: snapshot(
      () => fetchArtifact(`${apiBase}/snapshot/${DEFAULT_CONTENT_NAME}.json`),
      () => fetchArtifact(`${apiBase}/manifest.json`)
    ),
    plugins: [sqliteFullTextSearch({ database })],
    logger,
  })

  return sha ? content.withRef(sha) : content
}

type SearchInstance = ReturnType<typeof createInstance>

/** Whichever instance `searchContent()` should query */
let active: SearchInstance | undefined

/** Hydrated instances by key */
const loaded = new Map<string, SearchInstance>()
/** In-flight hydrations, so concurrent warmups for one commit share a single load. */
const pending = new Map<string, Promise<SearchInstance>>()

/** Needed to avoid evicting prod */
let prodKey: string | undefined
/** Most recently requested key (for eviction) */
let currentKey = ''

function hydrate(target: SearchTarget): Promise<SearchInstance> {
  const key = target.sha ?? 'unpinned' // dev mode only
  const existing = loaded.get(key)
  if (existing) return Promise.resolve(existing)

  let promise = pending.get(key)
  if (!promise) {
    promise = loadInstance(target)
      .then((instance) => {
        loaded.set(key, instance)
        return instance
      })
      // Cleared on failure too, so the next warmup retries instead of re-awaiting this rejection.
      .finally(() => pending.delete(key))
    pending.set(key, promise)
  }
  return promise
}

/**
 * Loads (or reuses) the database for `target`, makes it active, and evicts whatever else is
 * cached — keeping prod warm and dropping any preview once navigated away from it.
 */
export async function warmupSearch(target: SearchTarget): Promise<void> {
  setDebug(target.debug)
  const key = target.sha ?? 'unpinned'
  currentKey = key
  // Claim prod's key before awaiting, so the eviction below can never clean it.
  if (!target.isPreview) prodKey = key

  const instance = await hydrate(target)
  if (currentKey !== key) return // a switch occurred, so skip the eviction

  active = instance
  for (const [staleKey, stale] of loaded) {
    if (staleKey === key || staleKey === prodKey) continue
    loaded.delete(staleKey)
    void stale.clean().catch((error) => log(`cleanup failed for ${staleKey}`, error))
  }
}

async function loadInstance(target: SearchTarget): Promise<SearchInstance> {
  const started = performance.now()
  try {
    const fetchArtifact = async (path: string): Promise<CacheArtifact> => {
      const url = new URL(path, target.origin).href
      const fetchStarted = performance.now()
      try {
        const artifact = await ofetch<CacheArtifact>(url)
        if (isDebug()) {
          let contents: string
          try {
            contents = describeArtifact(await readArtifact(artifact))
          } catch (error) {
            contents = `undecodable: ${error instanceof Error ? error.message : String(error)}`
          }
          log(`fetched ${path} in ${since(fetchStarted)} — ${artifact?.size ?? 0} bytes, ${contents}`)
        }
        return artifact
      } catch (error) {
        log(`failed ${path} after ${since(fetchStarted)}`, error)
        throw error
      }
    }

    const content = createInstance(fetchArtifact, target.apiBase, target.sha)
    await content.init()

    const indexStarted = performance.now()
    await content.search('') // pulls the snapshot in and builds the FTS index
    const rows = await indexedRows(database, content)
    log(`index built in ${since(indexStarted)} for ${target.apiBase} — ${rows} row(s)`)

    log(`ready in ${since(started)} (${target.isPreview ? 'preview' : 'prod'} ${target.sha ?? 'unpinned'})`)
    return content
  } catch (error) {
    log(`hydration failed after ${since(started)} for ${target.apiBase}`, error)
    throw error
  }
}

/** Empty until hydration lands. */
export async function searchContent(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
  if (!active) {
    log(`dropped query "${query}" — no instance yet`)
    return []
  }
  const queryStarted = performance.now()
  const results = await active.search(query, {
    limit: 25,
    snippet: { columns: ['content'] },
    ...opts,
  })
  log(`query "${query}" -> ${results.length} result(s) in ${since(queryStarted)}`)
  return results
}
