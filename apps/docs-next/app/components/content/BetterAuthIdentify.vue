<script setup lang="ts">
import type { TimedEvent } from '~/composables/useTimedSequence'

interface IdField {
  key: string
  value: string
  group: 'user' | 'session' | 'meta'
}

const idFields: IdField[] = [
  { key: 'userId', value: '"QBX9tPjJQExWawAbNll75"', group: 'user' },
  { key: 'user.id', value: '"QBX9tPjJQExWawAbNll75"', group: 'user' },
  { key: 'user.name', value: '"Hugo Richard"', group: 'user' },
  { key: 'user.email', value: '"hugo@example.com"', group: 'user' },
  { key: 'session.id', value: '"Xhmh6TxKJQrVKFX0Y0II"', group: 'session' },
  { key: 'session.expiresAt', value: '"2024-01-22T10:00:00Z"', group: 'session' },
  { key: 'auth.resolvedIn', value: '12', group: 'meta' },
  { key: 'auth.identified', value: 'true', group: 'meta' },
]

const STEP_KEYS = ['middleware', 'session', 'identify', 'emit'] as const
type StepKey = typeof STEP_KEYS[number]

interface Step {
  id: StepKey
  label: string
  hint: string
  icon: string
}

const steps: Step[] = [
  { id: 'middleware', label: 'middleware', hint: 'route check · skip auth/**', icon: 'i-lucide-route' },
  { id: 'session', label: 'getSession(headers)', hint: 'reads cookie · 12ms', icon: 'i-simple-icons-betterauth' },
  { id: 'identify', label: 'identifyUser(log, session)', hint: 'safe-fields whitelist', icon: 'i-lucide-user-check' },
  { id: 'emit', label: 'emit wide event', hint: 'all fields drained', icon: 'i-lucide-package-check' },
]

const stepIdx = ref(-1)
const fieldsShown = ref(0)
const sessionMs = ref(0)
const phase = ref<'idle' | 'anonymous' | 'resolving' | 'identified' | 'emitted' | 'hold'>('idle')
const prefersReducedMotion = ref(false)
const wrapperRef = ref<HTMLElement>()

function resetState() {
  stepIdx.value = -1
  fieldsShown.value = 0
  sessionMs.value = 0
  phase.value = 'idle'
}

const START_AT = 250
const STEP_DELAY = 900
const SESSION_TICK = 22
const FIELD_INTERVAL = 220
const TAIL_HOLD = 4500

function buildEvents(): TimedEvent[] {
  const events: TimedEvent[] = []

  events.push({ at: START_AT - 50, run: () => {
    phase.value = 'anonymous' 
  } })

  events.push({ at: START_AT, run: () => {
    stepIdx.value = 0 
  } })
  events.push({
    at: START_AT + STEP_DELAY,
    run: () => {
      stepIdx.value = 1
      phase.value = 'resolving'
    },
  })

  for (let i = 1; i <= 12; i++) {
    events.push({
      at: START_AT + STEP_DELAY + i * SESSION_TICK,
      run: () => {
        sessionMs.value = i 
      },
    })
  }

  const identifyAt = START_AT + STEP_DELAY * 2
  events.push({ at: identifyAt, run: () => {
    stepIdx.value = 2 
  } })

  for (let i = 1; i <= idFields.length; i++) {
    events.push({
      at: identifyAt + i * FIELD_INTERVAL,
      run: () => {
        fieldsShown.value = i 
      },
    })
  }

  const emitAt = identifyAt + idFields.length * FIELD_INTERVAL + 350
  events.push({ at: emitAt, run: () => {
    stepIdx.value = 3
    phase.value = 'identified'
  } })
  events.push({ at: emitAt + 250, run: () => {
    phase.value = 'emitted' 
  } })
  events.push({ at: emitAt + TAIL_HOLD - 200, run: () => {
    phase.value = 'hold' 
  } })

  return events
}

const events = buildEvents()
const totalDuration = START_AT + STEP_DELAY * 3 + idFields.length * FIELD_INTERVAL + 350 + TAIL_HOLD

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
    stepIdx.value = steps.length - 1
    fieldsShown.value = idFields.length
    sessionMs.value = 12
    phase.value = 'emitted'
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
  return stepIdx.value >= i
}

function isActive(i: number) {
  return stepIdx.value === i
}

const identified = computed(() => phase.value === 'identified' || phase.value === 'emitted' || phase.value === 'hold')

function valueColor(value: string) {
  return value.startsWith('"') ? 'text-emerald-400' : 'text-pink-400'
}
</script>

<template>
  <div class="not-prose my-8" data-section="better-auth-identify">
    <div ref="wrapperRef" class="overflow-hidden border border-muted bg-default">
      <div class="flex items-center gap-2 border-b border-muted px-4 py-2">
        <div class="flex gap-1.5">
          <div class="size-3 rounded-full bg-accented" />
          <div class="size-3 rounded-full bg-accented" />
          <div class="size-3 rounded-full bg-accented" />
        </div>
        <span class="ml-3 font-mono text-xs text-dimmed">request → wide event</span>
        <span class="text-dimmed">·</span>
        <span
          class="font-mono text-[10px] tracking-widest uppercase transition-colors duration-300"
          :class="identified ? 'text-emerald-400' : 'text-amber-400'"
        >
          {{ identified ? 'identified' : 'anonymous' }}
        </span>
        <div class="ml-auto hidden md:flex items-center gap-1.5 font-mono text-[9px] tracking-widest text-dimmed">
          <UIcon name="i-simple-icons-betterauth" class="size-3 text-primary" />
          <span>better-auth</span>
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

      <div class="grid gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div class="px-4 sm:px-6 py-5">
          <div class="font-mono text-[10px] tracking-widest uppercase text-dimmed mb-3">
            request flow
          </div>
          <ol class="relative flex flex-col gap-3.5">
            <li
              v-for="(step, i) in steps"
              :key="step.id"
              class="relative flex items-start gap-3"
            >
              <span
                v-if="i < steps.length - 1"
                aria-hidden="true"
                class="pointer-events-none absolute top-4 bottom-[-22px] left-[10px] -translate-x-1/2 w-px transition-colors duration-500"
                :class="isReached(i + 1) ? 'bg-primary/70' : 'bg-muted/60'"
              />

              <div class="relative flex size-5 shrink-0 items-center justify-center mt-0.5">
                <span
                  v-if="isActive(i)"
                  class="absolute inline-flex size-3 rounded-full bg-primary/40 animate-ping"
                  aria-hidden="true"
                />
                <span
                  class="relative z-10 size-2 rounded-full transition-all duration-300"
                  :class="{
                    'bg-primary shadow-[0_0_8px_var(--ui-color-primary-500)]': isActive(i),
                    'bg-primary/60': isReached(i) && !isActive(i),
                    'bg-accented': !isReached(i),
                  }"
                />
              </div>

              <div class="min-w-0 flex-1">
                <div class="flex items-baseline gap-2">
                  <UIcon
                    :name="step.icon"
                    class="size-3 shrink-0 transition-colors duration-300"
                    :class="isReached(i) ? 'text-primary' : 'text-dimmed/60'"
                  />
                  <span
                    class="font-mono text-xs transition-colors duration-300"
                    :class="isReached(i) ? 'text-highlighted' : 'text-dimmed'"
                  >
                    {{ step.label }}
                  </span>
                </div>
                <p
                  class="font-mono text-[10px] text-muted leading-relaxed pl-5 transition-opacity duration-500"
                  :class="isReached(i) ? 'opacity-100' : 'opacity-0'"
                >
                  {{ step.hint }}
                </p>
                <div
                  v-if="step.id === 'session'"
                  class="pl-5 mt-1 font-mono text-[10px] transition-opacity duration-500"
                  :class="isReached(1) ? 'opacity-100' : 'opacity-0'"
                >
                  <span class="text-dimmed">db read · </span>
                  <span class="text-amber-400">{{ sessionMs }}ms</span>
                </div>
              </div>
            </li>
          </ol>
        </div>

        <div class="border-t border-default/30 lg:border-t-0 lg:border-l min-w-0">
          <div class="flex items-center gap-2 border-b border-default/30 px-4 py-2.5">
            <UIcon name="i-lucide-layers" class="size-3 text-primary" />
            <span class="font-mono text-[10px] tracking-widest text-dimmed uppercase">
              wide event
            </span>
            <span
              v-if="phase === 'emitted' || phase === 'hold'"
              class="ml-auto font-mono text-[9px] tracking-widest text-emerald-400"
            >
              EMITTED
            </span>
          </div>

          <div class="p-4 sm:p-5 font-mono text-[10px] sm:text-[11px] space-y-1.5">
            <div>
              <span class="text-dimmed">$</span>
              <span class="text-violet-400 ml-1">POST</span>
              <span class="text-muted ml-1.5">/api/checkout</span>
              <span class="ml-2 text-pink-400">200</span>
              <span class="text-dimmed ml-1">· 120ms</span>
            </div>

            <div class="space-y-0.5">
              <div class="text-dimmed">
                <span class="text-sky-400">requestId</span>: <span class="text-emerald-400">"a566ef91-…"</span>
              </div>
              <div class="text-dimmed">
                <span class="text-sky-400">cart</span>: <span class="text-muted">{ items: 3, total: 9999 }</span>
              </div>
            </div>

            <div class="border-t border-default/30 pt-2 mt-2 space-y-0.5">
              <div class="flex items-center gap-1.5 text-[9px] tracking-widest uppercase text-dimmed mb-1">
                <UIcon name="i-lucide-user" class="size-3 text-primary" />
                <span>added by better-auth</span>
              </div>
              <div
                v-for="(f, i) in idFields"
                :key="f.key"
                class="transition-opacity duration-300 truncate"
                :class="i < fieldsShown ? 'opacity-100' : 'opacity-30'"
              >
                <span class="text-sky-400">{{ f.key }}</span>:
                <span :class="valueColor(f.value)">{{ f.value }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="border-t border-muted/50 px-4 py-3 grid grid-cols-3 gap-3 font-mono text-[10px]">
        <div class="flex flex-col gap-0.5">
          <span class="text-dimmed text-[9px] tracking-widest uppercase">resolved</span>
          <span class="text-amber-400">{{ sessionMs }}ms</span>
        </div>
        <div class="flex flex-col gap-0.5 text-center">
          <span class="text-dimmed text-[9px] tracking-widest uppercase">fields added</span>
          <span class="text-primary">{{ fieldsShown }} <span class="text-dimmed">/ {{ idFields.length }}</span></span>
        </div>
        <div class="flex flex-col gap-0.5 text-right">
          <span class="text-dimmed text-[9px] tracking-widest uppercase">manual log.set calls</span>
          <span class="text-emerald-400">0</span>
        </div>
      </div>
    </div>
  </div>
</template>
