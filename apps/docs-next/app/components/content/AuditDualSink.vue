<script setup lang="ts">
import type { TimedEvent } from '~/composables/useTimedSequence'

interface SourceEvent {
  id: string
  method: 'GET' | 'POST' | 'DELETE' | 'PATCH'
  path: string
  audit: boolean
  auditAction?: string
}

const sourceEvents: SourceEvent[] = [
  { id: '1', method: 'POST', path: '/api/checkout', audit: false },
  { id: '2', method: 'POST', path: '/api/refund', audit: true, auditAction: 'invoice.refund' },
  { id: '3', method: 'GET', path: '/api/me', audit: false },
  { id: '4', method: 'DELETE', path: '/api/account', audit: true, auditAction: 'user.delete' },
  { id: '5', method: 'PATCH', path: '/api/cart', audit: false },
]

type EventStage = 'queued' | 'active' | 'forked' | 'landed' | 'archived'

const eventStage = ref<EventStage[]>(sourceEvents.map(() => 'queued'))
const mainCount = ref(0)
const auditCount = ref(0)
const filteredCount = ref(0)
const activeIdx = ref(-1)
const prefersReducedMotion = ref(false)
const wrapperRef = ref<HTMLElement>()

function resetState() {
  eventStage.value = sourceEvents.map(() => 'queued')
  mainCount.value = 0
  auditCount.value = 0
  filteredCount.value = 0
  activeIdx.value = -1
}

const ENTER_AT = 300
const EVENT_INTERVAL = 2600
const FORK_DELAY = 600
const LAND_DELAY = 1300
const ARCHIVE_DELAY = 2000
const TAIL_HOLD = 4500

function buildEvents(): TimedEvent[] {
  const events: TimedEvent[] = []

  sourceEvents.forEach((event, i) => {
    const base = ENTER_AT + i * EVENT_INTERVAL

    events.push({
      at: base,
      run: () => {
        activeIdx.value = i
        eventStage.value = eventStage.value.map((s, idx) => idx === i ? 'active' : s)
      },
    })

    events.push({
      at: base + FORK_DELAY,
      run: () => {
        eventStage.value = eventStage.value.map((s, idx) => idx === i ? 'forked' : s)
      },
    })

    events.push({
      at: base + LAND_DELAY,
      run: () => {
        eventStage.value = eventStage.value.map((s, idx) => idx === i ? 'landed' : s)
        mainCount.value++
        if (event.audit) auditCount.value++
        else filteredCount.value++
      },
    })

    events.push({
      at: base + ARCHIVE_DELAY,
      run: () => {
        eventStage.value = eventStage.value.map((s, idx) => idx === i ? 'archived' : s)
      },
    })
  })

  return events
}

const events = buildEvents()
const totalDuration = ENTER_AT + sourceEvents.length * EVENT_INTERVAL + TAIL_HOLD

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
    eventStage.value = sourceEvents.map(() => 'archived')
    mainCount.value = sourceEvents.length
    auditCount.value = sourceEvents.filter(e => e.audit).length
    filteredCount.value = sourceEvents.length - auditCount.value
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

function methodColor(method: string) {
  switch (method) {
    case 'POST': return 'text-violet-400'
    case 'GET': return 'text-sky-400'
    case 'PATCH': return 'text-amber-400'
    case 'DELETE': return 'text-rose-400'
    default: return 'text-muted'
  }
}

const activeEvent = computed(() => activeIdx.value >= 0 ? sourceEvents[activeIdx.value] : null)
const activeStage = computed<EventStage>(() => activeIdx.value >= 0 ? (eventStage.value[activeIdx.value] ?? 'queued') : 'queued')
const isForked = computed(() => activeStage.value === 'forked' || activeStage.value === 'landed' || activeStage.value === 'archived')
const isLanded = computed(() => activeStage.value === 'landed' || activeStage.value === 'archived')

const recentMain = computed(() =>
  sourceEvents.filter((_, i) => {
    const stage = eventStage.value[i]
    return stage === 'landed' || stage === 'archived'
  }).slice(-3),
)
const recentAudit = computed(() =>
  sourceEvents.filter((event, i) => {
    const stage = eventStage.value[i]
    return event.audit && (stage === 'landed' || stage === 'archived')
  }).slice(-3),
)
</script>

<template>
  <div class="not-prose my-8" data-section="audit-dual-sink">
    <div ref="wrapperRef" class="overflow-hidden border border-muted bg-default">
      <div class="flex items-center gap-2 border-b border-muted px-4 py-2.5">
        <UIcon name="i-lucide-git-fork" class="size-3.5 text-primary" />
        <span class="font-mono text-xs text-dimmed">drain pipeline</span>
        <span class="text-dimmed">·</span>
        <span class="font-mono text-[10px] tracking-widest uppercase text-primary">
          two drains, one event
        </span>
        <div class="ml-auto hidden sm:flex items-center gap-1.5 font-mono text-[9px] tracking-widest text-dimmed">
          <span>evlog:drain × 2</span>
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

      <div class="px-4 sm:px-6 pt-5 pb-3">
        <div class="flex items-center gap-2 mb-2 font-mono text-[9px] tracking-widest uppercase text-dimmed">
          <UIcon name="i-lucide-package" class="size-3 text-primary" />
          <span>active wide event</span>
        </div>

        <div
          class="relative border bg-elevated/30 transition-colors duration-300 min-h-[68px] flex items-center px-3.5 py-3"
          :class="activeEvent?.audit ? 'border-primary/25' : 'border-muted'"
        >
          <Transition
            enter-active-class="transition duration-300 ease-out"
            enter-from-class="opacity-0 -translate-x-2"
            enter-to-class="opacity-100 translate-x-0"
            leave-active-class="transition duration-200 ease-in"
            leave-from-class="opacity-100"
            leave-to-class="opacity-0"
            mode="out-in"
          >
            <div
              v-if="activeEvent"
              :key="activeEvent.id"
              class="flex items-center gap-3 font-mono text-[11px] sm:text-xs min-w-0 w-full"
            >
              <UIcon
                v-if="activeEvent.audit"
                name="i-lucide-shield"
                class="size-4 text-primary shrink-0"
              />
              <UIcon
                v-else
                name="i-lucide-circle"
                class="size-4 text-dimmed/50 shrink-0"
              />
              <span class="text-dimmed shrink-0">#{{ activeEvent.id }}</span>
              <span class="shrink-0" :class="methodColor(activeEvent.method)">{{ activeEvent.method }}</span>
              <span class="text-muted truncate">{{ activeEvent.path }}</span>
              <span
                v-if="activeEvent.audit && activeEvent.auditAction"
                class="hidden sm:inline ml-auto text-primary text-[10px]"
              >
                audit: {{ activeEvent.auditAction }}
              </span>
            </div>
            <div v-else class="text-dimmed text-xs">
              waiting for events…
            </div>
          </Transition>
          <span
            aria-hidden="true"
            class="absolute -bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-default border font-mono text-[9px] tracking-widest transition-colors duration-300"
            :class="activeEvent?.audit ? 'text-primary border-primary/30' : 'text-dimmed border-muted'"
          >
            {{ activeEvent?.audit ? 'AUDIT' : 'WIDE EVENT' }}
          </span>
        </div>
      </div>

      <div class="relative h-12 sm:h-14 mx-4 sm:mx-6 -mt-1" aria-hidden="true">
        <svg class="w-full h-full" viewBox="0 0 400 56" preserveAspectRatio="none">
          <path
            d="M 200 0 L 200 14 Q 200 28 180 28 L 110 28 Q 90 28 90 42 L 90 56"
            stroke="currentColor"
            stroke-width="1"
            fill="none"
            class="text-muted/60"
          />
          <path
            d="M 200 0 L 200 14 Q 200 28 220 28 L 290 28 Q 310 28 310 42 L 310 56"
            stroke="currentColor"
            stroke-width="1"
            fill="none"
            class="text-muted/60"
          />
          <path
            v-if="isForked"
            d="M 200 0 L 200 14 Q 200 28 180 28 L 110 28 Q 90 28 90 42 L 90 56"
            stroke="currentColor"
            stroke-width="1.5"
            fill="none"
            class="text-emerald-400/80 transition-opacity duration-300"
          />
          <path
            v-if="isForked && activeEvent?.audit"
            d="M 200 0 L 200 14 Q 200 28 220 28 L 290 28 Q 310 28 310 42 L 310 56"
            stroke="currentColor"
            stroke-width="1.5"
            fill="none"
            class="text-primary transition-opacity duration-300"
          />
          <path
            v-else-if="isForked && !activeEvent?.audit"
            d="M 200 0 L 200 14 Q 200 28 220 28 L 290 28 Q 310 28 310 42 L 310 56"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-dasharray="3 4"
            fill="none"
            class="text-rose-400/60 transition-opacity duration-300"
          />
        </svg>
        <div
          v-if="isForked && !activeEvent?.audit"
          class="absolute right-[18%] top-1/2 -translate-y-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-default border border-rose-400/40 font-mono text-[8px] tracking-widest uppercase text-rose-400"
        >
          filtered
        </div>
      </div>

      <div class="grid grid-cols-2 gap-px bg-muted/40 border-t border-muted">
        <div class="bg-default px-3 sm:px-4 py-3.5">
          <div class="flex items-center gap-2 mb-2">
            <UIcon name="i-lucide-database" class="size-3.5 text-emerald-400" />
            <span class="font-mono text-[10px] tracking-widest uppercase text-dimmed">main drain</span>
            <span
              v-if="isLanded"
              aria-hidden="true"
              class="ml-auto relative flex size-1.5"
            >
              <span class="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400/60" />
              <span class="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
            </span>
          </div>
          <div class="font-mono text-[10px] sm:text-[11px] text-muted mb-2">
            createAxiomDrain()
          </div>
          <div class="flex items-baseline gap-1.5 mb-2.5">
            <span class="font-mono text-lg sm:text-xl text-emerald-400">{{ mainCount }}</span>
            <span class="font-mono text-[10px] text-dimmed">events ingested</span>
          </div>
          <ul class="space-y-1 font-mono text-[10px] min-h-[60px]">
            <li
              v-for="event in recentMain"
              :key="`m-${event.id}`"
              class="flex items-center gap-1.5 text-muted min-w-0"
            >
              <UIcon name="i-lucide-check" class="size-2.5 text-emerald-400 shrink-0" />
              <span class="shrink-0" :class="methodColor(event.method)">{{ event.method }}</span>
              <span class="text-dimmed truncate">{{ event.path }}</span>
            </li>
          </ul>
        </div>

        <div class="bg-default px-3 sm:px-4 py-3.5">
          <div class="flex items-center gap-2 mb-2">
            <UIcon name="i-lucide-shield-check" class="size-3.5 text-primary" />
            <span class="font-mono text-[10px] tracking-widest uppercase text-dimmed">audit drain</span>
            <span
              v-if="isLanded && activeEvent?.audit"
              aria-hidden="true"
              class="ml-auto relative flex size-1.5"
            >
              <span class="absolute inline-flex size-full animate-ping rounded-full bg-primary/60" />
              <span class="relative inline-flex size-1.5 rounded-full bg-primary" />
            </span>
          </div>
          <div class="font-mono text-[10px] sm:text-[11px] text-muted mb-2 truncate">
            auditOnly(signed(fs))
          </div>
          <div class="flex items-baseline gap-1.5 mb-2.5">
            <span class="font-mono text-lg sm:text-xl text-primary">{{ auditCount }}</span>
            <span class="font-mono text-[10px] text-dimmed">audits sealed</span>
          </div>
          <ul class="space-y-1 font-mono text-[10px] min-h-[60px]">
            <li
              v-for="event in recentAudit"
              :key="`a-${event.id}`"
              class="flex items-center gap-1.5 text-muted min-w-0"
            >
              <UIcon name="i-lucide-link-2" class="size-2.5 text-primary shrink-0" />
              <span class="text-primary truncate">{{ event.auditAction ?? event.path }}</span>
            </li>
          </ul>
        </div>
      </div>

      <div class="border-t border-muted/50 px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[10px] text-dimmed">
        <span class="inline-flex items-center gap-1.5">
          <span class="size-1.5 rounded-full bg-emerald-400" />
          main drain · queryable
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="size-1.5 rounded-full bg-primary" />
          audit drain · tamper-evident · long retention
        </span>
        <span class="ml-auto">
          {{ filteredCount }} non-audit events filtered out
        </span>
      </div>
    </div>
  </div>
</template>
