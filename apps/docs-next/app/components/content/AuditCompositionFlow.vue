<script setup lang="ts">
import type { TimedEvent } from '~/composables/useTimedSequence'

interface Stage {
  id: string
  label: string
  hint: string
  icon: string
  origin?: 'audit' | 'shared'
}

const stages: Stage[] = [
  { id: 'callsite', label: 'log.audit / audit / withAudit', hint: 'callsite', icon: 'i-lucide-file-pen-line', origin: 'audit' },
  { id: 'set', label: 'set event.audit', hint: 'reserved field', icon: 'i-lucide-square-pen', origin: 'audit' },
  { id: 'forceKeep', label: 'force-keep tail-sample', hint: 'never dropped', icon: 'i-lucide-shield-check', origin: 'audit' },
  { id: 'enricher', label: 'auditEnricher()', hint: '+ requestId · ip · ua', icon: 'i-lucide-sparkles', origin: 'audit' },
  { id: 'redact', label: 'redact + auditRedactPreset', hint: 'PII scrubbed', icon: 'i-lucide-eye-off', origin: 'shared' },
]

interface DrainTarget {
  id: 'main' | 'signed'
  label: string
  hint: string
  icon: string
  accent: string
}

const drains: DrainTarget[] = [
  { id: 'main', label: 'main drain', hint: 'Axiom · Datadog · Sentry · …', icon: 'i-lucide-cloud-upload', accent: 'text-primary' },
  { id: 'signed', label: 'auditOnly(signed(fsDrain))', hint: 'hash-chain · WORM · 7y retention', icon: 'i-lucide-link-2', accent: 'text-emerald-400' },
]

const stageIdx = ref(-1)
const drainHits = ref({ main: false, signed: false })
const phase = ref<'idle' | 'flowing' | 'fan-out' | 'done' | 'hold'>('idle')
const prefersReducedMotion = ref(false)
const wrapperRef = ref<HTMLElement>()

function resetState() {
  stageIdx.value = -1
  drainHits.value = { main: false, signed: false }
  phase.value = 'idle'
}

const START_AT = 250
const STEP_DELAY = 800
const FAN_OUT_DELAY = 350
const TAIL_HOLD = 4500

function buildEvents(): TimedEvent[] {
  const events: TimedEvent[] = []

  events.push({ at: START_AT - 50, run: () => {
    phase.value = 'flowing' 
  } })

  stages.forEach((_, i) => {
    events.push({
      at: START_AT + i * STEP_DELAY,
      run: () => {
        stageIdx.value = i 
      },
    })
  })

  const fanOutAt = START_AT + stages.length * STEP_DELAY
  events.push({ at: fanOutAt, run: () => {
    phase.value = 'fan-out' 
  } })
  events.push({
    at: fanOutAt + FAN_OUT_DELAY,
    run: () => {
      drainHits.value = { ...drainHits.value, main: true } 
    },
  })
  events.push({
    at: fanOutAt + FAN_OUT_DELAY + 250,
    run: () => {
      drainHits.value = { ...drainHits.value, signed: true } 
    },
  })
  events.push({
    at: fanOutAt + FAN_OUT_DELAY + 500,
    run: () => {
      phase.value = 'done' 
    },
  })
  events.push({
    at: fanOutAt + TAIL_HOLD,
    run: () => {
      phase.value = 'hold' 
    },
  })

  return events
}

const events = buildEvents()
const totalDuration = START_AT + stages.length * STEP_DELAY + TAIL_HOLD + 200

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
    stageIdx.value = stages.length - 1
    drainHits.value = { main: true, signed: true }
    phase.value = 'done'
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

function isReached(i: number) {
  return stageIdx.value >= i
}

function isActive(i: number) {
  return stageIdx.value === i
}

const fanOutReached = computed(() => phase.value === 'fan-out' || phase.value === 'done' || phase.value === 'hold')
</script>

<template>
  <div class="not-prose my-8" data-section="audit-composition-flow">
    <div ref="wrapperRef" class="overflow-hidden border border-muted bg-default">
      <div class="flex items-center gap-2 border-b border-muted px-4 py-2">
        <div class="flex gap-1.5">
          <div class="size-3 rounded-full bg-accented" />
          <div class="size-3 rounded-full bg-accented" />
          <div class="size-3 rounded-full bg-accented" />
        </div>
        <span class="ml-3 font-mono text-xs text-dimmed">audit pipeline · 1 event, 2 sinks</span>
        <span class="text-dimmed">·</span>
        <span
          class="font-mono text-[10px] tracking-widest uppercase transition-colors duration-300"
          :class="phase === 'done' || phase === 'hold' ? 'text-primary' : (fanOutReached ? 'text-amber-400' : 'text-dimmed')"
        >
          {{ phase === 'done' || phase === 'hold' ? 'persisted' : (fanOutReached ? 'fan-out' : 'flowing') }}
        </span>
        <div class="ml-auto hidden md:flex items-center gap-1.5 font-mono text-[9px] tracking-widest text-dimmed">
          <UIcon name="i-lucide-shield-check" class="size-3 text-primary" />
          <span>each layer is opt-in</span>
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

      <div class="px-4 sm:px-8 py-6 sm:py-7">
        <ol class="relative flex flex-col gap-4 max-w-md mx-auto">
          <li
            v-for="(stage, i) in stages"
            :key="stage.id"
            class="relative flex items-stretch gap-3 sm:gap-4"
          >
            <span
              v-if="i < stages.length - 1"
              aria-hidden="true"
              class="pointer-events-none absolute top-9 bottom-[-22px] left-[10px] -translate-x-1/2 w-px transition-colors duration-500"
              :class="isReached(i + 1) ? 'bg-primary/70' : 'bg-muted/60'"
            />

            <div class="relative flex size-5 shrink-0 items-center justify-center mt-3">
              <span
                v-if="isActive(i)"
                class="absolute inline-flex size-3.5 rounded-full bg-primary/40 animate-ping"
                aria-hidden="true"
              />
              <span
                class="relative z-10 size-2.5 rounded-full transition-all duration-300"
                :class="{
                  'bg-primary shadow-[0_0_8px_var(--ui-color-primary-500)]': isActive(i),
                  'bg-primary/60': isReached(i) && !isActive(i),
                  'bg-accented': !isReached(i),
                }"
              />
            </div>

            <div
              class="min-w-0 flex-1 border px-3 py-2 transition-all duration-400"
              :class="isReached(i)
                ? (stage.origin === 'shared' ? 'border-muted bg-elevated/50' : 'border-primary/30 bg-primary/5')
                : 'border-muted/40 bg-default opacity-60'"
            >
              <div class="flex items-baseline gap-2">
                <UIcon
                  :name="stage.icon"
                  class="size-3 shrink-0 transition-colors duration-300"
                  :class="isReached(i) ? (stage.origin === 'shared' ? 'text-muted' : 'text-primary') : 'text-dimmed/60'"
                />
                <span
                  class="font-mono text-[11px] sm:text-xs transition-colors duration-300"
                  :class="isReached(i) ? 'text-highlighted' : 'text-dimmed'"
                >
                  {{ stage.label }}
                </span>
                <span
                  v-if="stage.origin === 'shared'"
                  class="ml-auto font-mono text-[8px] tracking-widest uppercase text-dimmed"
                >
                  shared
                </span>
                <span
                  v-else
                  class="ml-auto font-mono text-[8px] tracking-widest uppercase text-primary/80"
                >
                  audit
                </span>
              </div>
              <p
                class="font-mono text-[10px] leading-relaxed text-muted pl-5 transition-opacity duration-500"
                :class="isReached(i) ? 'opacity-100' : 'opacity-0'"
              >
                {{ stage.hint }}
              </p>
            </div>
          </li>
        </ol>

        <div class="relative h-8 max-w-md mx-auto" aria-hidden="true">
          <span
            class="absolute top-0 left-1/2 -translate-x-1/2 w-px h-4 transition-colors duration-500"
            :class="fanOutReached ? 'bg-primary/70' : 'bg-muted/60'"
          />
          <span
            class="absolute top-4 left-1/4 right-1/4 h-px transition-colors duration-500"
            :class="fanOutReached ? 'bg-primary/70' : 'bg-muted/60'"
          />
          <span
            class="absolute top-4 left-1/4 -translate-x-px w-px h-4 transition-colors duration-500"
            :class="drainHits.main ? 'bg-primary/70' : 'bg-muted/60'"
          />
          <span
            class="absolute top-4 right-1/4 translate-x-px w-px h-4 transition-colors duration-500"
            :class="drainHits.signed ? 'bg-emerald-400/70' : 'bg-muted/60'"
          />
        </div>

        <div class="grid grid-cols-2 gap-3 max-w-md mx-auto">
          <div
            v-for="d in drains"
            :key="d.id"
            class="border px-3 py-2.5 transition-all duration-500"
            :class="drainHits[d.id]
              ? (d.id === 'signed' ? 'border-emerald-400/40 bg-emerald-500/5' : 'border-primary/40 bg-primary/5')
              : 'border-muted/40 opacity-50'"
          >
            <div class="flex items-baseline gap-2 min-w-0">
              <UIcon :name="d.icon" class="size-3 shrink-0" :class="drainHits[d.id] ? d.accent : 'text-dimmed/60'" />
              <span class="font-mono text-[11px] truncate" :class="drainHits[d.id] ? 'text-highlighted' : 'text-dimmed'">
                {{ d.label }}
              </span>
            </div>
            <p class="font-mono text-[10px] text-muted pl-5 mt-0.5 leading-relaxed truncate">
              {{ d.hint }}
            </p>
          </div>
        </div>
      </div>

      <div class="border-t border-muted/50 px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[10px] text-dimmed">
        <span class="inline-flex items-center gap-1.5">
          <span class="size-1.5 rounded-full bg-primary" />
          audit-only layer
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="size-1.5 rounded-full bg-muted/70" />
          shared with regular wide events
        </span>
        <span
          class="ml-auto transition-opacity duration-500"
          :class="phase === 'done' || phase === 'hold' ? 'opacity-100 text-primary' : 'opacity-60'"
        >
          1 event · 2 sinks · 0 duplicates
        </span>
      </div>
    </div>
  </div>
</template>
