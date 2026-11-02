<script setup lang="ts">
import type { TimedEvent } from '~/composables/useTimedSequence'

type Verdict = 'pending' | 'dark' | 'partial' | 'instrumented'

interface Entry {
  path: string
  score: number
  verdict: Exclude<Verdict, 'pending'>
  mark?: '$' | 'A'
  /** Position in FIX FIRST — sensitive entry points come before merely low-scoring ones. */
  rank?: number
}

/** Real rows from the playground scan, worst first — the order the report uses. */
const entries: Entry[] = [
  { path: 'api/auth/[...all].ts', score: 20, verdict: 'dark', mark: 'A', rank: 1 },
  { path: '…ment-declined.get.ts', score: 20, verdict: 'dark', mark: '$', rank: 2 },
  { path: '…owser-ingest.post.ts', score: 45, verdict: 'dark' },
  { path: '…i/auth/login.post.ts', score: 75, verdict: 'partial', mark: 'A', rank: 3 },
  { path: '…st/wide-event.get.ts', score: 100, verdict: 'instrumented' },
]

/** Every entry point in the project, worst on the left — the skyline the CLI prints. */
const skyline = [20, 20, 25, 35, 45, 45, 55, 65, 70, 75, 75, 80, 85, 90, 95, 100, 100, 100, 100, 100, 100, 100]

const SCORE = 76
const TARGET = 86
const FILES = 147
const ENTRY_POINTS = 29

const filesRead = ref(0)
const scanning = ref(false)
const revealed = ref(0)
const scoreShown = ref(false)
const fixFirstShown = ref(false)
const prefersReducedMotion = ref(false)
const wrapperRef = ref<HTMLElement>()

function resetState() {
  filesRead.value = 0
  scanning.value = false
  revealed.value = 0
  scoreShown.value = false
  fixFirstShown.value = false
}

const SCAN_AT = 250
const ROW_FIRST_AT = 1250
const ROW_INTERVAL = 260
const SCORE_AT = ROW_FIRST_AT + entries.length * ROW_INTERVAL + 150
const FIX_AT = SCORE_AT + 700
const TAIL_HOLD = 4200

const events: TimedEvent[] = [
  { at: SCAN_AT, run: () => {
    scanning.value = true
  } },
  { at: SCAN_AT + 150, run: () => {
    filesRead.value = 38
  } },
  { at: SCAN_AT + 450, run: () => {
    filesRead.value = 92
  } },
  { at: SCAN_AT + 750, run: () => {
    filesRead.value = FILES
  } },
]

entries.forEach((_, i) => {
  events.push({
    at: ROW_FIRST_AT + i * ROW_INTERVAL,
    run: () => {
      revealed.value = i + 1
    },
  })
})

events.push({ at: SCORE_AT, run: () => {
  scoreShown.value = true
} })
events.push({ at: FIX_AT, run: () => {
  fixFirstShown.value = true
} })

const totalDuration = FIX_AT + TAIL_HOLD

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
    filesRead.value = FILES
    scanning.value = true
    revealed.value = entries.length
    scoreShown.value = true
    fixFirstShown.value = true
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

function verdictOf(i: number): Verdict {
  return i < revealed.value ? (entries[i]?.verdict ?? 'pending') : 'pending'
}

function verdictClass(v: Verdict) {
  switch (v) {
    case 'pending': return 'text-dimmed'
    case 'dark': return 'text-rose-400'
    case 'partial': return 'text-amber-500'
    case 'instrumented': return 'text-emerald-500'
  }
}

function barClass(v: Verdict) {
  switch (v) {
    case 'pending': return 'bg-muted/30'
    case 'dark': return 'bg-rose-400/70'
    case 'partial': return 'bg-amber-500/70'
    case 'instrumented': return 'bg-emerald-500/70'
  }
}

function verdictLabel(v: Verdict) {
  switch (v) {
    case 'pending': return '····'
    case 'dark': return 'dark'
    case 'partial': return 'partial'
    case 'instrumented': return 'covered'
  }
}

const status = computed(() => {
  if (fixFirstShown.value) return `${SCORE} → ${TARGET} by fixing 3`
  if (scoreShown.value) return `score ${SCORE} · good`
  if (revealed.value > 0) return `${revealed.value} of ${entries.length} verdicts`
  if (scanning.value) return 'reading source'
  return 'idle'
})
</script>

<template>
  <div class="not-prose my-8" data-section="map-scan-flow">
    <div ref="wrapperRef" class="overflow-hidden border border-muted bg-default">
      <div class="flex items-center gap-2 border-b border-muted px-3 py-2">
        <UIcon name="i-lucide-radar" class="size-3 text-primary shrink-0" />
        <span class="font-mono text-[11px] text-dimmed">evlog map</span>
        <span class="text-dimmed text-[10px]">·</span>
        <span
          class="font-mono text-[9px] uppercase tracking-widest transition-colors duration-300 truncate"
          :class="fixFirstShown ? 'text-emerald-500' : scanning ? 'text-primary' : 'text-dimmed'"
        >
          {{ status }}
        </span>
        <div class="ml-auto hidden sm:flex items-center gap-1.5 font-mono text-[9px] tracking-widest text-dimmed">
          <span class="tabular-nums">{{ filesRead }} files · {{ scanning ? ENTRY_POINTS : 0 }} entry points</span>
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

      <div class="px-3 py-2.5">
        <div class="flex items-center gap-2 mb-2">
          <span class="font-mono text-[8px] uppercase tracking-widest text-dimmed whitespace-nowrap">scan</span>
          <div class="flex-1 h-px bg-muted/40 relative overflow-hidden">
            <div
              class="absolute inset-y-0 left-0 bg-primary/60 transition-all duration-500 ease-out"
              :style="{ width: `${(filesRead / FILES) * 100}%` }"
            />
          </div>
          <span class="font-mono text-[9px] tabular-nums text-dimmed w-14 text-right">{{ filesRead }}/{{ FILES }}</span>
        </div>

        <div class="space-y-0.5">
          <div
            v-for="(entry, i) in entries"
            :key="entry.path"
            class="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_56px_auto] items-center gap-2 h-[24px] px-1.5 border-l-2 transition-colors duration-300"
            :class="verdictOf(i) === 'pending'
              ? 'border-transparent'
              : verdictOf(i) === 'dark' ? 'border-rose-400/60' : verdictOf(i) === 'partial' ? 'border-amber-500/60' : 'border-emerald-500/40'"
          >
            <div class="flex items-center gap-1.5 min-w-0">
              <span
                class="font-mono text-[9px] tabular-nums w-3 shrink-0 transition-opacity duration-300"
                :class="[
                  fixFirstShown && entry.rank ? 'opacity-100 text-rose-400' : 'opacity-0',
                ]"
              >{{ entry.rank ?? '' }}</span>
              <span
                class="font-mono text-[10px] truncate transition-colors duration-300"
                :class="verdictOf(i) === 'pending' ? 'text-dimmed' : 'text-highlighted'"
              >{{ entry.path }}</span>
              <span
                class="font-mono text-[9px] shrink-0 transition-opacity duration-300"
                :class="[verdictOf(i) === 'pending' ? 'opacity-0' : 'opacity-100', entry.mark === '$' ? 'text-amber-500' : 'text-primary']"
              >{{ entry.mark ?? '' }}</span>
            </div>

            <div class="hidden sm:grid grid-cols-10 gap-px h-1.5">
              <div
                v-for="block in 10"
                :key="block"
                class="transition-colors duration-300"
                :class="verdictOf(i) !== 'pending' && block * 10 <= entry.score ? barClass(verdictOf(i)) : 'bg-muted/25'"
              />
            </div>

            <div class="flex items-center gap-1.5 font-mono text-[9px] tabular-nums whitespace-nowrap" :class="verdictClass(verdictOf(i))">
              <span class="w-6 text-right">{{ verdictOf(i) === 'pending' ? '··' : entry.score }}</span>
              <span class="w-12">{{ verdictLabel(verdictOf(i)) }}</span>
            </div>
          </div>
        </div>

        <div class="mt-2 pt-2 border-t border-muted/40 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
          <div class="flex items-baseline gap-1.5">
            <span
              class="font-mono text-xl leading-none tabular-nums transition-colors duration-500"
              :class="scoreShown ? 'text-highlighted' : 'text-dimmed'"
            >{{ scoreShown ? SCORE : '··' }}</span>
            <span class="font-mono text-[9px] text-dimmed">/100</span>
            <span
              class="font-mono text-[9px] uppercase tracking-widest transition-opacity duration-500 ml-1"
              :class="scoreShown ? 'opacity-100 text-emerald-500' : 'opacity-0'"
            >good</span>
          </div>
          <div class="flex items-end gap-px h-6" aria-hidden="true">
            <div
              v-for="(height, i) in skyline"
              :key="i"
              class="flex-1 transition-all duration-500 ease-out"
              :class="height <= 45 ? 'bg-rose-400/60' : height < 100 ? 'bg-amber-500/50' : 'bg-emerald-500/50'"
              :style="{
                height: scoreShown ? `${Math.max(height, 12)}%` : '6%',
                transitionDelay: `${i * 22}ms`,
              }"
            />
          </div>
        </div>
      </div>

      <div class="border-t border-muted/50 px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[9px] text-dimmed">
        <span>5 of {{ ENTRY_POINTS }} shown</span>
        <span class="hidden sm:inline">no traffic · same code in, same verdict out</span>
        <span
          class="ml-auto tabular-nums transition-opacity duration-500 whitespace-nowrap"
          :class="fixFirstShown ? 'opacity-100 text-emerald-500' : 'opacity-0'"
        >
          ▲ {{ SCORE }} → {{ TARGET }} by fixing the 3 above
        </span>
      </div>
    </div>
  </div>
</template>
