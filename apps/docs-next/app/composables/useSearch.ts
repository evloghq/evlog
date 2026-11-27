import type { SearchOptions, SearchResult } from 'comark-content'

// The layer's `useSearch`, copied to add the `version` target: the layer hydrates every pinned commit from
// `/api/content/blob/<sha>`, which reads the app's own content directory, not a mounted version's.

type SearchStatus = 'idle' | 'loading' | 'ready' | 'error'

const status = ref<SearchStatus>('idle')

/**
 * Hydration logging switch: `?debug=search`
 */
function searchDebug(): boolean {
  if (!import.meta.client) return false
  return new URLSearchParams(location.search).get('debug') === 'search'
}

/**
 * Client-side full-text search over the active route's content (sqlite-wasm FTS5)
 * Hydrated from the per-commit snapshot artifacts.
 */
export function useSearch() {
  const content = useDocsContent()
  const sha = inject<Ref<string | null | undefined>>('sha', ref(null))

  /** What to hydrate from, or `null` when this route has nothing searchable (yet). */
  const target = computed(() => {
    const isPreview = content.value.mode !== 'prod'
    if (sha.value) {
      return {
        sha: sha.value,
        isPreview,
        apiBase: content.value.mode === 'version' ? content.value.apiBase : `/api/content/blob/${sha.value}`,
      }
    }

    // Prod in dev mode
    if (!isPreview && import.meta.dev) {
      return {
        sha: null,
        isPreview,
        apiBase: '/api/content',
      }
    }

    return null
  })

  /**
   * Load the database for the current target.
   * No-ops if the target is unchanged.
   */
  async function warmup(): Promise<void> {
    // Not resolved yet — the `watch` below re-runs this once `sha` lands.
    if (sha.value === undefined) return

    const current = target.value

    if (!current) {
      if (content.value.mode === 'prod' && !import.meta.dev) {
        console.error('[search] prod route resolved no commit pin — search hidden')
      }
      return
    }

    status.value = 'loading'
    try {
      const debug = searchDebug()
      if (debug) console.info(`[search] warmup from ${current.apiBase} (sha ${current.sha ?? 'unpinned'})`)

      await warmupSearch({
        apiBase: current.apiBase,
        sha: current.sha,
        isPreview: current.isPreview,
        origin: location.origin,
        debug,
      })
      status.value = 'ready'
    } catch (error) {
      status.value = 'error'
      console.error('[search] could not load the search database', error)
    }
  }

  if (import.meta.client) {
    onNuxtReady(warmup)
    watch(() => target.value && `${target.value.isPreview}:${target.value.sha}`, warmup)
  }

  async function search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    return prefixSearchResults(await searchContent(query, opts), content.value.routeBase)
  }

  return {
    search,
    status: readonly(status),
    warmup,
  }
}
