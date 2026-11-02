<script setup lang="ts">
import type { TimedEvent } from '~/composables/useTimedSequence'

interface Lib {
  id: 'evlog' | 'pino' | 'consola' | 'winston'
  name: string
  ops: number
  accent: string
  ringColor: string
  multiplier?: string
}

const libs: Lib[] = [
  { id: 'evlog', name: 'evlog', ops: 1_580_000, accent: 'text-primary', ringColor: 'bg-primary' },
  { id: 'pino', name: 'pino', ops: 205_800, accent: 'text-amber-400', ringColor: 'bg-amber-400', multiplier: '7.7×' },
  { id: 'consola', name: 'consola', ops: 0, accent: 'text-dimmed/60', ringColor: 'bg-muted', multiplier: 'n/a' },
  { id: 'winston', name: 'winston', ops: 111_900, accent: 'text-rose-400/80', ringColor: 'bg-rose-400/70', multiplier: '14.1×' },
]

const MAX_OPS = libs[0]?.ops ?? 1_580_000

interface PinoLine {
  text: string
}

const pinoLines: PinoLine[] = [
  { text: 'child.info({ user: { id, plan } }, \'user context\')' },
  { text: 'child.info({ cart: { items, total } }, \'cart context\')' },
  { text: 'child.info({ payment: { method } }, \'payment context\')' },
  { text: 'child.info({ status: 200 }, \'request complete\')' },
]

const animatedOps = ref<number[]>(libs.map(() => 0))
const phase = ref<'idle' | 'racing' | 'collapsing' | 'collapsed' | 'hold'>('idle')
const linesShown = ref(0)
const linesCollapsed = ref(false)
const prefersReducedMotion = ref(false)
const wrapperRef = ref<HTMLElement>()

function resetState() {
  animatedOps.value = libs.map(() => 0)
  linesShown.value = 0
  linesCollapsed.value = false
  phase.value = 'idle'
}

const RACE_AT = 250
const RACE_DURATION = 1600
const RACE_STEPS = 32
const PINO_AT = RACE_AT + RACE_DURATION + 400
const PINO_INTERVAL = 350
const COLLAPSE_AT = PINO_AT + pinoLines.length * PINO_INTERVAL + 400
const TAIL_HOLD = 4500

function buildEvents(): TimedEvent[] {
  const events: TimedEvent[] = []

  events.push({ at: RACE_AT - 50, run: () => {
    phase.value = 'racing' 
  } })

  for (let s = 1; s <= RACE_STEPS; s++) {
    const t = s / RACE_STEPS
    const eased = 1 - Math.pow(1 - t, 3)
    events.push({
      at: RACE_AT + (s / RACE_STEPS) * RACE_DURATION,
      run: () => {
        animatedOps.value = libs.map(l => Math.round(l.ops * eased))
      },
    })
  }

  pinoLines.forEach((_, i) => {
    events.push({
      at: PINO_AT + i * PINO_INTERVAL,
      run: () => {
        linesShown.value = i + 1 
      },
    })
  })

  events.push({ at: COLLAPSE_AT, run: () => {
    phase.value = 'collapsing'
    linesCollapsed.value = true
  } })
  events.push({ at: COLLAPSE_AT + 400, run: () => {
    phase.value = 'collapsed' 
  } })
  events.push({ at: COLLAPSE_AT + TAIL_HOLD - 200, run: () => {
    phase.value = 'hold' 
  } })

  return events
}

const events = buildEvents()
const totalDuration = COLLAPSE_AT + TAIL_HOLD

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
    animatedOps.value = libs.map(l => l.ops)
    linesShown.value = pinoLines.length
    linesCollapsed.value = true
    phase.value = 'collapsed'
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

function formatOps(n: number) {
  if (n === 0) return 'n/a'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return `${n}`
}

const collapsed = computed(() => phase.value === 'collapsed' || phase.value === 'hold')
</script>

<template>
  <div class="not-prose my-8" data-section="bench-bar-race">
    <div ref="wrapperRef" class="overflow-hidden border border-muted bg-default">
      <div class="flex items-center gap-2 border-b border-muted px-4 py-2">
        <div class="flex gap-1.5">
          <div class="size-3 rounded-full bg-accented" />
          <div class="size-3 rounded-full bg-accented" />
          <div class="size-3 rounded-full bg-accented" />
        </div>
        <span class="ml-3 font-mono text-xs text-dimmed">wide event lifecycle · ops/sec</span>
        <span class="text-dimmed">·</span>
        <span
          class="font-mono text-[10px] tracking-widest uppercase transition-colors duration-300"
          :class="collapsed ? 'text-primary' : 'text-amber-400'"
        >
          {{ collapsed ? 'one event' : 'measuring' }}
        </span>
        <div class="ml-auto hidden md:flex items-center gap-1.5 font-mono text-[9px] tracking-widest text-dimmed">
          <UIcon name="i-lucide-gauge" class="size-3 text-primary" />
          <span>vitest bench · macbook</span>
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

      <div class="grid gap-px bg-muted/40 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div class="bg-default p-4 sm:p-5">
          <div class="flex items-center gap-2 mb-3">
            <UIcon name="i-lucide-flag" class="size-3 text-primary" />
            <span class="font-mono text-[10px] tracking-widest uppercase text-dimmed">throughput</span>
            <span class="ml-auto font-mono text-[9px] text-dimmed">create + 3× set + emit</span>
          </div>

          <div class="space-y-2.5">
            <div
              v-for="(lib, i) in libs"
              :key="lib.id"
              class="font-mono text-[11px]"
            >
              <div class="flex items-baseline gap-2 mb-1">
                <span class="w-16" :class="lib.accent">{{ lib.name }}</span>
                <span class="text-dimmed text-[10px]">{{ formatOps(animatedOps[i] ?? 0) }} ops/s</span>
                <span
                  v-if="lib.id === 'evlog' && collapsed"
                  class="ml-auto text-[9px] tracking-widest uppercase text-primary"
                >
                  winner
                </span>
                <span
                  v-else-if="lib.multiplier && collapsed"
                  class="ml-auto text-[9px] tracking-widest uppercase text-dimmed"
                >
                  evlog {{ lib.multiplier }} faster
                </span>
              </div>
              <div class="h-2.5 w-full overflow-hidden border border-muted/60">
                <div
                  class="h-full transition-[width] duration-200 ease-out"
                  :class="lib.ringColor"
                  :style="{ width: `${Math.min(100, ((animatedOps[i] ?? 0) / MAX_OPS) * 100)}%` }"
                />
              </div>
            </div>
          </div>

          <div class="mt-4 pt-3 border-t border-default/30 font-mono text-[10px] text-dimmed">
            <UIcon name="i-lucide-info" class="size-3 inline -mt-0.5 mr-1 text-primary/70" />
            consola has no equivalent (no wide-event API) — see the table below for fair scenarios.
          </div>
        </div>

        <div class="bg-default p-4 sm:p-5">
          <div class="flex items-center gap-2 mb-3">
            <UIcon name="i-lucide-shrink" class="size-3 text-primary" />
            <span class="font-mono text-[10px] tracking-widest uppercase text-dimmed">why · 4 lines → 1 event</span>
            <span class="ml-auto font-mono text-[9px]" :class="collapsed ? 'text-primary' : 'text-dimmed'">
              {{ collapsed ? '1 emit · 1 serialize' : `${linesShown} / 4 lines` }}
            </span>
          </div>

          <div class="space-y-1 font-mono text-[10px] mb-3">
            <div
              v-for="(line, i) in pinoLines"
              :key="i"
              class="flex items-baseline gap-2 transition-all duration-400"
              :class="[
                linesShown > i ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2',
                linesCollapsed ? 'opacity-20! grayscale line-through' : '',
              ]"
            >
              <UIcon name="i-lucide-package" class="size-3 text-amber-400/70 shrink-0" />
              <span class="text-muted truncate">{{ line.text }}</span>
            </div>
          </div>

          <div
            class="border bg-elevated/40 px-3 py-2 transition-all duration-500"
            :class="collapsed ? 'border-primary/30' : 'border-muted'"
          >
            <div class="flex items-center gap-1.5 mb-1.5">
              <UIcon name="i-lucide-package-check" class="size-3 text-primary" />
              <span class="font-mono text-[9px] tracking-widest uppercase text-dimmed">evlog wide event</span>
            </div>
            <pre class="font-mono text-[10px] leading-relaxed text-muted overflow-x-auto"><code>{
  <span class="text-sky-400">user</span>:    { id, plan },
  <span class="text-sky-400">cart</span>:    { items, total },
  <span class="text-sky-400">payment</span>: { method },
  <span class="text-sky-400">status</span>:  <span class="text-pink-400">200</span>
}</code></pre>
          </div>

          <div
            class="mt-3 pt-3 border-t border-default/30 font-mono text-[10px] flex items-center gap-3 transition-opacity duration-500"
            :class="collapsed ? 'opacity-100' : 'opacity-50'"
          >
            <span class="inline-flex items-center gap-1.5">
              <UIcon name="i-lucide-trending-down" class="size-3 text-emerald-400" />
              <span class="text-emerald-400">75%</span>
              <span class="text-dimmed">less data on the wire</span>
            </span>
            <span class="ml-auto inline-flex items-center gap-1.5 text-dimmed">
              <UIcon name="i-lucide-database" class="size-3" />
              <span>1 row to query</span>
            </span>
          </div>
        </div>
      </div>

      <div class="border-t border-muted/50 px-4 py-3 grid grid-cols-3 gap-3 font-mono text-[10px]">
        <div class="flex flex-col gap-0.5">
          <span class="text-dimmed text-[9px] tracking-widest uppercase">vs pino</span>
          <span class="text-primary">7.7× faster</span>
        </div>
        <div class="flex flex-col gap-0.5 text-center">
          <span class="text-dimmed text-[9px] tracking-widest uppercase">vs winston</span>
          <span class="text-primary">14.1× faster</span>
        </div>
        <div class="flex flex-col gap-0.5 text-right">
          <span class="text-dimmed text-[9px] tracking-widest uppercase">Benchmarks</span>
          <span class="text-emerald-400">open source · reproducible</span>
        </div>
      </div>
    </div>
  </div>
</template>
