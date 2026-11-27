/** The scenario the current page builds, from its `event` frontmatter key. */
export function useDocsEvent() {
  return useState<string | undefined>('docs-event', () => undefined)
}

export function usePublishEvent() {
  const name = useDocsEvent()
  return (page: unknown) => {
    name.value = (page as { data?: { event?: string } } | null)?.data?.event
  }
}

export type EventView = 'pretty' | 'json'
