/** Id of the heading being read, shared between the page and the sidebar marker. */
export function useDocsReading() {
  return useState<string | undefined>('docs-reading', () => undefined)
}

/**
 * Tracks the last heading of `ids` that has scrolled past the top of the viewport.
 * Above the first heading, nothing is being read and the marker returns to the page entry.
 */
export function useDocsScrollSpy(ids: MaybeRefOrGetter<string[]>) {
  const reading = useDocsReading()
  let frame = 0

  function measure() {
    frame = 0
    const list = toValue(ids)
    // A section counts as read once its heading passes the upper third of the viewport.
    const line = window.innerHeight / 3
    let current: string | undefined
    for (const id of list) {
      const el = document.getElementById(id)
      if (el && el.getBoundingClientRect().top <= line) current = id
    }
    const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4
    if (atEnd && list.length && window.scrollY > 0) current = list.at(-1)
    reading.value = current
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(measure)
  }

  onMounted(() => {
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule, { passive: true })
    measure()
  })

  watch(() => toValue(ids), () => nextTick(measure))

  onBeforeUnmount(() => {
    window.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
    if (frame) cancelAnimationFrame(frame)
    reading.value = undefined
  })
}
