<script setup lang="ts">
import type { TimedEvent } from '~/composables/useTimedSequence'

type RunState = 'queued' | 'running' | 'failed' | 'passed'

interface Run {
  id: string
  pr: string
  title: string
  score: number
}

const THRESHOLD = 80

/** Two runs of the same gated job, one pull request apart. */
const runs: Run[] = [
  { id: 'before', pr: '#128', title: 'checkout: retry declined cards', score: 76 },
  { id: 'after', pr: '#129', title: 'instrument the three dark handlers', score: 86 },
]

const state = ref<Record<string, RunState>>({ before: 'queued', after: 'queued' })
const needle = ref(0)
const commitPushed = ref(false)
const prefersReducedMotion = ref(false)
const wrapperRef = ref<HTMLElement>()

function resetState() {
  state.value = { before: 'queued', after: 'queued' }
  needle.value = 0
  commitPushed.value = false
}

function setRun(id: string, s: RunState) {
  state.value = { ...state.value, [id]: s }
}

const RUN1_AT = 400
const FAIL_AT = 1600
const COMMIT_AT = 2700
const RUN2_AT = 3400
const PASS_AT = 4600
const TAIL_HOLD = 4000

const events: TimedEvent[] = [
  { at: RUN1_AT, run: () => {
    setRun('before', 'running')
  } },
  { at: FAIL_AT, run: () => {
    setRun('before', 'failed')
    needle.value = 76
  } },
  { at: COMMIT_AT, run: () => {
    commitPushed.value = true
  } },
  { at: RUN2_AT, run: () => {
    setRun('after', 'running')
  } },
  { at: PASS_AT, run: () => {
    setRun('after', 'passed')
    needle.value = 86
  } },
]

const totalDuration = PASS_AT + TAIL_HOLD

const { start, toggle, restart, paused, started } = useTimedSequence({
  events,
  totalDuration,
  loop: true,
  onReset: resetState,
})

let observer: IntersectionObserver | undefined

onMounted(() => {
  prefersReducedMotion.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (prefersReducedMotion.value) {
    state.value = { before: 'failed', after: 'passed' }
    needle.value = 86
    commitPushed.value = true
    return
  }
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

function stateOf(id: string): RunState {
  return state.value[id] ?? 'queued'
}

function stateClass(s: RunState) {
  switch (s) {
    case 'queued': return 'text-dimmed'
    case 'running': return 'text-primary'
    case 'failed': return 'text-rose-400'
    case 'passed': return 'text-emerald-500'
  }
}

function stateIcon(s: RunState) {
  switch (s) {
    case 'queued': return 'i-lucide-circle-dashed'
    case 'running': return 'i-lucide-loader'
    case 'failed': return 'i-lucide-x'
    case 'passed': return 'i-lucide-check'
  }
}

function stateLabel(run: Run, s: RunState) {
  switch (s) {
    case 'queued': return 'queued'
    case 'running': return 'map →'
    case 'failed': return `${run.score} · exit 1`
    case 'passed': return `${run.score} · exit 0`
  }
}

const passed = computed(() => stateOf('after') === 'passed')
const gateLine = computed(() => {
  if (passed.value) return `score 86 meets --min-score ${THRESHOLD} — exit code 0`
  if (stateOf('before') === 'failed') return `score 76 is below --min-score ${THRESHOLD} — exit code 1`
  return `waiting for evlog map --min-score ${THRESHOLD}`
})
</script>

<template>
  <div class="not-prose my-8" data-section="map-pr-gate">
    <div ref="wrapperRef" class="overflow-hidden border border-muted bg-default">
      <div class="flex items-center gap-2 border-b border-muted px-3 py-2">
        <UIcon name="i-lucide-git-pull-request" class="size-3 text-primary shrink-0" />
        <span class="font-mono text-[11px] text-dimmed truncate">evlog map --min-score {{ THRESHOLD }}</span>
        <span class="text-dimmed text-[10px]">·</span>
        <span
          class="font-mono text-[9px] uppercase tracking-widest transition-colors duration-300"
          :class="passed ? 'text-emerald-500' : stateOf('before') === 'failed' ? 'text-rose-400' : 'text-dimmed'"
        >
          {{ passed ? 'gate passed' : stateOf('before') === 'failed' ? 'gate failed' : 'checks pending' }}
        </span>
        <div class="ml-auto hidden sm:block font-mono text-[9px] tracking-widest text-dimmed">
          <span class="transition-opacity duration-500 tabular-nums" :class="passed ? 'opacity-100' : 'opacity-0'">+10 in one PR</span>
        </div>
        <div class="flex items-center gap-0.5 ml-1">
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

      <div class="px-3 py-3">
        <div class="relative h-8 mb-3">
          <div class="absolute inset-x-0 top-4 h-1.5 bg-muted/25" />
          <div
            class="absolute top-4 left-0 h-1.5 transition-all duration-700 ease-out"
            :class="needle >= THRESHOLD ? 'bg-emerald-500/60' : 'bg-rose-400/60'"
            :style="{ width: `${needle}%` }"
          />
          <div class="absolute top-2.5 bottom-0 w-px bg-dimmed/70" :style="{ left: `${THRESHOLD}%` }" />
          <span
            class="absolute top-0 font-mono text-[9px] text-dimmed tabular-nums -translate-x-1/2 whitespace-nowrap"
            :style="{ left: `${THRESHOLD}%` }"
          >min {{ THRESHOLD }}</span>
          <div
            class="absolute top-3 size-3 border-2 border-default transition-all duration-700 ease-out -translate-x-1/2"
            :class="needle >= THRESHOLD ? 'bg-emerald-500' : needle > 0 ? 'bg-rose-400' : 'bg-accented'"
            :style="{ left: `${needle}%` }"
          />
          <span
            class="absolute top-6 font-mono text-[9px] tabular-nums -translate-x-1/2 transition-all duration-700 ease-out"
            :class="needle >= THRESHOLD ? 'text-emerald-500' : needle > 0 ? 'text-rose-400' : 'opacity-0'"
            :style="{ left: `${needle}%` }"
          >{{ needle || '' }}</span>
        </div>

        <div class="space-y-0.5">
          <div
            v-for="run in runs"
            :key="run.id"
            class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 h-[26px] px-2 border transition-colors duration-300"
            :class="{
              'border-muted/30': stateOf(run.id) === 'queued',
              'border-primary/40': stateOf(run.id) === 'running',
              'border-rose-400/40 bg-rose-400/4': stateOf(run.id) === 'failed',
              'border-emerald-500/30 bg-emerald-500/4': stateOf(run.id) === 'passed',
            }"
          >
            <div class="flex items-center gap-1.5 min-w-0">
              <span
                class="font-mono text-[10px] tabular-nums shrink-0 transition-colors duration-300"
                :class="stateOf(run.id) === 'queued' ? 'text-dimmed' : 'text-highlighted'"
              >{{ run.pr }}</span>
              <span class="font-mono text-[10px] truncate transition-colors duration-300 text-dimmed">{{ run.title }}</span>
            </div>
            <div class="flex items-center gap-1.5 font-mono text-[9px] tabular-nums whitespace-nowrap" :class="stateClass(stateOf(run.id))">
              <UIcon
                :name="stateIcon(stateOf(run.id))"
                class="size-3 transition-colors duration-300"
                :class="stateOf(run.id) === 'running' ? 'animate-spin' : ''"
              />
              <span class="w-16 text-right">{{ stateLabel(run, stateOf(run.id)) }}</span>
            </div>
          </div>
        </div>

        <div class="mt-2 h-[16px] flex items-center gap-1.5 font-mono text-[9px]">
          <span class="transition-opacity duration-500 flex items-center gap-1.5" :class="commitPushed ? 'opacity-100' : 'opacity-0'">
            <UIcon name="i-lucide-git-commit-horizontal" class="size-2.5 text-primary" />
            <span class="text-muted truncate">useLogger + log.set on two handlers, log.audit on the third</span>
          </span>
        </div>
      </div>

      <div class="border-t border-muted/50 px-3 py-2 flex items-center gap-2 font-mono text-[9px]">
        <span
          class="px-1.5 py-0.5 tracking-widest transition-colors duration-300"
          :class="passed ? 'bg-emerald-500/15 text-emerald-500' : stateOf('before') === 'failed' ? 'bg-rose-400/15 text-rose-400' : 'bg-muted/20 text-dimmed'"
        >GATE</span>
        <span class="truncate transition-colors duration-300" :class="passed ? 'text-emerald-500' : stateOf('before') === 'failed' ? 'text-rose-400' : 'text-dimmed'">
          {{ gateLine }}
        </span>
      </div>
    </div>
  </div>
</template>
