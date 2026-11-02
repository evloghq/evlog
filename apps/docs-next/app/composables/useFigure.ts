import { unrefElement } from '@vueuse/core'
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
 * Bind `root` to the figure and wire `replay` to its Replay button.
 */
export function useFigure(opts: UseFigureOptions) {
  const root = ref()
  const finished = ref(false)
  const still = ref(false)

  const steps = [...opts.steps].sort((a, b) => a.at - b.at)
  const end = (steps.at(-1)?.at ?? 0) + 400
  steps.push({ at: end, run: () => {
    finished.value = true
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
    const el = unrefElement(root)
    if (!el) return
    observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        sequence.start()
        observer?.disconnect()
      }
    }, { threshold: 0.45 })
    observer.observe(el)
  })

  onBeforeUnmount(() => observer?.disconnect())

  return { root, finished, still, replay: sequence.restart }
}
