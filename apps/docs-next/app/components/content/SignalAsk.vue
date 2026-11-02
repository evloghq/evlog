<script setup lang="ts">
import type { TimedEvent } from '~/composables/useTimedSequence'

interface Field {
  key: string
  value: string
  color?: string
}

interface Option {
  label: string
  probability: number
}

interface Scenario {
  id: string
  fields: Field[]
  name: string
  ask: string
  shape: 'choice' | 'boolean' | 'score'
  options: Option[]
  column: string
}

const OPTION_SLOTS = 3
const FIELD_SLOTS = 4

const scenarios: Scenario[] = [
  {
    id: 'fault',
    fields: [
      { key: 'path', value: '"/api/checkout"' },
      { key: 'status', value: '502', color: 'text-rose-400' },
      { key: 'error', value: '"ECONNRESET api.stripe.com"' },
      { key: 'durationMs', value: '2310' },
    ],
    name: 'fault',
    ask: 'Who is responsible for this failure?',
    shape: 'choice',
    options: [
      { label: 'client', probability: 0.03 },
      { label: 'app', probability: 0.04 },
      { label: 'upstream', probability: 0.93 },
    ],
    column: '{ value: "upstream", confidence: 0.93 }',
  },
  {
    id: 'silent-failure',
    fields: [
      { key: 'path', value: '"/api/checkout"' },
      { key: 'status', value: '200', color: 'text-emerald-400' },
      { key: 'order', value: 'null' },
      { key: 'message', value: '"we will email you shortly"' },
    ],
    name: 'silent-failure',
    ask: 'Did the customer leave without what they came for?',
    shape: 'boolean',
    options: [
      { label: 'yes', probability: 0.93 },
      { label: 'no', probability: 0.07 },
    ],
    column: '{ value: true, confidence: 0.93 }',
  },
  {
    id: 'severity',
    fields: [
      { key: 'path', value: '"/api/orders"' },
      { key: 'status', value: '500', color: 'text-rose-400' },
      { key: 'error', value: '"Cannot read properties of null"' },
      { key: 'durationMs', value: '42' },
    ],
    name: 'severity',
    ask: 'How urgent is this for the on-call engineer?',
    shape: 'score',
    options: [
      { label: 'noise', probability: 0.04 },
      { label: 'watch', probability: 0.18 },
      { label: 'page', probability: 0.78 },
    ],
    column: '{ value: "page", score: 1.74, confidence: 0.78 }',
  },
]

const STEP_IDLE = 0
const STEP_EVENT = 1
const STEP_ASK = 2
const STEP_ANSWER = 3
const STEP_COLUMN = 4

const current = ref(0)
const step = ref(STEP_IDLE)
const prefersReducedMotion = ref(false)
const wrapperRef = ref<HTMLElement>()

const scenario = computed(() => scenarios[current.value]!)

function resetState() {
  current.value = 0
  step.value = STEP_IDLE
}

const ENTER_AT = 300
const ASK_AT = 1500
const ANSWER_AT = 2800
const COLUMN_AT = 3900
const SCENARIO_INTERVAL = 6000
const TAIL_HOLD = 1800

function show(index: number, next: number) {
  current.value = index
  step.value = next
}

function buildEvents(): TimedEvent[] {
  const events: TimedEvent[] = []
  scenarios.forEach((_, i) => {
    const base = ENTER_AT + i * SCENARIO_INTERVAL
    events.push({ at: base, run: () => show(i, STEP_EVENT) })
    events.push({ at: base + ASK_AT, run: () => show(i, STEP_ASK) })
    events.push({ at: base + ANSWER_AT, run: () => show(i, STEP_ANSWER) })
    events.push({ at: base + COLUMN_AT, run: () => show(i, STEP_COLUMN) })
  })
  return events
}

const events = buildEvents()
const totalDuration = ENTER_AT + scenarios.length * SCENARIO_INTERVAL + TAIL_HOLD

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
    show(0, STEP_COLUMN)
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

const eventShown = computed(() => step.value >= STEP_EVENT)
const askShown = computed(() => step.value >= STEP_ASK)
const answerShown = computed(() => step.value >= STEP_ANSWER)
const columnShown = computed(() => step.value >= STEP_COLUMN)

const fieldRows = computed(() => Array.from({ length: FIELD_SLOTS }, (_, i) => {
  const field = scenario.value.fields[i]
  return { key: field?.key ?? '', value: field?.value ?? '', color: field?.color ?? 'text-muted' }
}))

const optionRows = computed(() => {
  const { options } = scenario.value
  let winner = options[0]!
  for (const option of options) if (option.probability > winner.probability) winner = option
  return Array.from({ length: OPTION_SLOTS }, (_, i) => {
    const option = options[i]
    return {
      present: option !== undefined,
      label: option?.label ?? '',
      probability: option?.probability ?? 0,
      width: answerShown.value ? `${(option?.probability ?? 0) * 100}%` : '0%',
      isWinner: option !== undefined && option.label === winner.label,
    }
  })
})

const SHAPE_LABELS: Record<Scenario['shape'], string> = { choice: 'pick one', boolean: 'yes / no', score: 'rubric' }

const shapeLabel = computed(() => SHAPE_LABELS[scenario.value.shape])

const requestLabel = computed(() => `POST · ${scenario.value.fields[0]?.value.replace(/"/g, '') ?? ''}`)

const HEADLINES = ['idle', 'event matches `when`', 'one question, in English', 'model answers with probabilities', 'answer lands as a column']

const headline = computed(() => HEADLINES[step.value] ?? 'idle')
</script>

<template>
  <div class="not-prose my-8" data-section="signal-ask">
    <div ref="wrapperRef" class="overflow-hidden border border-muted bg-default">
      <div class="flex items-center gap-2 border-b border-muted px-4 py-2.5">
        <UIcon name="i-lucide-scan-search" class="size-3.5 text-primary" />
        <span class="font-mono text-xs text-dimmed">a signal</span>
        <span class="text-dimmed">·</span>
        <span
          class="font-mono text-[10px] tracking-widest uppercase transition-colors duration-300 truncate"
          :class="columnShown ? 'text-primary' : 'text-amber-400'"
        >
          {{ headline }}
        </span>
        <div class="ml-auto hidden sm:flex items-center gap-1.5 font-mono text-[9px] tracking-widest text-dimmed">
          <span>{{ current + 1 }} / {{ scenarios.length }}</span>
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

      <div class="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-px bg-muted/40">
        <div class="bg-default px-4 py-3 font-mono text-[10px] sm:text-[11px]">
          <div class="flex items-center gap-2 mb-2 text-[9px] tracking-widest uppercase text-dimmed">
            <span>wide event</span>
            <span
              class="ml-auto transition-opacity duration-300"
              :class="eventShown ? 'opacity-100' : 'opacity-0'"
            >{{ requestLabel }}</span>
          </div>
          <div class="space-y-0.5 leading-snug">
            <div class="text-dimmed">
              {
            </div>
            <div
              v-for="(field, i) in fieldRows"
              :key="`field-${i}`"
              class="pl-3 flex whitespace-nowrap transition-all duration-500 h-4"
              :class="eventShown ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-1'"
              :style="{ transitionDelay: `${i * 160}ms` }"
            >
              <span class="shrink-0 text-sky-400">{{ field.key }}</span>
              <span class="shrink-0 whitespace-pre text-dimmed">: </span>
              <span class="truncate" :class="field.color">{{ field.value }}</span>
            </div>
            <div
              class="pl-3 flex whitespace-nowrap h-4 transition-all duration-400"
              :class="columnShown ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2'"
            >
              <span class="shrink-0 text-primary">signals.{{ scenario.name }}</span>
              <span class="shrink-0 whitespace-pre text-dimmed">: </span>
            </div>
            <div
              class="pl-6 h-4 whitespace-nowrap truncate text-primary transition-all duration-400 delay-100"
              :class="columnShown ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2'"
            >
              {{ scenario.column }}
            </div>
            <div class="text-dimmed">
              }
            </div>
          </div>
        </div>

        <div class="bg-default px-4 py-3 font-mono text-[10px] sm:text-[11px]">
          <div class="flex items-center gap-2 mb-2 text-[9px] tracking-widest uppercase text-dimmed">
            <span>the signal</span>
            <span
              class="ml-auto transition-opacity duration-300"
              :class="askShown ? 'opacity-100' : 'opacity-0'"
            >{{ shapeLabel }}</span>
          </div>
          <div
            class="h-9 leading-snug text-default transition-all duration-500 line-clamp-2"
            :class="askShown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'"
          >
            <span class="text-dimmed">ask: </span>"{{ scenario.ask }}"
          </div>
          <div class="mt-2 space-y-1">
            <div
              v-for="(option, i) in optionRows"
              :key="`option-${i}`"
              class="grid grid-cols-[64px_minmax(0,1fr)_32px] items-center gap-2 h-4 transition-opacity duration-300"
              :class="[
                askShown ? 'opacity-100' : 'opacity-0',
                option.present ? '' : 'invisible',
              ]"
            >
              <div
                class="truncate transition-colors duration-300"
                :class="answerShown && option.isWinner ? 'text-primary' : 'text-muted'"
              >
                {{ option.label }}
              </div>
              <div class="h-1.5 w-full bg-muted/40 overflow-hidden">
                <div
                  class="h-1.5 transition-[width] duration-700 ease-out"
                  :class="option.isWinner ? 'bg-primary' : 'bg-muted'"
                  :style="{ width: option.width }"
                />
              </div>
              <div
                class="text-right tabular-nums transition-opacity duration-300"
                :class="[
                  answerShown ? 'opacity-100' : 'opacity-0',
                  option.isWinner ? 'text-primary' : 'text-dimmed',
                ]"
              >
                {{ option.probability.toFixed(2) }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="border-t border-muted/50 px-4 py-2.5 flex items-center gap-2 font-mono text-[9px] tracking-widest uppercase">
        <span :class="eventShown ? 'text-default' : 'text-dimmed'">event</span>
        <UIcon name="i-lucide-arrow-right" class="size-3 text-dimmed" />
        <span :class="askShown ? 'text-default' : 'text-dimmed'">question</span>
        <UIcon name="i-lucide-arrow-right" class="size-3 text-dimmed" />
        <span :class="answerShown ? 'text-default' : 'text-dimmed'">probabilities</span>
        <UIcon name="i-lucide-arrow-right" class="size-3 text-dimmed" />
        <span :class="columnShown ? 'text-primary' : 'text-dimmed'">column</span>
        <span class="ml-auto hidden sm:inline text-dimmed normal-case tracking-normal">one model call per event, every due signal in it</span>
      </div>
    </div>
  </div>
</template>
