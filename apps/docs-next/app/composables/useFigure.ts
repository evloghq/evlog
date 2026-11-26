import type { TimedEvent } from '~/composables/useTimedSequence'

export interface UseFigureOptions {
  steps: TimedEvent[]
  /** Puts the figure back to its first frame. */
  reset: () => void
  /** Puts the figure on its last frame, for readers who prefer reduced motion. */
  settle: () => void
}

/**
 * Plays a docs figure once, the first time it is mostly in view, then holds its last frame.
 * Bind `root` to the `DocsFigure`, pass it `playing` and `duration` for its progress line, and wire `replay`.
 */
export function useFigure(opts: UseFigureOptions) {
  const root = ref<{ frame: HTMLElement | null }>()
  const finished = ref(false)
  const still = ref(false)
  const playing = ref(false)

  const steps = [...opts.steps].sort((a, b) => a.at - b.at)
  const end = (steps.at(-1)?.at ?? 0) + 400
  steps.push({ at: end, run: () => {
    finished.value = true
    playing.value = false
  } })

  const sequence = useTimedSequence({
    events: steps,
    totalDuration: end + 20,
    onReset: () => {
      finished.value = false
      opts.reset()
    },
  })

  let observer: IntersectionObserver | undefined

  onMounted(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      still.value = true
      opts.settle()
      finished.value = true
      return
    }
    const el = root.value?.frame
    if (!el) return
    observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        playing.value = true
        sequence.start()
        observer?.disconnect()
      }
    }, { threshold: 0.45 })
    observer.observe(el)
  })

  onBeforeUnmount(() => observer?.disconnect())

  function replay() {
    playing.value = true
    sequence.restart()
  }

  return { root, finished, still, playing, duration: end, replay }
}
