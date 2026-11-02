<script setup lang="ts">
import type { TimedEvent } from '~/composables/useTimedSequence'

interface BrowserEvent {
  id: string
  level: 'info' | 'warn' | 'error'
  action: string
  meta?: string
}

const browserEvents: BrowserEvent[] = [
  { id: '1', level: 'info', action: 'page_view', meta: '/products' },
  { id: '2', level: 'info', action: 'click', meta: '#add-to-cart' },
  { id: '3', level: 'warn', action: 'image_slow', meta: '/hero.png 4.2s' },
  { id: '4', level: 'error', action: 'api_failed', meta: 'POST /checkout 500' },
  { id: '5', level: 'info', action: 'cart_update', meta: 'items: 3' },
]

type Phase = 'idle' | 'queueing' | 'trigger' | 'flying' | 'received' | 'processed'

const phase = ref<Phase>('idle')
const queueRevealed = ref<boolean[]>(browserEvents.map(() => false))
const serverReceived = ref<boolean[]>(browserEvents.map(() => false))
const prefersReducedMotion = ref(false)
const wrapperRef = ref<HTMLElement>()

function resetState() {
  phase.value = 'idle'
  queueRevealed.value = browserEvents.map(() => false)
  serverReceived.value = browserEvents.map(() => false)
}

const QUEUE_AT = 200
const QUEUE_INTERVAL = 700
const TRIGGER_AT = QUEUE_AT + browserEvents.length * QUEUE_INTERVAL + 600
const FLY_AT = TRIGGER_AT + 700
const RECEIVE_AT = FLY_AT + 600
const SERVER_INTERVAL = 250
const PROCESSED_AT = RECEIVE_AT + browserEvents.length * SERVER_INTERVAL + 300
const TAIL_HOLD = 4000

function buildEvents(): TimedEvent[] {
  const events: TimedEvent[] = []

  events.push({
    at: QUEUE_AT - 100,
    run: () => {
      phase.value = 'queueing'
    },
  })

  browserEvents.forEach((_, i) => {
    events.push({
      at: QUEUE_AT + i * QUEUE_INTERVAL,
      run: () => {
        queueRevealed.value = queueRevealed.value.map((v, idx) => idx === i ? true : v)
      },
    })
  })

  events.push({
    at: TRIGGER_AT,
    run: () => {
      phase.value = 'trigger'
    },
  })

  events.push({
    at: FLY_AT,
    run: () => {
      phase.value = 'flying'
    },
  })

  events.push({
    at: RECEIVE_AT - 100,
    run: () => {
      phase.value = 'received'
    },
  })

  browserEvents.forEach((_, i) => {
    events.push({
      at: RECEIVE_AT + i * SERVER_INTERVAL,
      run: () => {
        serverReceived.value = serverReceived.value.map((v, idx) => idx === i ? true : v)
      },
    })
  })

  events.push({
    at: PROCESSED_AT,
    run: () => {
      phase.value = 'processed'
    },
  })

  return events
}

const events = buildEvents()
const totalDuration = PROCESSED_AT + TAIL_HOLD

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
    queueRevealed.value = browserEvents.map(() => true)
    serverReceived.value = browserEvents.map(() => true)
    phase.value = 'processed'
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
  if (level === 'error') return 'text-rose-400'
  if (level === 'warn') return 'text-amber-400'
  return 'text-sky-400'
}

const queueCount = computed(() => queueRevealed.value.filter(Boolean).length)
const sentCount = computed(() => serverReceived.value.filter(Boolean).length)
const showTrigger = computed(() => phase.value === 'trigger' || phase.value === 'flying' || phase.value === 'received' || phase.value === 'processed')
const isFlying = computed(() => phase.value === 'flying')
const isReceived = computed(() => phase.value === 'received' || phase.value === 'processed')
</script>

<template>
  <div class="not-prose my-8" data-section="client-server-beacon">
    <div ref="wrapperRef" class="overflow-hidden border border-muted bg-default">
      <div class="flex items-center gap-2 border-b border-muted px-4 py-2.5">
        <UIcon name="i-lucide-radio-tower" class="size-3.5 text-primary" />
        <span class="font-mono text-xs text-dimmed">client → server transport</span>
        <span class="text-dimmed">·</span>
        <span class="font-mono text-[10px] tracking-widest uppercase transition-colors duration-300" :class="phase === 'processed' ? 'text-primary' : phase === 'flying' || phase === 'received' ? 'text-amber-400' : 'text-dimmed'">
          {{ phase === 'idle' ? 'idle' : phase === 'queueing' ? 'queueing' : phase === 'trigger' ? 'pagehide' : phase === 'flying' ? 'beaconing' : phase === 'received' ? 'ingesting' : 'drained' }}
        </span>
        <div class="ml-auto hidden sm:flex items-center gap-1.5 font-mono text-[9px] tracking-widest text-dimmed">
          <span>fetch · keepalive: true</span>
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

      <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-px bg-muted/40">
        <div class="bg-default px-4 py-4">
          <div class="flex items-center gap-2 mb-3">
            <UIcon name="i-lucide-globe" class="size-3.5 text-sky-400" />
            <span class="font-mono text-[10px] tracking-widest uppercase text-dimmed">browser</span>
            <span class="ml-auto font-mono text-[10px] text-muted">queue · {{ queueCount }}</span>
          </div>

          <div class="border border-muted bg-elevated/30 px-3 py-2.5 min-h-[200px]">
            <div class="space-y-1.5 font-mono text-[10px] sm:text-[11px]">
              <div
                v-for="(event, i) in browserEvents"
                :key="event.id"
                class="flex items-baseline gap-2 transition-all duration-400"
                :class="[
                  queueRevealed[i] ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2',
                  phase === 'flying' || phase === 'received' || phase === 'processed' ? 'opacity-30! grayscale' : '',
                ]"
              >
                <span class="text-dimmed/60 shrink-0">[{{ event.id }}]</span>
                <span class="shrink-0" :class="levelClass(event.level)">{{ event.level }}</span>
                <span class="text-muted truncate">{{ event.action }}</span>
                <span class="hidden sm:inline text-dimmed/60 truncate">{{ event.meta }}</span>
              </div>
            </div>
          </div>

          <div class="mt-3 flex items-center gap-2 font-mono text-[9px] text-dimmed transition-opacity duration-300" :class="showTrigger ? 'opacity-100' : 'opacity-0'">
            <UIcon name="i-lucide-zap" class="size-3 text-amber-400 animate-pulse" />
            <span class="text-amber-400">window.addEventListener('pagehide')</span>
          </div>
        </div>

        <div class="bg-default px-3 py-4 flex flex-col items-center justify-center min-h-[120px] lg:min-w-[180px]">
          <div class="hidden lg:flex flex-col items-center gap-3 w-full">
            <div class="text-center font-mono text-[9px] tracking-widest uppercase text-dimmed">
              POST /api/_evlog/ingest
            </div>
            <div class="relative w-full h-px bg-muted/60 overflow-hidden">
              <div
                class="absolute h-px bg-linear-to-r from-transparent via-primary to-transparent transition-transform"
                :style="{
                  width: '60%',
                  transform: isFlying ? 'translateX(80%)' : 'translateX(-80%)',
                  transitionDuration: isFlying ? '500ms' : '0ms',
                }"
                aria-hidden="true"
              />
            </div>
            <div
              class="border bg-default px-2 py-1 transition-all duration-500"
              :class="phase === 'flying' ? 'border-primary/50 scale-110' : phase === 'received' || phase === 'processed' ? 'border-emerald-500/40' : 'border-muted'"
            >
              <div class="font-mono text-[10px] text-muted flex items-center gap-1.5">
                <UIcon name="i-lucide-package" class="size-3" :class="phase === 'flying' ? 'text-primary' : phase === 'received' || phase === 'processed' ? 'text-emerald-400' : 'text-dimmed'" />
                <span>batch · {{ browserEvents.length }} events</span>
              </div>
            </div>
            <div class="text-center font-mono text-[9px] text-dimmed">
              fetch · keepalive
            </div>
          </div>

          <div class="lg:hidden flex items-center gap-2 font-mono text-[10px] text-muted">
            <UIcon name="i-lucide-arrow-down" class="size-3 text-primary" />
            <span>POST /api/_evlog/ingest</span>
          </div>
        </div>

        <div class="bg-default px-4 py-4">
          <div class="flex items-center gap-2 mb-3">
            <UIcon name="i-lucide-server" class="size-3.5 text-emerald-400" />
            <span class="font-mono text-[10px] tracking-widest uppercase text-dimmed">server · /api/_evlog/ingest</span>
            <span class="ml-auto font-mono text-[10px] text-muted">ingested · {{ sentCount }}</span>
          </div>

          <div
            class="border bg-elevated/30 px-3 py-2.5 transition-colors duration-500 min-h-[200px]"
            :class="isReceived ? 'border-emerald-500/30' : 'border-muted'"
          >
            <div class="space-y-1.5 font-mono text-[10px] sm:text-[11px]">
              <div
                v-for="(event, i) in browserEvents"
                :key="`s-${event.id}`"
                class="flex items-baseline gap-2 transition-all duration-300"
                :class="serverReceived[i] ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2'"
              >
                <UIcon name="i-lucide-check" class="size-2.5 text-emerald-400 shrink-0 self-center" />
                <span class="shrink-0" :class="levelClass(event.level)">{{ event.level }}</span>
                <span class="text-muted truncate">{{ event.action }}</span>
                <span class="hidden sm:inline text-primary text-[9px] shrink-0 ml-auto">+identity</span>
              </div>
            </div>
          </div>

          <div class="mt-3 flex items-center gap-2 font-mono text-[9px] text-dimmed transition-opacity duration-300" :class="phase === 'processed' ? 'opacity-100' : 'opacity-0'">
            <UIcon name="i-lucide-check-circle" class="size-3 text-emerald-400" />
            <span class="text-emerald-400">drain pipeline · same as server-side wide events</span>
          </div>
        </div>
      </div>

      <div class="border-t border-muted/50 px-4 py-3 grid grid-cols-3 gap-3 font-mono text-[10px]">
        <div class="flex flex-col gap-0.5">
          <span class="text-dimmed text-[9px] tracking-widest uppercase">batched</span>
          <span class="text-amber-400">{{ browserEvents.length }} events</span>
        </div>
        <div class="flex flex-col gap-0.5 text-center">
          <span class="text-dimmed text-[9px] tracking-widest uppercase">requests</span>
          <span class="text-emerald-400">1 <span class="text-dimmed">vs {{ browserEvents.length }} individual</span></span>
        </div>
        <div class="flex flex-col gap-0.5 text-right">
          <span class="text-dimmed text-[9px] tracking-widest uppercase">survives unload</span>
          <span class="text-primary">keepalive ✓</span>
        </div>
      </div>
    </div>
  </div>
</template>
