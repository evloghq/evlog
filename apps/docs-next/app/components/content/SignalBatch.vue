<script setup lang="ts">
import type { TimedEvent } from '~/composables/useTimedSequence'

interface RequestRow {
  id: string
  method: 'GET' | 'POST'
  path: string
  status: number
  /** Signals whose `when` matched this event. */
  due: string[]
  /** `cache`: served from `cacheKey`, no model call. */
  outcome: 'call' | 'none' | 'cache'
}

const requests: RequestRow[] = [
  { id: '1', method: 'GET', path: '/api/products', status: 200, due: [], outcome: 'none' },
  { id: '2', method: 'POST', path: '/api/checkout', status: 200, due: ['silent-failure'], outcome: 'call' },
  { id: '3', method: 'POST', path: '/api/checkout', status: 502, due: ['fault', 'severity', 'retryable'], outcome: 'call' },
  { id: '4', method: 'GET', path: '/api/health', status: 200, due: [], outcome: 'none' },
  { id: '5', method: 'POST', path: '/api/checkout', status: 502, due: ['fault', 'severity', 'retryable'], outcome: 'cache' },
  { id: '6', method: 'POST', path: '/api/checkout', status: 502, due: ['fault', 'severity', 'retryable'], outcome: 'cache' },
  { id: '7', method: 'GET', path: '/api/orders', status: 500, due: ['fault', 'severity'], outcome: 'call' },
]

const DUE_SLOTS = 3

type RowPhase = 'hidden' | 'visible' | 'due' | 'resolved'

const rowPhase = ref<RowPhase[]>(requests.map(() => 'hidden'))
const prefersReducedMotion = ref(false)
const wrapperRef = ref<HTMLElement>()

function resetState() {
  rowPhase.value = requests.map(() => 'hidden')
}

function setPhase(i: number, phase: RowPhase) {
  rowPhase.value = rowPhase.value.map((p, idx) => idx === i ? phase : p)
}

const ENTER_AT = 300
const ROW_INTERVAL = 1700
const DUE_AT = 600
const RESOLVE_AT = 1200
const TAIL_HOLD = 4500

function buildEvents(): TimedEvent[] {
  const events: TimedEvent[] = []
  requests.forEach((_, i) => {
    const base = ENTER_AT + i * ROW_INTERVAL
    events.push({ at: base, run: () => setPhase(i, 'visible') })
    events.push({ at: base + DUE_AT, run: () => setPhase(i, 'due') })
    events.push({ at: base + RESOLVE_AT, run: () => setPhase(i, 'resolved') })
  })
  return events
}

const events = buildEvents()
const totalDuration = ENTER_AT + requests.length * ROW_INTERVAL + TAIL_HOLD

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
    rowPhase.value = requests.map(() => 'resolved')
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

function statusColor(status: number) {
  if (status >= 500) return 'text-rose-400'
  if (status >= 400) return 'text-amber-400'
  return 'text-emerald-400'
}

const resolved = computed(() => requests.filter((_, i) => rowPhase.value[i] === 'resolved'))

const stats = computed(() => ({
  events: resolved.value.length,
  questions: resolved.value.reduce((n, r) => n + r.due.length, 0),
  calls: resolved.value.filter(r => r.outcome === 'call').length,
  cached: resolved.value.filter(r => r.outcome === 'cache').length,
}))

const headline = computed(() => {
  if (!started.value && !prefersReducedMotion.value) return 'idle'
  if (resolved.value.length === requests.length) return `${stats.value.questions} questions, ${stats.value.calls} calls`
  return 'one call per event, not per signal'
})
</script>

<template>
  <div class="not-prose my-8" data-section="signal-batch">
    <div ref="wrapperRef" class="overflow-hidden border border-muted bg-default">
      <div class="flex items-center gap-2 border-b border-muted px-4 py-2.5">
        <UIcon name="i-lucide-coins" class="size-3.5 text-primary" />
        <span class="font-mono text-xs text-dimmed">what gets billed</span>
        <span class="text-dimmed">·</span>
        <span
          class="font-mono text-[10px] tracking-widest uppercase transition-colors duration-300 truncate"
          :class="resolved.length === requests.length ? 'text-primary' : 'text-amber-400'"
        >
          {{ headline }}
        </span>
        <div class="ml-auto hidden sm:flex items-center gap-1.5 font-mono text-[9px] tracking-widest text-dimmed">
          <span>cacheKey: path + error.name</span>
        </div>
        <div class="flex items-center gap-0.5 ml-1.5 sm:ml-2">
          <button
            type="button"
            class="size-6 inline-flex items-center justify-center text-dimmed hover:text-default focus:text-default focus:outline-none transition-colors"
            :aria-label="paused ? 'Play animation' : 'Pause animation'"
            :disabled="!started"
            @click="toggle"
          >
            <UIcon :name="paused ? 'i-lucide-play' : 'i-lucide-pause'" class="size-3" />
          </button>
          <button
            type="button"
            class="size-6 inline-flex items-center justify-center text-dimmed hover:text-default focus:text-default focus:outline-none transition-colors"
            aria-label="Restart animation"
            :disabled="!started"
            @click="restart"
          >
            <UIcon name="i-lucide-rotate-ccw" class="size-3" />
          </button>
        </div>
      </div>

      <div class="grid grid-cols-[minmax(0,1fr)_72px] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_84px] items-center gap-x-3 border-b border-default/30 px-4 sm:px-6 py-1.5 font-mono text-[9px] tracking-widest uppercase text-dimmed">
        <span>event</span>
        <span class="hidden sm:block">signals due (`when`)</span>
        <span class="text-right">model</span>
      </div>

      <div class="px-4 sm:px-6 py-2 space-y-0.5">
        <div
          v-for="(row, i) in requests"
          :key="row.id"
          class="grid grid-cols-[minmax(0,1fr)_72px] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_84px] items-center gap-x-3 h-6 transition-all duration-500"
          :class="rowPhase[i] === 'hidden' ? 'opacity-0 -translate-x-2' : 'opacity-100 translate-x-0'"
        >
          <div class="flex items-center gap-1.5 font-mono text-[10px] sm:text-[11px] min-w-0 whitespace-nowrap">
            <span class="shrink-0" :class="row.method === 'POST' ? 'text-violet-400' : 'text-sky-400'">{{ row.method }}</span>
            <span class="text-muted truncate">{{ row.path }}</span>
            <span class="shrink-0" :class="statusColor(row.status)">{{ row.status }}</span>
          </div>

          <div class="hidden sm:flex items-center gap-1.5 font-mono text-[10px] min-w-0">
            <span
              v-for="slot in DUE_SLOTS"
              :key="`${row.id}-${slot}`"
              class="px-1 py-px border whitespace-nowrap transition-all duration-300"
              :class="[
                rowPhase[i] === 'due' || rowPhase[i] === 'resolved' ? 'opacity-100 scale-100' : 'opacity-0 scale-95',
                row.due[slot - 1] ? 'border-muted text-muted' : 'invisible border-transparent',
              ]"
            >{{ row.due[slot - 1] ?? '' }}</span>
            <span
              class="text-dimmed transition-opacity duration-300"
              :class="rowPhase[i] !== 'hidden' && rowPhase[i] !== 'visible' && row.due.length === 0 ? 'opacity-100' : 'opacity-0'"
            >none</span>
          </div>

          <div
            class="justify-self-end font-mono text-[10px] tracking-widest uppercase transition-opacity duration-300 whitespace-nowrap"
            :class="rowPhase[i] === 'resolved' ? 'opacity-100' : 'opacity-0'"
          >
            <span v-if="row.outcome === 'call'" class="inline-flex items-center gap-1 text-primary">
              <UIcon name="i-lucide-send" class="size-3" />
              <span>1 call</span>
            </span>
            <span v-else-if="row.outcome === 'cache'" class="inline-flex items-center gap-1 text-emerald-400/80">
              <UIcon name="i-lucide-database-zap" class="size-3" />
              <span>cached</span>
            </span>
            <span v-else class="inline-flex items-center gap-1 text-dimmed">
              <UIcon name="i-lucide-minus" class="size-3" />
              <span>no call</span>
            </span>
          </div>
        </div>
      </div>

      <div class="border-t border-muted/50 px-4 py-3 grid grid-cols-4 gap-3 font-mono text-[10px]">
        <div class="flex flex-col gap-0.5">
          <span class="text-dimmed text-[9px] tracking-widest uppercase">events</span>
          <span class="text-muted">{{ stats.events }}</span>
        </div>
        <div class="flex flex-col gap-0.5">
          <span class="text-dimmed text-[9px] tracking-widest uppercase">questions</span>
          <span class="text-muted">{{ stats.questions }}</span>
        </div>
        <div class="flex flex-col gap-0.5">
          <span class="text-dimmed text-[9px] tracking-widest uppercase">model calls</span>
          <span class="text-primary">{{ stats.calls }}</span>
        </div>
        <div class="flex flex-col gap-0.5 text-right">
          <span class="text-dimmed text-[9px] tracking-widest uppercase">from cache</span>
          <span class="text-emerald-400/80">{{ stats.cached }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
