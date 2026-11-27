import { createContentClient } from 'comark-content/client'
import type { ContentClient } from 'comark-content/client'
import { withLeadingSlash } from 'ufo'

export interface DocsActiveContent {
  /** `prod` is this app's own content; `version` a mounted older release (`/v2`). */
  mode: 'prod' | 'version'
  /** The branch a mounted version follows; `undefined` in prod. */
  ref?: string
  /** Vue Router prefix of the content (`/v2`, or `''` in prod). */
  routeBase: string
  /** Prefix of the content's data endpoints. */
  apiBase: string
  /** The path within the content (with leading slash). */
  path: string
  client: ContentClient<string>
}

const clients = new Map<string, ContentClient<string>>()

function clientFor(basePath: string): ContentClient<string> {
  let client = clients.get(basePath)
  if (!client) {
    client = createContentClient({ basePath, fetch: $fetch })
    clients.set(basePath, client)
  }
  return client
}

/** This app's own content, which the landing reads whatever version the route is in. */
export const prodContent = clientFor('/api/content')

/**
 * The content behind the current route. A mounted version has no route of its own: `/v2/<path>`
 * matches the docs catch-all, and is read from that version's endpoints.
 */
export function useDocsContent(): ComputedRef<DocsActiveContent> {
  const route = useRoute()
  const versions = configuredVersions()

  return computed<DocsActiveContent>(() => {
    const { slug } = route.params
    const path = withLeadingSlash(Array.isArray(slug) ? slug.join('/') : (slug as string | undefined))
    const mounted = splitVersionPath(path, versions)
    if (!mounted) return { mode: 'prod', routeBase: '', apiBase: '/api/content', path, client: prodContent }

    const routeBase = `/${mounted.version.id}`
    const apiBase = `/api/content${routeBase}`
    return { mode: 'version', ref: mounted.version.branch, routeBase, apiBase, path: mounted.path, client: clientFor(apiBase) }
  })
}
