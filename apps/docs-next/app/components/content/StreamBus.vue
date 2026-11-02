<script setup lang="ts">
import type { TimedEvent } from '~/composables/useTimedSequence'

type DeliveryState = 'idle' | 'inflight' | 'delivered'

interface Subscriber {
  id: 'sync' | 'iter' | 'ring'
  label: string
  hint: string
  icon: string
}

const subscribers: Subscriber[] = [
  { id: 'sync', label: 'subscribe()', hint: 'sync listener', icon: 'i-lucide-bell' },
  { id: 'iter', label: 'events()', hint: 'async iterator', icon: 'i-lucide-rotate-ccw' },
  { id: 'ring', label: 'replay()', hint: 'ring buffer', icon: 'i-lucide-database' },
]

const RING_MAX = 8

const eventSent = ref(false)
const onBus = ref(false)
const state = ref<Record<Subscriber['id'], DeliveryState>>({ sync: 'idle', iter: 'idle', ring: 'idle' })
const ringFill = ref(0)
const totalEmitted = ref(0)
const prefersReducedMotion = ref(false)
const wrapperRef = ref<HTMLElement>()

function resetCycle() {
  eventSent.value = false
  onBus.value = false
  state.value = { sync: 'idle', iter: 'idle', ring: 'idle' }
}

function fullReset() {
  resetCycle()
  ringFill.value = 0
  totalEmitted.value = 0
}

const EMIT_COUNT = 4
const CYCLE_MS = 1900
const FIRST_EMIT_DELAY_MS = 200
const EMIT_TO_BUS_MS = 300
const BUS_TO_INFLIGHT_MS = 450
const SYNC_DELIVERED_MS = 700
const ITER_DELIVERED_MS = 850
const RING_DELIVERED_MS = 1000
const CYCLE_REST_MS = 1500
const TAIL_HOLD_MS = 600

function buildEvents(): TimedEvent[] {
  const events: TimedEvent[] = []

  for (let n = 0; n < EMIT_COUNT; n++) {
    const base = FIRST_EMIT_DELAY_MS + n * CYCLE_MS

    events.push({ at: base, run: () => {
      resetCycle()
      eventSent.value = true
    } })
    events.push({ at: base + EMIT_TO_BUS_MS, run: () => {
      onBus.value = true
      totalEmitted.value = n + 1
    } })
    events.push({ at: base + BUS_TO_INFLIGHT_MS, run: () => {
      state.value = { sync: 'inflight', iter: 'inflight', ring: 'inflight' }
    } })
    events.push({ at: base + SYNC_DELIVERED_MS, run: () => {
      state.value = { ...state.value, sync: 'delivered' }
    } })
    events.push({ at: base + ITER_DELIVERED_MS, run: () => {
      state.value = { ...state.value, iter: 'delivered' }
    } })
    events.push({ at: base + RING_DELIVERED_MS, run: () => {
      state.value = { ...state.value, ring: 'delivered' }
      ringFill.value = Math.min(ringFill.value + 1, RING_MAX)
    } })
    events.push({ at: base + CYCLE_REST_MS, run: () => {
      eventSent.value = false
      onBus.value = false
    } })
  }

  return events
}

const events = buildEvents()
const totalDuration = FIRST_EMIT_DELAY_MS + EMIT_COUNT * CYCLE_MS + TAIL_HOLD_MS

const { start, toggle, restart, paused, started } = useTimedSequence({
  events,
  totalDuration,
  loop: true,
  onReset: fullReset,
})

let observer: IntersectionObserver | undefined

onMounted(() => {
  prefersReducedMotion.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (prefersReducedMotion.value) {
    eventSent.value = true
    onBus.value = true
    state.value = { sync: 'delivered', iter: 'delivered', ring: 'delivered' }
    ringFill.value = RING_MAX
    totalEmitted.value = EMIT_COUNT
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

function statusClass(s: DeliveryState) {
  switch (s) {
    case 'idle': return 'text-dimmed'
    case 'inflight': return 'text-primary'
    case 'delivered': return 'text-emerald-500'
  }
}

function rowBorderClass(s: DeliveryState) {
  switch (s) {
    case 'idle': return 'border-muted/30'
    case 'inflight': return 'border-primary/40'
    case 'delivered': return 'border-emerald-500/30'
  }
}

function statusIcon(s: DeliveryState) {
  switch (s) {
    case 'idle': return 'i-lucide-circle-dashed'
    case 'inflight': return 'i-lucide-loader'
    case 'delivered': return 'i-lucide-check'
  }
}

const deliveredCount = computed(() => Object.values(state.value).filter(s => s === 'delivered').length)
const stage = computed(() => {
  if (deliveredCount.value === subscribers.length) return 3
  if (Object.values(state.value).some(s => s !== 'idle')) return 2
  if (onBus.value) return 1
  if (eventSent.value) return 0
  return -1
})
</script>

<template>
  <div class="not-prose my-8" data-section="stream-bus">
    <div ref="wrapperRef" class="overflow-hidden border border-muted bg-default">
      <div class="flex items-center gap-2 border-b border-muted px-3 py-2">
        <UIcon name="i-lucide-radio-tower" class="size-3 text-primary" />
        <span class="font-mono text-[11px] text-dimmed">createStreamDrain()</span>
        <span class="text-dimmed text-[10px]">·</span>
        <span class="font-mono text-[9px] tracking-widest uppercase transition-colors" :class="onBus ? 'text-primary' : 'text-dimmed'">
          {{ deliveredCount }}/{{ subscribers.length }} delivered
        </span>
        <div class="ml-auto hidden sm:flex items-center gap-1.5 font-mono text-[9px] tracking-widest text-dimmed">
          <span>in-process · 0 hops</span>
        </div>
        <div class="flex items-center gap-0.5 ml-1">
          <button type="button" class="size-5 inline-flex items-center justify-center text-dimmed hover:text-default focus:text-default focus:outline-none transition-colors" :aria-label="paused ? 'Play animation' : 'Pause animation'" :disabled="!started" @click="toggle">
            <UIcon :name="paused ? 'i-lucide-play' : 'i-lucide-pause'" class="size-3" />
          </button>
          <button type="button" class="size-5 inline-flex items-center justify-center text-dimmed hover:text-default focus:text-default focus:outline-none transition-colors" aria-label="Restart animation" :disabled="!started" @click="restart">
            <UIcon name="i-lucide-rotate-ccw" class="size-3" />
          </button>
        </div>
      </div>

      <div class="px-3 py-3">
        <div class="flex items-center gap-1.5 mb-3 font-mono text-[10px]">
          <div
            class="flex items-center gap-1.5 px-2 py-1 border transition-all duration-300 shrink-0"
            :class="stage >= 0 ? 'border-primary/40 text-primary' : 'border-muted/40 text-dimmed'"
          >
            <UIcon name="i-lucide-package" class="size-3" />
            <span class="tabular-nums">emit{{ totalEmitted ? ` #${totalEmitted}` : '' }}</span>
          </div>
          <div class="flex-1 h-px bg-muted/40 relative overflow-hidden">
            <div
              class="absolute inset-y-0 left-0 bg-primary/60 transition-all duration-300"
              :style="{ width: stage >= 1 ? '100%' : '0%' }"
            />
          </div>
          <div
            class="flex items-center gap-1.5 px-2 py-1 border transition-all duration-300 shrink-0"
            :class="stage >= 1 ? 'border-primary/40 text-primary' : 'border-muted/40 text-dimmed'"
          >
            <UIcon name="i-lucide-radio-tower" class="size-3" />
            <span>bus</span>
          </div>
          <div class="flex-1 h-px bg-muted/40 relative overflow-hidden">
            <div
              class="absolute inset-y-0 left-0 bg-primary/60 transition-all duration-300"
              :style="{ width: stage >= 2 ? '100%' : '0%' }"
            />
          </div>
          <div
            class="flex items-center gap-1.5 px-2 py-1 border transition-all duration-300 shrink-0"
            :class="stage >= 2 ? 'border-emerald-500/30 text-emerald-500' : 'border-muted/40 text-dimmed'"
          >
            <UIcon name="i-lucide-share-2" class="size-3" />
            <span class="tabular-nums">{{ deliveredCount }}/{{ subscribers.length }}</span>
          </div>
        </div>

        <div class="space-y-1">
          <div
            v-for="sub in subscribers"
            :key="sub.id"
            class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-2.5 py-1.5 border transition-all duration-300 h-[28px]"
            :class="rowBorderClass(state[sub.id])"
          >
            <div class="flex items-center gap-2 min-w-0">
              <UIcon
                :name="sub.icon"
                class="size-3 shrink-0 transition-opacity duration-300"
                :class="state[sub.id] === 'idle' ? 'opacity-50' : 'opacity-100'"
              />
              <span
                class="font-mono text-[10px] transition-colors duration-300 truncate"
                :class="state[sub.id] === 'idle' ? 'text-dimmed' : 'text-highlighted'"
              >
                {{ sub.label }}
              </span>
              <span class="hidden sm:inline font-mono text-[8px] text-dimmed tracking-widest uppercase truncate">
                {{ sub.hint }}
              </span>
            </div>
            <div class="flex items-center gap-1 font-mono text-[9px] tabular-nums whitespace-nowrap" :class="statusClass(state[sub.id])">
              <UIcon
                :name="statusIcon(state[sub.id])"
                class="size-3 transition-colors duration-300"
                :class="state[sub.id] === 'inflight' ? 'animate-spin' : ''"
              />
              <span>
                <template v-if="sub.id === 'ring'">{{ ringFill }}/{{ RING_MAX }}</template>
                <template v-else-if="state[sub.id] === 'idle'">idle</template>
                <template v-else-if="state[sub.id] === 'inflight'">→</template>
                <template v-else>ok</template>
              </span>
            </div>
          </div>
        </div>

        <div class="mt-3 flex items-center gap-2">
          <span class="font-mono text-[8px] text-dimmed tracking-widest uppercase whitespace-nowrap">ring</span>
          <div class="flex-1 grid gap-px" :style="{ gridTemplateColumns: `repeat(${RING_MAX}, minmax(0, 1fr))` }">
            <div
              v-for="i in RING_MAX"
              :key="i"
              class="h-1.5 transition-colors duration-300"
              :class="i <= ringFill ? 'bg-emerald-500/60' : 'bg-muted/30'"
            />
          </div>
          <span class="font-mono text-[9px] text-dimmed tabular-nums w-8 text-right">{{ ringFill }}/{{ RING_MAX }}</span>
        </div>
      </div>

      <div class="border-t border-muted/50 px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[9px] text-dimmed">
        <span class="inline-flex items-center gap-1">
          <UIcon name="i-lucide-zap" class="size-2.5 text-primary" />
          one emit · all subscribers
        </span>
        <span class="inline-flex items-center gap-1">
          <UIcon name="i-lucide-database" class="size-2.5 text-emerald-500" />
          replay for late joiners
        </span>
        <span class="ml-auto tabular-nums">
          <span class="text-dimmed">emitted: </span>
          <span class="text-muted">{{ totalEmitted }}</span>
        </span>
      </div>
    </div>
  </div>
</template>
