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
