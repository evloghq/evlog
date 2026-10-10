<script setup lang="ts">
import type { TimedEvent } from '~/composables/useTimedSequence'

interface NarrowLine {
  ts: string
  level: 'INFO' | 'DEBUG' | 'WARN'
  msg: string
  meta?: string
  fieldKey: string
  fieldValue: string
  fieldType: 'string' | 'number' | 'object'
}

const lines: NarrowLine[] = [
  { ts: '10:23:45.001', level: 'INFO', msg: 'request started', meta: 'method=POST path=/api/checkout', fieldKey: 'method', fieldValue: '"POST"', fieldType: 'string' },
  { ts: '10:23:45.012', level: 'INFO', msg: 'authenticated', meta: 'userId=42 plan=pro', fieldKey: 'user', fieldValue: '{ id: 42, plan: "pro" }', fieldType: 'object' },
  { ts: '10:23:45.024', level: 'DEBUG', msg: 'db query', meta: 'cart WHERE userId=42 (12ms)', fieldKey: 'cart', fieldValue: '{ items: 3, total: 9999 }', fieldType: 'object' },
  { ts: '10:23:45.069', level: 'INFO', msg: 'stripe charge', meta: 'amount=9999 ok', fieldKey: 'charge', fieldValue: '{ id: "ch_…", amount: 9999 }', fieldType: 'object' },
  { ts: '10:23:45.180', level: 'INFO', msg: 'order created', meta: 'order_id=ord_889', fieldKey: 'order', fieldValue: '{ id: "ord_889" }', fieldType: 'object' },
  { ts: '10:23:45.234', level: 'INFO', msg: 'response sent', meta: 'status=200 (234ms)', fieldKey: 'duration', fieldValue: '234', fieldType: 'number' },
]

type Phase = 'idle' | 'narrating' | 'collapsing' | 'wide'

const lineRevealed = ref<boolean[]>(lines.map(() => false))
const lineCollapsed = ref<boolean[]>(lines.map(() => false))
const fieldRevealed = ref<boolean[]>(lines.map(() => false))
const phase = ref<Phase>('idle')
const prefersReducedMotion = ref(false)
const wrapperRef = ref<HTMLElement>()

function resetState() {
  lineRevealed.value = lines.map(() => false)
  lineCollapsed.value = lines.map(() => false)
  fieldRevealed.value = lines.map(() => false)
  phase.value = 'idle'
}

const NARRATE_AT = 200
const NARRATE_INTERVAL = 480
const NARRATE_HOLD = 900
const COLLAPSE_INTERVAL = 380
const COLLAPSE_HOLD = 200
const TAIL_HOLD = 4000

function buildEvents(): TimedEvent[] {
  const events: TimedEvent[] = []

  events.push({
    at: NARRATE_AT - 50,
    run: () => {
      phase.value = 'narrating'
    },
  })

  lines.forEach((_, i) => {
    events.push({
      at: NARRATE_AT + i * NARRATE_INTERVAL,
      run: () => {
        lineRevealed.value = lineRevealed.value.map((v, idx) => idx === i ? true : v)
      },
    })
  })

  const collapseStart = NARRATE_AT + lines.length * NARRATE_INTERVAL + NARRATE_HOLD

  events.push({
    at: collapseStart - 50,
    run: () => {
      phase.value = 'collapsing'
    },
  })

  lines.forEach((_, i) => {
    events.push({
      at: collapseStart + i * COLLAPSE_INTERVAL,
      run: () => {
        lineCollapsed.value = lineCollapsed.value.map((v, idx) => idx === i ? true : v)
        fieldRevealed.value = fieldRevealed.value.map((v, idx) => idx === i ? true : v)
      },
    })
  })

  const collapseEnd = collapseStart + lines.length * COLLAPSE_INTERVAL + COLLAPSE_HOLD

  events.push({
    at: collapseEnd,
    run: () => {
      phase.value = 'wide'
    },
  })

  return events
}

const events = buildEvents()
const totalDuration = NARRATE_AT + lines.length * NARRATE_INTERVAL + NARRATE_HOLD
  + lines.length * COLLAPSE_INTERVAL + COLLAPSE_HOLD + TAIL_HOLD

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
    lineRevealed.value = lines.map(() => true)
    lineCollapsed.value = lines.map(() => true)
    fieldRevealed.value = lines.map(() => true)
    phase.value = 'wide'
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

function levelClass(level: string) {
  if (level === 'WARN') return 'text-amber-400'
  if (level === 'DEBUG') return 'text-sky-400'
  return 'text-emerald-400'
}

function valueClass(type: NarrowLine['fieldType']) {
  if (type === 'number') return 'text-pink-400'
  if (type === 'object') return 'text-muted'
  return 'text-emerald-400'
}

const collapsedCount = computed(() => lineCollapsed.value.filter(Boolean).length)
</script>

<template>
  <div class="not-prose my-8" data-section="wide-event-collapse">
    <div ref="wrapperRef" class="overflow-hidden border border-muted bg-default">
      <div class="flex items-center gap-2 border-b border-muted px-4 py-2.5">
        <UIcon name="i-lucide-shrink" class="size-3.5 text-primary" />
        <span class="font-mono text-xs text-dimmed">narrow logs → wide event</span>
        <span class="text-dimmed">·</span>
        <span class="font-mono text-[10px] tracking-widest uppercase transition-colors duration-300" :class="phase === 'wide' ? 'text-primary' : phase === 'collapsing' ? 'text-amber-400' : 'text-dimmed'">
          {{ phase === 'wide' ? 'one row, one query' : phase === 'collapsing' ? 'collapsing…' : phase === 'narrating' ? 'recording' : 'idle' }}
        </span>
        <div class="ml-auto hidden sm:flex items-center gap-1.5 font-mono text-[9px] tracking-widest text-dimmed">
          <span>req_8a2c</span>
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

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-px bg-muted/40">
        <div class="bg-default px-4 sm:px-5 py-4">
          <div class="flex items-center gap-2 mb-3">
            <span class="font-mono text-[10px] tracking-widest uppercase text-dimmed">before</span>
            <span class="text-dimmed">·</span>
            <span class="font-mono text-[10px] text-muted">{{ lines.length }} narrow log lines</span>
            <span class="ml-auto font-mono text-[9px] tracking-widest uppercase text-dimmed">stdout</span>
          </div>

          <div class="space-y-1 font-mono text-[10px] sm:text-[11px] min-h-[180px]">
            <div
              v-for="(line, i) in lines"
              :key="line.ts"
              class="flex items-baseline gap-2 transition-all duration-400"
              :class="[
                lineRevealed[i] ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2',
                lineCollapsed[i] ? 'opacity-30! grayscale' : '',
              ]"
            >
              <span class="text-dimmed/60 shrink-0">{{ line.ts }}</span>
              <span class="shrink-0" :class="levelClass(line.level)">{{ line.level }}</span>
              <span class="text-muted truncate">{{ line.msg }}</span>
              <span class="hidden sm:inline text-dimmed/60 truncate">{{ line.meta }}</span>
            </div>
          </div>

          <div class="mt-3 pt-2 border-t border-default/30 flex items-center gap-2 font-mono text-[9px] text-dimmed">
            <UIcon name="i-lucide-search-x" class="size-3 text-amber-400/70" />
            <span>matching to one request needs IDs everywhere</span>
          </div>
        </div>

        <div class="bg-default px-4 sm:px-5 py-4 relative">
          <div class="flex items-center gap-2 mb-3">
            <span class="font-mono text-[10px] tracking-widest uppercase text-dimmed">after</span>
            <span class="text-dimmed">·</span>
            <span class="font-mono text-[10px] text-primary">1 wide event</span>
            <span class="ml-auto font-mono text-[9px] tracking-widest uppercase text-dimmed">drain</span>
          </div>

          <div
            class="border bg-elevated/30 px-3.5 py-3 transition-colors duration-500 min-h-[180px]"
            :class="phase === 'wide' ? 'border-primary/25' : 'border-muted'"
          >
            <pre class="font-mono text-[10px] sm:text-[11px] leading-relaxed text-muted overflow-x-auto"><code>{
  <span class="text-sky-400">requestId</span>: <span class="text-emerald-400">"req_8a2c"</span>,
  <span class="text-sky-400">status</span>:    <span class="text-pink-400">200</span>,
<template v-for="(line, i) in lines" :key="`f-${line.fieldKey}`"><span
  class="transition-all duration-500"
  :class="fieldRevealed[i] ? 'opacity-100' : 'opacity-0'"
>  <span class="text-sky-400">{{ line.fieldKey }}</span>: <span :class="valueClass(line.fieldType)">{{ line.fieldValue }}</span>{{ i < lines.length - 1 ? ',' : '' }}
</span></template>}</code></pre>
          </div>

          <div class="mt-3 pt-2 border-t border-default/30 flex items-center gap-2 font-mono text-[9px] text-dimmed">
            <UIcon name="i-lucide-search-check" class="size-3 text-emerald-400/80" />
            <span>filter on any field, no joins, no IDs to chase</span>
          </div>
        </div>
      </div>

      <div class="border-t border-muted/50 px-4 py-3 grid grid-cols-3 gap-3 font-mono text-[10px]">
        <div class="flex flex-col gap-0.5">
          <span class="text-dimmed text-[9px] tracking-widest uppercase">collapsed</span>
          <span class="text-amber-400">{{ collapsedCount }} <span class="text-dimmed">/ {{ lines.length }} lines</span></span>
        </div>
        <div class="flex flex-col gap-0.5 text-center">
          <span class="text-dimmed text-[9px] tracking-widest uppercase">emitted</span>
          <span class="text-primary">{{ phase === 'wide' ? '1 wide event' : '—' }}</span>
        </div>
        <div class="flex flex-col gap-0.5 text-right">
          <span class="text-dimmed text-[9px] tracking-widest uppercase">storage cost</span>
          <span class="text-emerald-400">{{ Math.round((1 / lines.length) * 100) }}% <span class="text-dimmed">vs narrow</span></span>
        </div>
      </div>
    </div>
  </div>
</template>
