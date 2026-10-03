<script setup lang="ts">
import type { TimedEvent } from '~/composables/useTimedSequence'

interface Chip {
  name: string
  value: string
  confidence: number
}

interface RequestRow {
  id: string
  method: 'GET' | 'POST'
  path: string
  status: number
  /** What head sampling decided before any model ran. `info` at 0% keeps errors only. */
  sampled: boolean
  chips: Chip[]
  /** The signal whose `keep` promoted the event, if any. */
  keptBy?: string
}

const requests: RequestRow[] = [
  { id: '1', method: 'POST', path: '/api/checkout', status: 200, sampled: false, chips: [{ name: 'silent-failure', value: 'yes', confidence: 0.93 }], keptBy: 'silent-failure' },
  { id: '2', method: 'POST', path: '/api/checkout', status: 502, sampled: true, chips: [{ name: 'fault', value: 'upstream', confidence: 0.93 }, { name: 'severity', value: 'watch', confidence: 0.60 }] },
  { id: '3', method: 'GET', path: '/api/orders', status: 500, sampled: true, chips: [{ name: 'fault', value: 'app', confidence: 0.91 }, { name: 'severity', value: 'page', confidence: 0.78 }] },
  { id: '4', method: 'POST', path: '/webhooks/stripe', status: 200, sampled: false, chips: [{ name: 'webhook-ignored', value: 'yes', confidence: 0.95 }], keptBy: 'webhook-ignored' },
  { id: '5', method: 'POST', path: '/api/agent/turn', status: 200, sampled: false, chips: [{ name: 'turn-looping', value: 'yes', confidence: 0.94 }], keptBy: 'turn-looping' },
  { id: '6', method: 'GET', path: '/api/products', status: 200, sampled: false, chips: [{ name: 'silent-failure', value: 'no', confidence: 0.97 }] },
]

const CHIP_SLOTS = 2

type RowPhase = 'hidden' | 'sampled' | 'judged' | 'resolved'

const rowPhase = ref<RowPhase[]>(requests.map(() => 'hidden'))
const prefersReducedMotion = ref(false)
const wrapperRef = ref<HTMLElement>()

function resetState() {
  rowPhase.value = requests.map(() => 'hidden')
}

function setPhase(i: number, phase: RowPhase) {
  rowPhase.value = rowPhase.value.map((p, idx) => idx === i ? phase : p)
}

const ENTER_AT = 200
const ROW_INTERVAL = 1200
const JUDGE_AT = 450
const RESOLVE_AT = 850
const TAIL_HOLD = 4200

function buildEvents(): TimedEvent[] {
  const events: TimedEvent[] = []
  requests.forEach((_, i) => {
    const base = ENTER_AT + i * ROW_INTERVAL
    events.push({ at: base, run: () => setPhase(i, 'sampled') })
    events.push({ at: base + JUDGE_AT, run: () => setPhase(i, 'judged') })
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

function isKept(row: RequestRow) {
  return row.sampled || !!row.keptBy
}

const resolvedRows = computed(() => requests.filter((_, i) => rowPhase.value[i] === 'resolved'))
const judgedRows = computed(() => requests.filter((_, i) => rowPhase.value[i] === 'judged' || rowPhase.value[i] === 'resolved'))

const stats = computed(() => {
  const resolved = resolvedRows.value
  return {
    before: resolved.filter(r => r.sampled).length,
    after: resolved.filter(r => isKept(r)).length,
    back: resolved.filter(r => !r.sampled && !!r.keptBy).length,
    calls: judgedRows.value.length,
  }
})

const headline = computed(() => {
  if (!started.value) return 'idle'
  if (resolvedRows.value.length === requests.length) return `${stats.value.back} requests back from the floor`
  return 'one question per request'
})
</script>

<template>
  <div class="not-prose my-8" data-section="signals-judge">
    <div ref="wrapperRef" class="overflow-hidden border border-muted bg-default">
      <div class="flex items-center gap-2 border-b border-muted px-4 py-2.5">
        <UIcon name="i-lucide-scan-search" class="size-3.5 text-primary" />
        <span class="font-mono text-xs text-dimmed">signals</span>
        <span class="text-dimmed">·</span>
        <span
          class="font-mono text-[10px] tracking-widest uppercase transition-colors duration-300"
          :class="resolvedRows.length === requests.length ? 'text-primary' : 'text-amber-400'"
        >
          {{ headline }}
        </span>
        <div class="ml-auto hidden sm:flex items-center gap-1.5 font-mono text-[9px] tracking-widest text-dimmed">
          <span>info sampled at 0%</span>
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

      <div class="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_88px] items-center gap-x-3 border-b border-default/30 px-4 sm:px-6 py-1.5 font-mono text-[9px] tracking-widest uppercase text-dimmed">
        <span>request · sampling</span>
        <span class="hidden sm:block">model says</span>
        <span class="text-right">drain</span>
      </div>

      <div class="px-4 sm:px-6 py-2 space-y-0.5">
        <div
          v-for="(row, i) in requests"
          :key="row.id"
          class="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_88px] items-center gap-x-3 h-7 transition-all duration-500"
          :class="rowPhase[i] === 'hidden' ? 'opacity-0 -translate-x-2' : 'opacity-100 translate-x-0'"
        >
          <div class="flex items-center gap-1.5 font-mono text-[10px] sm:text-[11px] min-w-0">
            <span class="shrink-0" :class="row.method === 'POST' ? 'text-violet-400' : 'text-sky-400'">{{ row.method }}</span>
            <span class="text-muted truncate">{{ row.path }}</span>
            <span class="shrink-0" :class="statusColor(row.status)">{{ row.status }}</span>
            <span
              class="shrink-0 text-[9px] tracking-widest uppercase transition-colors duration-300"
              :class="row.sampled ? 'text-dimmed' : (rowPhase[i] === 'resolved' && row.keptBy ? 'text-dimmed/40 line-through' : 'text-dimmed')"
            >{{ row.sampled ? 'kept' : 'dropped' }}</span>
          </div>

          <div class="hidden sm:flex items-center gap-1.5 font-mono text-[10px] min-w-0">
            <span
              v-for="slot in CHIP_SLOTS"
              :key="`${row.id}-${slot}`"
              class="inline-flex items-center gap-1 whitespace-nowrap transition-all duration-300"
              :class="[
                rowPhase[i] === 'judged' || rowPhase[i] === 'resolved' ? 'opacity-100 scale-100' : 'opacity-0 scale-95',
                row.chips[slot - 1] ? '' : 'invisible',
              ]"
            >
              <span class="text-dimmed">{{ row.chips[slot - 1]?.name ?? '' }}=</span>
              <span :class="row.chips[slot - 1]?.value === 'yes' ? 'text-amber-400' : 'text-default'">{{ row.chips[slot - 1]?.value ?? '' }}</span>
              <span class="text-dimmed/70">{{ row.chips[slot - 1]?.confidence.toFixed(2) ?? '' }}</span>
            </span>
          </div>

          <div
            class="justify-self-end font-mono text-[10px] tracking-widest uppercase transition-opacity duration-300 whitespace-nowrap"
            :class="rowPhase[i] === 'resolved' ? 'opacity-100' : 'opacity-0'"
          >
            <span v-if="row.keptBy" class="inline-flex items-center gap-1 text-emerald-400">
              <UIcon name="i-lucide-arrow-up-from-line" class="size-3" />
              <span>kept</span>
            </span>
            <span v-else-if="row.sampled" class="inline-flex items-center gap-1 text-emerald-400/70">
              <UIcon name="i-lucide-check" class="size-3" />
              <span>kept</span>
            </span>
            <span v-else class="inline-flex items-center gap-1 text-muted">
              <UIcon name="i-lucide-trash-2" class="size-3" />
              <span>dropped</span>
            </span>
          </div>
        </div>
      </div>

      <div class="border-t border-muted/50 px-4 py-3 grid grid-cols-3 gap-3 font-mono text-[10px]">
        <div class="flex flex-col gap-0.5">
          <span class="text-dimmed text-[9px] tracking-widest uppercase">drained before</span>
          <span class="text-muted">{{ stats.before }} <span class="text-dimmed">/ {{ requests.length }}</span></span>
        </div>
        <div class="flex flex-col gap-0.5 text-center">
          <span class="text-dimmed text-[9px] tracking-widest uppercase">drained after</span>
          <span class="text-emerald-400">{{ stats.after }} <span class="text-dimmed">/ {{ requests.length }}</span></span>
        </div>
        <div class="flex flex-col gap-0.5 text-right">
          <span class="text-dimmed text-[9px] tracking-widest uppercase">model calls</span>
          <span class="text-muted">{{ stats.calls }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
