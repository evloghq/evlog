<script setup lang="ts">
import type { TimedEvent } from '~/composables/useTimedSequence'

type FrameType = 'hello' | 'replay' | 'event' | 'ping'

interface Frame {
  type: FrameType
  preview: string
}

const frames: Frame[] = [
  { type: 'hello', preview: 'pid: 84321, version: "2.16.0"' },
  { type: 'replay', preview: 'POST /login → 200' },
  { type: 'replay', preview: 'GET / → 200' },
  { type: 'event', preview: 'POST /checkout → 200' },
  { type: 'event', preview: 'GET /cart → 200' },
  { type: 'ping', preview: 'ts: 1746796800123' },
  { type: 'event', preview: 'POST /api/email → 500' },
]

const visible = ref<boolean[]>(frames.map(() => false))
const connected = ref(false)
const prefersReducedMotion = ref(false)
const wrapperRef = ref<HTMLElement>()

function resetState() {
  visible.value = frames.map(() => false)
  connected.value = false
}

const CONNECT_AT_MS = 200
const FIRST_FRAME_DELAY_MS = 200
const FRAME_INTERVAL_MS = 550
const TAIL_HOLD_MS = 3500

function buildEvents(): TimedEvent[] {
  const events: TimedEvent[] = []

  events.push({ at: CONNECT_AT_MS, run: () => {
    connected.value = true
  } })

  frames.forEach((_, i) => {
    events.push({
      at: CONNECT_AT_MS + FIRST_FRAME_DELAY_MS + i * FRAME_INTERVAL_MS,
      run: () => {
        visible.value = visible.value.map((v, idx) => (idx === i ? true : v))
      },
    })
  })

  return events
}

const events = buildEvents()
const lastFrameAt = CONNECT_AT_MS + FIRST_FRAME_DELAY_MS + frames.length * FRAME_INTERVAL_MS
const totalDuration = lastFrameAt + TAIL_HOLD_MS

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
    visible.value = frames.map(() => true)
    connected.value = true
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

function frameTypeClass(t: FrameType): string {
  switch (t) {
    case 'hello': return 'text-primary border-primary/30'
    case 'replay': return 'text-amber-400 border-amber-500/30'
    case 'event': return 'text-emerald-400 border-emerald-500/30'
    case 'ping': return 'text-dimmed border-muted'
  }
}

const eventCount = computed(() => visible.value.filter((v, i) => v && frames[i]?.type === 'event').length)
const replayCount = computed(() => visible.value.filter((v, i) => v && frames[i]?.type === 'replay').length)
</script>

<template>
  <div class="not-prose my-8" data-section="sse-wire">
    <div ref="wrapperRef" class="overflow-hidden border border-muted bg-default">
      <div class="flex items-center gap-2 border-b border-muted px-3 py-2">
        <UIcon name="i-lucide-radio" class="size-3 text-primary" />
        <span class="font-mono text-[11px] text-dimmed">GET /sse</span>
        <span class="text-dimmed text-[10px]">·</span>
        <span class="font-mono text-[9px] tracking-widest uppercase transition-colors duration-300" :class="connected ? 'text-emerald-500' : 'text-dimmed'">
          {{ connected ? 'open' : 'connecting' }}
        </span>
        <div class="ml-auto hidden sm:flex items-center gap-1.5 font-mono text-[9px] tracking-widest text-dimmed">
          <span>text/event-stream</span>
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

      <div class="px-3 py-2.5 font-mono text-[10px] leading-snug">
        <div class="space-y-1">
          <div
            v-for="(frame, i) in frames"
            :key="i"
            class="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-2 transition-all duration-200 h-[18px]"
            :class="visible[i] ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-1'"
          >
            <span
              class="font-mono text-[9px] tracking-widest uppercase border px-1 py-0.5 text-center transition-colors duration-300"
              :class="frameTypeClass(frame.type)"
            >
              {{ frame.type }}
            </span>
            <div class="text-muted truncate">
              <span class="text-dimmed">data:</span>
              <span class="text-dimmed ml-1">{ </span>
              <span class="text-sky-400">type</span><span class="text-dimmed">:</span><span class="text-emerald-400">"{{ frame.type }}"</span><span class="text-dimmed">, </span>
              <span class="text-sky-400">data</span><span class="text-dimmed">:</span><span class="text-muted ml-0.5">{{ '{ ' + frame.preview + ' }' }}</span>
              <span class="text-dimmed"> }</span>
            </div>
          </div>
        </div>
      </div>

      <div class="border-t border-muted/50 px-3 py-2 grid grid-cols-4 gap-2 font-mono text-[9px]">
        <div class="flex items-center gap-1.5">
          <span class="text-dimmed tracking-widest uppercase">connect</span>
          <span :class="connected ? 'text-emerald-500' : 'text-dimmed'" class="ml-auto">
            {{ connected ? '200' : '…' }}
          </span>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="text-dimmed tracking-widest uppercase">replay</span>
          <span class="text-amber-400 tabular-nums ml-auto">{{ replayCount }}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="text-dimmed tracking-widest uppercase">events</span>
          <span class="text-emerald-400 tabular-nums ml-auto">{{ eventCount }}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="text-dimmed tracking-widest uppercase">heartbeat</span>
          <span class="text-dimmed ml-auto">30s</span>
        </div>
      </div>
    </div>
  </div>
</template>
