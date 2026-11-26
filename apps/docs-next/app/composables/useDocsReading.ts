/** Id of the heading being read, shared between the page and the sidebar marker. */
export function useDocsReading() {
  return useState<string | undefined>('docs-reading', () => undefined)
}

/** Id of the heading the reader has just jumped to, cleared once they have seen where they landed. */
export function useDocsArrived() {
  return useState<string | undefined>('docs-arrived', () => undefined)
}

let arrival: ReturnType<typeof setTimeout> | undefined

export function markArrived(id: string) {
  const arrived = useDocsArrived()
  arrived.value = id
  clearTimeout(arrival)
  arrival = setTimeout(() => {
    arrived.value = undefined
  }, 1600)
}

/**
 * Tracks the last heading of `ids` that has scrolled past the top of the viewport.
 * Above the first heading, nothing is being read and the marker returns to the page entry.
 * The heading being read also carries `--read`, how far through its section the reader is, from 0 to 1.
 */
export function useDocsScrollSpy(ids: MaybeRefOrGetter<string[]>) {
  const reading = useDocsReading()
  let frame = 0
  let marked: HTMLElement | undefined

  function measure() {
    frame = 0
    const list = toValue(ids)
    // A section counts as read once its heading passes the upper third of the viewport.
    const line = window.innerHeight / 3
    const tops = list.map(id => document.getElementById(id)?.getBoundingClientRect().top)
    let at = tops.findLastIndex(top => top !== undefined && top <= line)
    const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4
    if (atEnd && list.length && window.scrollY > 0) at = list.length - 1
    reading.value = list[at]

    const el = at < 0 ? undefined : document.getElementById(list[at]!) ?? undefined
    if (marked !== el) marked?.style.removeProperty('--read')
    marked = el
    if (!el) return
    // The last section ends where the page does.
    const end = tops[at + 1] ?? document.documentElement.scrollHeight - window.scrollY - window.innerHeight + line
    const start = tops[at]!
    const read = atEnd ? 1 : (line - start) / (end - start)
    el.style.setProperty('--read', String(Math.min(Math.max(read, 0), 1).toFixed(3)))
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(measure)
  }

  onMounted(() => {
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule, { passive: true })
    measure()
    const id = decodeURIComponent(location.hash.slice(1))
    if (id && toValue(ids).includes(id)) markArrived(id)
  })

  watch(() => toValue(ids), () => nextTick(measure))

  onBeforeUnmount(() => {
    window.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
    if (frame) cancelAnimationFrame(frame)
    marked?.style.removeProperty('--read')
    reading.value = undefined
  })
}
