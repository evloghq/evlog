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

/**
 * Terminal or JSON, chosen once for every event on the site. Pages are cached per path, so the server
 * always renders the terminal view and the reader's choice is restored after mount.
 */
export function useEventView() {
  const view = useState<EventView>('docs-event-view', () => 'pretty')
  onMounted(() => {
    if (localStorage.getItem('docs-event-view') === 'json') view.value = 'json'
  })
  function choose(next: EventView) {
    view.value = next
    localStorage.setItem('docs-event-view', next)
  }
  return { view, choose }
}
