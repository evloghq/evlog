<script setup lang="ts">
import type { TimedEvent, UseTimedSequenceOptions } from '~/composables/useTimedSequence'

type Cell = 'pending' | 'pass' | 'fail' | 'na' | 'disabled'

interface RuleCol {
  id: string
  kind: 'requirement' | 'opportunity'
  /** Initial verdict once the scan lands (step >= 1). */
  initial: Exclude<Cell, 'pending'>
  /** Verdict after fixes (step >= 2), before any disable. */
  fixed?: Exclude<Cell, 'pending'>
  /** Step at which this cell becomes disabled n/a. */
  disableAt?: number
}

/**
 * One handler through the rule engine: requirements move the score,
 * opportunities never do, and a disable comment turns a fail into ○ n/a.
 */
const rules: RuleCol[] = [
  { id: 'log', kind: 'requirement', initial: 'fail', fixed: 'pass' },
  { id: 'ctx', kind: 'requirement', initial: 'fail', fixed: 'pass' },
  { id: 'audit', kind: 'requirement', initial: 'fail', fixed: 'fail', disableAt: 4 },
  { id: 'err', kind: 'requirement', initial: 'na' },
  { id: 'catch', kind: 'requirement', initial: 'na' },
  { id: 'fetch', kind: 'requirement', initial: 'na' },
  { id: 'catalog', kind: 'opportunity', initial: 'na' },
  { id: 'audit+', kind: 'opportunity', initial: 'fail', fixed: 'fail' },
  { id: 'ai', kind: 'opportunity', initial: 'na' },
  { id: 'identity', kind: 'opportunity', initial: 'na' },
]

const requirements = rules.filter(r => r.kind === 'requirement')
const opportunities = rules.filter(r => r.kind === 'opportunity')

const step = ref(0)
const prefersReducedMotion = ref(false)
const wrapperRef = ref<HTMLElement>()

function resetState() {
  step.value = 0
}

const STEP_AT = [600, 2200, 4000, 5200]
const TAIL_HOLD = 3800

const events: TimedEvent[] = STEP_AT.map((at, i) => ({
  at,
  run: () => {
    step.value = i + 1
  },
}))

const totalDuration = (STEP_AT.at(-1) ?? 0) + TAIL_HOLD

const sequenceOpts: UseTimedSequenceOptions = {
  events,
  totalDuration,
  loop: true,
  reducedMotion: false,
  onReset: resetState,
}

const { start, toggle, restart, paused, started } = useTimedSequence(sequenceOpts)

let observer: IntersectionObserver | undefined

onMounted(() => {
  prefersReducedMotion.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  sequenceOpts.reducedMotion = prefersReducedMotion.value

  if (!wrapperRef.value) {
    start()
    return
  }
  observer = new IntersectionObserver(
    ([entry]) => {
      if (entry?.isIntersecting) {
        start()
        observer?.disconnect()
      }
    },
    { threshold: 0.25 },
  )
  observer.observe(wrapperRef.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
})

function cellFor(rule: RuleCol): Cell {
  if (step.value < 1) return 'pending'
  if (rule.disableAt !== undefined && step.value >= rule.disableAt) return 'disabled'
  if (step.value >= 2 && rule.fixed) return rule.fixed
  return rule.initial
}

function glyph(cell: Cell): string {
  switch (cell) {
    case 'pass': return '✓'
    case 'fail': return '✗'
    case 'na': return '·'
    case 'disabled': return '○'
    default: return ' '
  }
}

function cellClass(cell: Cell): string {
  switch (cell) {
    case 'pass': return 'text-emerald-500'
    case 'fail': return 'text-rose-400'
    case 'disabled': return 'text-amber-400'
    case 'na': return 'text-dimmed/60'
    default: return 'text-dimmed/30'
  }
}

const statusLabel = computed(() => {
  if (step.value >= 4) return 'disable → n/a · score ignores it'
  if (step.value >= 3) return 'evlog-map-disable-next-line audit'
  if (step.value >= 2) return 'useLogger + log.set landed'
  if (step.value >= 1) return 'requirements cost score · opportunities never'
  return 'waiting for scan'
})

const failingReqs = computed(() =>
  requirements.filter((r) => {
    const c = cellFor(r)
    return c === 'fail'
  }).length,
)
</script>

<template>
  <div class="not-prose my-8" data-section="map-rules-matrix">
    <div ref="wrapperRef" class="w-full min-h-[248px] overflow-hidden border border-muted bg-default">
      <div class="flex items-center gap-2 border-b border-muted px-3 py-2">
        <UIcon name="i-lucide-list-checks" class="size-3 text-primary shrink-0" />
        <span class="font-mono text-[11px] text-dimmed truncate">evlog map — rules</span>
        <span class="text-dimmed text-[10px]">·</span>
        <span class="font-mono text-[9px] text-muted truncate">api/checkout.post.ts</span>
        <div class="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            class="size-5 inline-flex items-center justify-center text-dimmed hover:text-default focus:text-default focus:outline-none transition-colors"
            :aria-label="paused ? 'Play animation' : 'Pause animation'"
            :disabled="!started"
            @click="toggle"
          >
            <UIcon :name="paused ? 'i-lucide-play' : 'i-lucide-pause'" class="size-3" />
          </button>
          <button
            type="button"
            class="size-5 inline-flex items-center justify-center text-dimmed hover:text-default focus:text-default focus:outline-none transition-colors"
            aria-label="Restart animation"
            :disabled="!started"
            @click="restart"
          >
            <UIcon name="i-lucide-rotate-ccw" class="size-3" />
          </button>
        </div>
      </div>

      <div class="px-3 py-2.5 space-y-2.5">
        <div>
          <div class="flex items-baseline justify-between mb-1">
            <span class="font-mono text-[9px] uppercase tracking-widest text-dimmed">Requirements</span>
            <span
              class="font-mono text-[9px] tabular-nums transition-colors duration-300"
              :class="failingReqs === 0 ? 'text-emerald-500' : 'text-rose-400'"
            >{{ failingReqs }} failing</span>
          </div>
          <div class="grid grid-cols-6 gap-1">
            <div
              v-for="rule in requirements"
              :key="rule.id"
              class="h-[44px] flex flex-col items-center justify-center gap-0.5 border border-muted/40 bg-muted/10"
            >
              <span
                class="font-mono text-[12px] leading-none transition-colors duration-300"
                :class="cellClass(cellFor(rule))"
              >{{ glyph(cellFor(rule)) }}</span>
              <span class="font-mono text-[9px] text-dimmed">{{ rule.id }}</span>
            </div>
          </div>
        </div>

        <div>
          <div class="flex items-baseline justify-between mb-1">
            <span class="font-mono text-[9px] uppercase tracking-widest text-dimmed">Opportunities</span>
            <span class="font-mono text-[9px] text-dimmed">never move the score</span>
          </div>
          <div class="grid grid-cols-4 gap-1">
            <div
              v-for="rule in opportunities"
              :key="rule.id"
              class="h-[44px] flex flex-col items-center justify-center gap-0.5 border border-muted/40 bg-muted/5"
            >
              <span
                class="font-mono text-[12px] leading-none transition-colors duration-300"
                :class="cellClass(cellFor(rule))"
              >{{ glyph(cellFor(rule)) }}</span>
              <span class="font-mono text-[9px] text-dimmed">{{ rule.id }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="border-t border-muted/50 px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[9px] text-dimmed">
        <span
          class="transition-opacity duration-300 truncate"
          :class="step >= 1 ? 'opacity-100' : 'opacity-40'"
        >{{ statusLabel }}</span>
        <span
          class="ml-auto tabular-nums transition-opacity duration-500 whitespace-nowrap"
          :class="step >= 4 ? 'opacity-100 text-amber-400' : 'opacity-0'"
        >
          ○ = disabled (still visible)
        </span>
      </div>
    </div>
  </div>
</template>
