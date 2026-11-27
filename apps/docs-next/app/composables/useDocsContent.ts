import { createContentClient } from 'comark-content/client'
import { useDocsContent as usePreviewContent } from 'comark-docs/app/composables/useDocsContent'
import type { ActiveContent, ContentMode } from 'comark-docs/app/types/content'

export interface DocsActiveContent extends Omit<ActiveContent, 'mode'> {
  /** `version` is a mounted version (`/v2`); the other modes are the layer's. */
  mode: ContentMode | 'version'
}

const clients = new Map<string, ActiveContent['client']>()

function versionClient(basePath: string) {
  let client = clients.get(basePath)
  if (!client) {
    client = createContentClient({ basePath, fetch: $fetch })
    clients.set(basePath, client)
  }
  return client
}

/**
 * The layer's active content, with mounted versions on top. A mounted version has no route of its
 * own: `/v2/<path>` matches the docs catch-all, which the layer reads as a page of the app's content.
 */
export function useDocsContent(): ComputedRef<DocsActiveContent> {
  const active = usePreviewContent()
  const versions = configuredVersions()

  return computed<DocsActiveContent>(() => {
    const mounted = active.value.mode === 'prod' ? splitVersionPath(active.value.path, versions) : undefined
    if (!mounted) return active.value

    const routeBase = `/${mounted.version.id}`
    const apiBase = `/api/content${routeBase}`
    return {
      mode: 'version',
      ref: mounted.version.branch,
      routeBase,
      apiBase,
      path: mounted.path,
      client: versionClient(apiBase),
    }
  })
}
