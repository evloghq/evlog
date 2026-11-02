export interface TocLink {
  id: string
  text: string
}

/** The page at the current route, shared by the page and the shell through one `useAsyncData` key. */
export function useDocsPage() {
  const content = useDocsContent()
  return useAsyncData(`${content.value.routeBase}:${content.value.path}`, () =>
    content.value.client.get(content.value.path))
}

/**
 * Publish a page's sections: `docs-toc` for the current page, `docs-tocs` by path so a sidebar entry
 * the reader leaves keeps its sections while it folds away.
 */
export function usePublishToc() {
  const content = useDocsContent()
  const toc = useState<TocLink[]>('docs-toc', () => [])
  const tocs = useState<Record<string, TocLink[]>>('docs-tocs', () => ({}))
  return (page: unknown) => {
    const links = ((page as { meta?: { toc?: { links?: TocLink[] } } } | null)?.meta?.toc?.links ?? [])
      .map(({ id, text }) => ({ id, text }))
    toc.value = links
    tocs.value[prefixLink(content.value.path, content.value.routeBase)] = links
  }
}
