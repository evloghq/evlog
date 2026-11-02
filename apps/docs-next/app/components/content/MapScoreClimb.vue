<script setup lang="ts">
import type { TimedEvent } from '~/composables/useTimedSequence'

interface Rule {
  /** Column label in the `--all` matrix. */
  id: string
  weight: number
  /** The call that satisfies it. */
  fix: string
  /** Step that lands this rule, or `null` when it never applied here. */
  step: number | null
}

/**
 * One real entry point going from dark to fully covered: `server/api/auth/[...all].ts`
 * starts at 20/100 with `log`, `ctx` and `audit` failing, and each fix is worth
 * exactly its rule weight.
 */
const rules: Rule[] = [
  { id: 'log', weight: 40, fix: 'useLogger()', step: 1 },
  { id: 'ctx', weight: 15, fix: 'log.set()', step: 2 },
  { id: 'audit', weight: 25, fix: 'log.audit()', step: 3 },
  { id: 'err', weight: 20, fix: 'createError()', step: null },
  { id: 'catch', weight: 15, fix: 'catch logging', step: null },
  { id: 'fetch', weight: 20, fix: 'fetch handling', step: null },
]

interface Line {
  /** Step that adds this line — 0 is code that was already there. */
  step: number
  text: string
  accent?: 'log' | 'ctx' | 'audit'
}

const lines: Line[] = [
  { step: 0, text: 'export default defineEventHandler(async (event) => {' },
  { step: 1, text: '  const log = useLogger()', accent: 'log' },
  { step: 2, text: '  log.set({ provider, flow: \'oauth\' })', accent: 'ctx' },
  { step: 0, text: '  const session = await auth.handler(event)' },
  { step: 3, text: '  log.audit(\'auth.login\', { userId: session.user.id })', accent: 'audit' },
  { step: 0, text: '  return session' },
  { step: 0, text: '})' },
]

const BASE_SCORE = 20
const step = ref(0)
const prefersReducedMotion = ref(false)
const wrapperRef = ref<HTMLElement>()

function resetState() {
  step.value = 0
}

const STEP_AT = [700, 2100, 3500, 4900]
const TAIL_HOLD = 3600

const events: TimedEvent[] = STEP_AT.map((at, i) => ({
  at,
  run: () => {
    step.value = i
  },
}))

const totalDuration = (STEP_AT.at(-1) ?? 0) + TAIL_HOLD

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
    step.value = 3
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

function isCovered(rule: Rule) {
  return rule.step !== null && step.value >= rule.step
}

const score = computed(() =>
  rules.reduce((total, rule) => (isCovered(rule) ? total + rule.weight : total), BASE_SCORE),
)

const justLanded = computed(() => rules.find(r => r.step === step.value) ?? null)

const grade = computed(() => {
  if (score.value >= 90) return 'excellent'
  if (score.value >= 70) return 'good'
  if (score.value >= 40) return 'needs work'
  return 'at risk'
})

const gradeClass = computed(() => {
  if (score.value >= 90) return 'text-emerald-500'
  if (score.value >= 70) return 'text-primary'
  if (score.value >= 40) return 'text-amber-500'
  return 'text-rose-400'
})

function lineVisible(line: Line) {
  return line.step === 0 || step.value >= line.step
}

function accentClass(line: Line) {
  switch (line.accent) {
    case 'log': return 'text-primary'
    case 'ctx': return 'text-amber-400'
    case 'audit': return 'text-emerald-400'
    default: return 'text-muted'
  }
}
</script>

<template>
  <div class="not-prose my-8" data-section="map-score-climb">
    <div ref="wrapperRef" class="overflow-hidden border border-muted bg-default">
      <div class="flex items-center gap-2 border-b border-muted px-3 py-2">
        <UIcon name="i-lucide-gauge" class="size-3 text-primary shrink-0" />
        <span class="font-mono text-[11px] text-dimmed truncate">api/auth/[...all].ts</span>
        <span class="text-dimmed text-[10px]">·</span>
        <span class="font-mono text-[9px] uppercase tracking-widest transition-colors duration-300" :class="gradeClass">
          {{ score }}/100
        </span>
        <div class="ml-auto hidden sm:block font-mono text-[9px] tracking-widest text-dimmed truncate">
          <span class="transition-opacity duration-300" :class="justLanded ? 'opacity-100' : 'opacity-0'">
            + {{ justLanded?.weight ?? 0 }} {{ justLanded?.id ?? '' }}
          </span>
        </div>
        <div class="flex items-center gap-0.5 ml-1">
          <button
            type="button"
            class="size-5 inline-flex items-center justify-center text-dimmed hover:text-default focus:text-default focus:outline-none transition-colors"
            :aria-label="paused ? 'Play animation' : 'Pause animation'"
            :disabled="!started"
            @click="toggle"
          >
            <UIcon :name="paused ? 'i-lucide-play' : 'i-lucide-pause'" class="size-3" />
          </button>
          <button
            type="button"
            class="size-5 inline-flex items-center justify-center text-dimmed hover:text-default focus:text-default focus:outline-none transition-colors"
            aria-label="Restart animation"
            :disabled="!started"
            @click="restart"
          >
            <UIcon name="i-lucide-rotate-ccw" class="size-3" />
          </button>
        </div>
      </div>

      <div class="grid sm:grid-cols-[minmax(0,1fr)_minmax(0,190px)]">
        <div class="px-3 py-2.5 border-b sm:border-b-0 sm:border-r border-muted/50">
          <div class="space-y-0">
            <div
              v-for="(line, i) in lines"
              :key="i"
              class="font-mono text-[10px] leading-[18px] h-[18px] truncate transition-all duration-500"
              :class="[
                lineVisible(line) ? 'opacity-100' : 'opacity-0',
                line.accent ? accentClass(line) : 'text-muted',
              ]"
            >{{ line.text }}</div>
          </div>
        </div>

        <div class="px-3 py-2.5">
          <div class="flex items-baseline gap-1.5 mb-2">
            <span class="font-mono text-xl leading-none tabular-nums transition-colors duration-300" :class="gradeClass">{{ score }}</span>
            <span class="font-mono text-[9px] text-dimmed">/100</span>
            <span class="ml-auto font-mono text-[9px] uppercase tracking-widest transition-colors duration-300" :class="gradeClass">{{ grade }}</span>
          </div>

          <div class="grid grid-cols-10 gap-px h-1.5 mb-2.5" aria-hidden="true">
            <div
              v-for="block in 10"
              :key="block"
              class="transition-colors duration-500"
              :class="block * 10 <= score ? (score >= 90 ? 'bg-emerald-500/70' : score >= 70 ? 'bg-primary/70' : 'bg-amber-500/70') : 'bg-muted/25'"
            />
          </div>

          <div class="space-y-0.5">
            <div
              v-for="rule in rules"
              :key="rule.id"
              class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 h-[17px] font-mono text-[9px]"
            >
              <UIcon
                :name="rule.step === null ? 'i-lucide-minus' : isCovered(rule) ? 'i-lucide-check' : 'i-lucide-x'"
                class="size-2.5 shrink-0 transition-colors duration-300"
                :class="rule.step === null ? 'text-dimmed/50' : isCovered(rule) ? 'text-emerald-500' : 'text-rose-400'"
              />
              <span
                class="truncate transition-colors duration-300"
                :class="rule.step === null ? 'text-dimmed/60' : isCovered(rule) ? 'text-muted' : 'text-highlighted'"
              >{{ rule.id }} <span class="text-dimmed">{{ rule.fix }}</span></span>
              <span
                class="tabular-nums transition-colors duration-300"
                :class="rule.step === null ? 'text-dimmed/50' : isCovered(rule) ? 'text-emerald-500' : 'text-rose-400'"
              >{{ rule.step === null ? 'n/a' : isCovered(rule) ? `+${rule.weight}` : `−${rule.weight}` }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="border-t border-muted/50 px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[9px] text-dimmed">
        <span>every rule costs exactly its weight</span>
        <span class="hidden sm:inline">n/a never counts against you</span>
        <span
          class="ml-auto tabular-nums transition-opacity duration-500 whitespace-nowrap"
          :class="score === 100 ? 'opacity-100 text-emerald-500' : 'opacity-0'"
        >
          ▲ {{ BASE_SCORE }} → 100 in three lines
        </span>
      </div>
    </div>
  </div>
</template>
