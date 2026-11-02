export interface PagePreview {
  title: string
  description?: string
  sections: string[]
}

const cache = new Map<string, Promise<PagePreview | undefined>>()

/**
 * Title, description and section headings of the docs page a link points to, fetched once per
 * page when a reader first hovers a link to it. Links into another version or off-site return undefined.
 */
export function usePagePreview(href: MaybeRefOrGetter<string | undefined>) {
  const content = useDocsContent()
  const preview = shallowRef<PagePreview>()

  const target = computed(() => {
    const value = toValue(href)
    if (!value?.startsWith('/') || value.startsWith('//')) return undefined
    const base = content.value.routeBase
    const path = value.split('#')[0]!.replace(/\/$/, '') || '/'
    if (base && !path.startsWith(base)) return undefined
    const local = base ? path.slice(base.length) || '/' : path
    // A link into another mounted version is a different content source.
    if (!base && /^\/v\d+(?:\/|$)/.test(local)) return undefined
    return local
  })

  async function load() {
    const path = target.value
    if (!path || preview.value) return
    const key = `${content.value.apiBase}:${path}`
    if (!cache.has(key)) {
      cache.set(key, content.value.client.get(path).then((page: any) => {
        if (!page?.data?.title) return undefined
        const links = (page.meta?.toc?.links ?? []) as { text: string }[]
        return { title: page.data.title, description: page.data.description, sections: links.map(link => link.text) }
      }).catch(() => undefined))
    }
    preview.value = await cache.get(key)
  }

  return { target, preview, load }
}
