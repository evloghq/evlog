<script setup lang="ts">
import type { TimedEvent } from '~/composables/useTimedSequence'

const BATCH_SIZE = 10
const RETRIES = [1000, 2000, 4000]

interface BufferEvent {
  id: number
  status: 'pending' | 'sent' | 'dropped'
}

const incoming = ref(0)
const buffer = ref<BufferEvent[]>([])
const flushedBatches = ref<number>(0)
const droppedCount = ref(0)
const retryStep = ref(-1)
const retryActive = ref(false)
const overflowed = ref(false)
const phase = ref<'idle' | 'filling' | 'flush-ok' | 'flush-fail' | 'overflow' | 'recovered' | 'hold'>('idle')
const prefersReducedMotion = ref(false)
const wrapperRef = ref<HTMLElement>()

function resetState() {
  incoming.value = 0
  buffer.value = []
  flushedBatches.value = 0
  droppedCount.value = 0
  retryStep.value = -1
  retryActive.value = false
  overflowed.value = false
  phase.value = 'idle'
}

const START_AT = 200
const ARRIVAL_INTERVAL = 110
const TOTAL_EVENTS_PHASE_1 = BATCH_SIZE
const FLUSH_AT_1 = START_AT + TOTAL_EVENTS_PHASE_1 * ARRIVAL_INTERVAL
const FLUSH_DURATION = 500

const PHASE_2_START = FLUSH_AT_1 + FLUSH_DURATION + 700
const PHASE_2_EVENTS = BATCH_SIZE
const FLUSH_AT_2 = PHASE_2_START + PHASE_2_EVENTS * ARRIVAL_INTERVAL
const RETRY_START = FLUSH_AT_2 + FLUSH_DURATION
const RETRY_INTERVAL = 700

const PHASE_3_START = RETRY_START + RETRIES.length * RETRY_INTERVAL + 700
const OVERFLOW_EVENTS = BATCH_SIZE + 4
const OVERFLOW_END = PHASE_3_START + OVERFLOW_EVENTS * ARRIVAL_INTERVAL
const FLUSH_AT_3 = OVERFLOW_END + 350
const TAIL_HOLD = 4000

function buildEvents(): TimedEvent[] {
  const events: TimedEvent[] = []
  let id = 0

  events.push({ at: START_AT - 50, run: () => {
    phase.value = 'filling' 
  } })

  for (let i = 1; i <= TOTAL_EVENTS_PHASE_1; i++) {
    const eventId = ++id
    events.push({
      at: START_AT + i * ARRIVAL_INTERVAL,
      run: () => {
        incoming.value = eventId
        buffer.value = [...buffer.value, { id: eventId, status: 'pending' }]
      },
    })
  }

  events.push({
    at: FLUSH_AT_1,
    run: () => {
      phase.value = 'flush-ok'
      buffer.value = buffer.value.map(e => ({ ...e, status: 'sent' }))
    },
  })
  events.push({
    at: FLUSH_AT_1 + FLUSH_DURATION,
    run: () => {
      flushedBatches.value++
      buffer.value = []
      phase.value = 'filling'
    },
  })

  for (let i = 1; i <= PHASE_2_EVENTS; i++) {
    const eventId = ++id
    events.push({
      at: PHASE_2_START + i * ARRIVAL_INTERVAL,
      run: () => {
        incoming.value = eventId
        buffer.value = [...buffer.value, { id: eventId, status: 'pending' }]
      },
    })
  }

  events.push({
    at: FLUSH_AT_2,
    run: () => {
      phase.value = 'flush-fail'
      retryActive.value = true
      retryStep.value = -1
    },
  })

  RETRIES.forEach((_, i) => {
    events.push({
      at: RETRY_START + i * RETRY_INTERVAL,
      run: () => {
        retryStep.value = i 
      },
    })
  })
  events.push({
    at: RETRY_START + RETRIES.length * RETRY_INTERVAL,
    run: () => {
      retryActive.value = false
      phase.value = 'recovered'
      flushedBatches.value++
      buffer.value = []
    },
  })

  events.push({ at: PHASE_3_START - 100, run: () => {
    phase.value = 'overflow' 
  } })
  for (let i = 1; i <= OVERFLOW_EVENTS; i++) {
    const eventId = ++id
    events.push({
      at: PHASE_3_START + i * ARRIVAL_INTERVAL,
      run: () => {
        incoming.value = eventId
        const next = [...buffer.value, { id: eventId, status: 'pending' as const }]
        if (next.length > BATCH_SIZE) {
          const overflow = next.length - BATCH_SIZE
          droppedCount.value += overflow
          overflowed.value = true
          buffer.value = next.slice(overflow)
        } else {
          buffer.value = next
        }
      },
    })
  }

  events.push({
    at: FLUSH_AT_3,
    run: () => {
      buffer.value = buffer.value.map(e => ({ ...e, status: 'sent' }))
    },
  })
  events.push({
    at: FLUSH_AT_3 + FLUSH_DURATION,
    run: () => {
      flushedBatches.value++
      buffer.value = []
      phase.value = 'hold'
    },
  })

  return events
}

const events = buildEvents()
const totalDuration = FLUSH_AT_3 + FLUSH_DURATION + TAIL_HOLD

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
    incoming.value = 24
    flushedBatches.value = 3
    droppedCount.value = 4
    overflowed.value = true
    phase.value = 'hold'
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

function statusLabel() {
  if (phase.value === 'overflow') return 'OVERFLOW'
  if (phase.value === 'flush-fail') return 'RETRYING'
  if (phase.value === 'flush-ok' || phase.value === 'recovered') return 'FLUSHING'
  if (phase.value === 'hold') return 'IDLE'
  return 'BUFFERING'
}

function statusClass() {
  if (phase.value === 'overflow') return 'text-rose-400'
  if (phase.value === 'flush-fail') return 'text-amber-400'
  if (phase.value === 'flush-ok' || phase.value === 'recovered') return 'text-primary'
  return 'text-dimmed'
}

const fillPct = computed(() => Math.min(100, (buffer.value.length / BATCH_SIZE) * 100))
</script>

<template>
  <div class="not-prose my-8" data-section="drain-pipeline-batching">
    <div ref="wrapperRef" class="overflow-hidden border border-muted bg-default">
      <div class="flex items-center gap-2 border-b border-muted px-4 py-2">
        <div class="flex gap-1.5">
          <div class="size-3 rounded-full bg-accented" />
          <div class="size-3 rounded-full bg-accented" />
          <div class="size-3 rounded-full bg-accented" />
        </div>
        <span class="ml-3 font-mono text-xs text-dimmed">drain pipeline · batch + retry</span>
        <span class="text-dimmed">·</span>
        <span
          class="font-mono text-[10px] tracking-widest uppercase transition-colors duration-300"
          :class="statusClass()"
        >
          {{ statusLabel() }}
        </span>
        <div class="ml-auto hidden md:flex items-center gap-1.5 font-mono text-[9px] tracking-widest text-dimmed">
          <UIcon name="i-lucide-workflow" class="size-3 text-primary" />
          <span>size={{ BATCH_SIZE }} · interval=5s</span>
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

      <div class="grid gap-px bg-muted/40 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.1fr)]">
        <div class="bg-default p-4 sm:p-5 min-h-[260px]">
          <div class="flex items-center gap-2 mb-3">
            <UIcon name="i-lucide-arrow-right" class="size-3 text-primary" />
            <span class="font-mono text-[10px] tracking-widest uppercase text-dimmed">app emits</span>
            <span class="ml-auto font-mono text-[9px] text-dimmed">#{{ incoming }}</span>
          </div>

          <div class="space-y-1.5 font-mono text-[10px]">
            <div
              v-for="i in Math.min(6, incoming)"
              :key="`recent-${incoming - i}`"
              class="flex items-center gap-2 transition-all duration-300"
              :style="{ opacity: 1 - (i - 1) * 0.18 }"
            >
              <UIcon name="i-lucide-package" class="size-3 text-emerald-400" />
              <span class="text-muted">log #{{ Math.max(0, incoming - i + 1) }}</span>
              <span class="ml-auto text-dimmed/60 text-[9px]">→ buffer</span>
            </div>
          </div>

          <div class="mt-4 pt-3 border-t border-default/30 font-mono text-[10px] text-dimmed">
            <UIcon name="i-lucide-info" class="size-3 inline -mt-0.5 mr-1 text-primary/70" />
            never blocks the response
          </div>
        </div>

        <div class="bg-default p-4 sm:p-5 min-h-[260px]">
          <div class="flex items-center gap-2 mb-3">
            <UIcon name="i-lucide-database" class="size-3 text-primary" />
            <span class="font-mono text-[10px] tracking-widest uppercase text-dimmed">in-memory buffer</span>
            <span class="ml-auto font-mono text-[9px]" :class="phase === 'overflow' ? 'text-rose-400' : 'text-dimmed'">
              {{ buffer.length }} / {{ BATCH_SIZE }}
            </span>
          </div>

          <div class="grid grid-cols-5 gap-1.5 mb-3">
            <div
              v-for="i in BATCH_SIZE"
              :key="i"
              class="h-8 border flex items-center justify-center font-mono text-[10px] transition-all duration-300"
              :class="i <= buffer.length
                ? (buffer[i - 1]?.status === 'sent'
                  ? 'border-primary/40 bg-primary/15 text-primary'
                  : (phase === 'flush-fail'
                    ? 'border-amber-400/40 bg-amber-400/10 text-amber-300'
                    : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300'))
                : 'border-muted/40 bg-muted/10 text-dimmed/40'"
            >
              {{ i <= buffer.length ? `#${buffer[i - 1]?.id ?? ''}` : '·' }}
            </div>
          </div>

          <div class="h-1.5 w-full overflow-hidden border border-muted/60 mb-2">
            <div
              class="h-full transition-[width] duration-200 ease-out"
              :class="phase === 'overflow' ? 'bg-rose-400/60' : 'bg-primary/60'"
              :style="{ width: `${fillPct}%` }"
            />
          </div>
          <div class="flex items-center justify-between font-mono text-[9px] text-dimmed">
            <span>fills until size or 5s interval</span>
            <span v-if="overflowed" class="text-rose-400">
              <UIcon name="i-lucide-trash-2" class="size-3 inline -mt-0.5 mr-0.5" />
              dropped {{ droppedCount }}
            </span>
          </div>
        </div>

        <div class="bg-default p-4 sm:p-5 min-h-[260px]">
          <div class="flex items-center gap-2 mb-3">
            <UIcon name="i-lucide-cloud-upload" class="size-3 text-primary" />
            <span class="font-mono text-[10px] tracking-widest uppercase text-dimmed">flush · http POST</span>
            <span class="ml-auto font-mono text-[9px] text-emerald-400">{{ flushedBatches }} ok</span>
          </div>

          <div class="space-y-2">
            <div
              v-if="phase === 'flush-ok' || phase === 'recovered' || (phase === 'hold' && flushedBatches > 0)"
              class="flex items-center gap-2 border border-primary/30 bg-primary/10 px-2.5 py-1.5 font-mono text-[10px]"
            >
              <UIcon name="i-lucide-check" class="size-3 text-primary" />
              <span class="text-default">batch #{{ flushedBatches }} sent</span>
              <span class="ml-auto text-primary text-[9px]">200 OK</span>
            </div>

            <div
              v-if="retryActive"
              class="border border-amber-400/30 bg-amber-500/5 px-2.5 py-2 font-mono text-[10px] space-y-1.5"
            >
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-rotate-cw" class="size-3 text-amber-400 animate-spin" />
                <span class="text-amber-300">drain failed · retrying</span>
                <span class="ml-auto text-amber-400 text-[9px]">503</span>
              </div>
              <div class="flex items-center gap-2 text-[9px] tracking-widest uppercase text-dimmed">
                <span>backoff</span>
                <span class="flex items-center gap-1.5">
                  <span
                    v-for="(delay, i) in RETRIES"
                    :key="i"
                    class="px-1.5 py-0.5 border transition-colors"
                    :class="retryStep >= i
                      ? 'border-amber-400/50 text-amber-300 bg-amber-400/10'
                      : 'border-muted/40 text-dimmed/60'"
                  >
                    {{ delay / 1000 }}s
                  </span>
                </span>
              </div>
            </div>

            <div
              v-if="phase === 'overflow'"
              class="border border-rose-400/30 bg-rose-500/5 px-2.5 py-1.5 font-mono text-[10px]"
            >
              <UIcon name="i-lucide-alert-triangle" class="size-3 inline -mt-0.5 mr-1 text-rose-400" />
              <span class="text-rose-300">buffer full · oldest dropped</span>
            </div>
          </div>

          <div class="mt-4 pt-3 border-t border-default/30 font-mono text-[10px] text-dimmed">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-life-buoy" class="size-3 text-primary/70" />
              <span>onDropped · maxBufferSize · drain.flush()</span>
            </div>
          </div>
        </div>
      </div>

      <div class="border-t border-muted/50 px-4 py-3 grid grid-cols-3 gap-3 font-mono text-[10px]">
        <div class="flex flex-col gap-0.5">
          <span class="text-dimmed text-[9px] tracking-widest uppercase">emitted</span>
          <span class="text-primary">{{ incoming }}</span>
        </div>
        <div class="flex flex-col gap-0.5 text-center">
          <span class="text-dimmed text-[9px] tracking-widest uppercase">batches sent</span>
          <span class="text-emerald-400">{{ flushedBatches }}</span>
        </div>
        <div class="flex flex-col gap-0.5 text-right">
          <span class="text-dimmed text-[9px] tracking-widest uppercase">dropped</span>
          <span :class="droppedCount > 0 ? 'text-rose-400' : 'text-dimmed'">{{ droppedCount }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
