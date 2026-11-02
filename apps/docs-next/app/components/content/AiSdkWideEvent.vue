<script setup lang="ts">
import type { TimedEvent } from '~/composables/useTimedSequence'

interface TimelineStep {
  id: string
  label: string
  hint: string
  icon: string
  color: string
}

const steps: TimelineStep[] = [
  { id: 'call', label: 'streamText()', hint: 'model wrapped, request sent', icon: 'i-lucide-play', color: 'text-violet-400' },
  { id: 'first', label: 'first chunk', hint: 'msToFirstChunk: 234', icon: 'i-lucide-radio', color: 'text-sky-400' },
  { id: 'stream-1', label: 'streaming…', hint: 'output tokens flowing', icon: 'i-lucide-activity', color: 'text-emerald-400' },
  { id: 'tool-call', label: 'tool: getWeather', hint: 'paris', icon: 'i-lucide-wrench', color: 'text-amber-400' },
  { id: 'tool-result', label: 'tool result', hint: '22°C, sunny', icon: 'i-lucide-check', color: 'text-emerald-400' },
  { id: 'stream-2', label: 'streaming…', hint: 'final answer being generated', icon: 'i-lucide-activity', color: 'text-emerald-400' },
  { id: 'finish', label: 'stream finish', hint: 'finishReason: stop · msToFinish: 4500', icon: 'i-lucide-flag', color: 'text-primary' },
]

const FINAL_INPUT = 3312
const FINAL_OUTPUT = 814
const FINAL_REASONING = 225
const FINAL_DURATION = 4500
const COST_PER_M_INPUT = 3
const COST_PER_M_OUTPUT = 15

const phase = ref(-1)
const inputTokens = ref(0)
const outputTokens = ref(0)
const toolName = ref<string | null>(null)
const finished = ref(false)
const prefersReducedMotion = ref(false)
const wrapperRef = ref<HTMLElement>()

function resetState() {
  phase.value = -1
  inputTokens.value = 0
  outputTokens.value = 0
  toolName.value = null
  finished.value = false
}

const STEP_INTERVAL = 800
const STEP_BASE = 250
const TAIL_HOLD = 4500

function buildEvents(): TimedEvent[] {
  const events: TimedEvent[] = []

  steps.forEach((step, i) => {
    const at = STEP_BASE + i * STEP_INTERVAL

    events.push({
      at,
      run: () => {
        phase.value = i
        if (step.id === 'first') {
          inputTokens.value = FINAL_INPUT
        }
        if (step.id === 'stream-1') {
          outputTokens.value = Math.round(FINAL_OUTPUT * 0.4)
        }
        if (step.id === 'tool-call') {
          toolName.value = 'getWeather'
        }
        if (step.id === 'stream-2') {
          outputTokens.value = FINAL_OUTPUT
        }
        if (step.id === 'finish') {
          finished.value = true
        }
      },
    })
  })

  return events
}

const events = buildEvents()
const totalDuration = STEP_BASE + steps.length * STEP_INTERVAL + TAIL_HOLD

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
    phase.value = steps.length - 1
    inputTokens.value = FINAL_INPUT
    outputTokens.value = FINAL_OUTPUT
    toolName.value = 'getWeather'
    finished.value = true
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
    { threshold: 0.2 },
  )
  observer.observe(wrapperRef.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
})

function isReached(i: number) {
  return phase.value >= i
}
function isActive(i: number) {
  return phase.value === i
}

const totalTokens = computed(() => inputTokens.value + outputTokens.value)
const tokensPerSecond = computed(() => {
  if (!finished.value || FINAL_DURATION === 0) return 0
  return Math.round((outputTokens.value / FINAL_DURATION) * 1000)
})
const estimatedCost = computed(() => {
  const cost = (inputTokens.value / 1_000_000) * COST_PER_M_INPUT + (outputTokens.value / 1_000_000) * COST_PER_M_OUTPUT
  return cost.toFixed(4)
})
</script>

<template>
  <div class="not-prose my-8" data-section="ai-sdk-wide-event">
    <div ref="wrapperRef" class="overflow-hidden border border-muted bg-default">
      <div class="flex items-center gap-2 border-b border-muted px-4 py-2.5">
        <UIcon name="i-lucide-sparkles" class="size-3.5 text-primary" />
        <span class="font-mono text-xs text-dimmed">ai sdk · streamText</span>
        <span class="text-dimmed">·</span>
        <span class="font-mono text-[10px] tracking-widest uppercase transition-colors duration-300" :class="finished ? 'text-primary' : 'text-amber-400'">
          {{ finished ? 'wide event sealed' : phase >= 0 ? 'capturing…' : 'idle' }}
        </span>
        <div class="ml-auto hidden sm:flex items-center gap-1.5 font-mono text-[9px] tracking-widest text-dimmed">
          <span>ai.wrap('anthropic/claude-sonnet-4.6')</span>
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
        <div class="px-4 sm:px-5 py-5">
          <div class="flex items-center gap-2 mb-3">
            <UIcon name="i-lucide-radio" class="size-3.5 text-primary" />
            <span class="font-mono text-[10px] tracking-widest uppercase text-dimmed">call timeline</span>
          </div>

          <ol class="relative flex flex-col gap-3">
            <li
              v-for="(step, i) in steps"
              :key="step.id"
              class="relative flex items-start gap-3"
            >
              <span
                v-if="i < steps.length - 1"
                aria-hidden="true"
                class="pointer-events-none absolute top-4 bottom-[-18px] left-[10px] -translate-x-1/2 w-px transition-colors duration-500"
                :class="isReached(i + 1) ? 'bg-primary/70' : 'bg-muted/60'"
              />

              <div class="relative flex size-5 shrink-0 items-center justify-center mt-0.5">
                <span
                  v-if="isActive(i)"
                  class="absolute inline-flex size-3 rounded-full bg-primary/40 animate-ping"
                  aria-hidden="true"
                />
                <span
                  class="relative z-10 size-2 rounded-full transition-colors duration-300"
                  :class="{
                    'bg-primary shadow-[0_0_8px_var(--ui-color-primary-500)]': isActive(i),
                    'bg-primary/60': isReached(i) && !isActive(i),
                    'bg-accented': !isReached(i),
                  }"
                />
              </div>

              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <UIcon
                    :name="step.icon"
                    class="size-3 shrink-0 transition-opacity duration-300"
                    :class="[isReached(i) ? step.color : 'text-dimmed/50', isActive(i) && step.id.startsWith('stream') ? 'animate-pulse' : '']"
                  />
                  <span
                    class="font-mono text-[11px] sm:text-xs transition-colors duration-300"
                    :class="isReached(i) ? 'text-highlighted' : 'text-dimmed'"
                  >
                    {{ step.label }}
                  </span>
                </div>
                <p
                  class="font-mono text-[10px] text-muted leading-relaxed transition-opacity duration-500 pl-5"
                  :class="isReached(i) ? 'opacity-100' : 'opacity-0'"
                >
                  {{ step.hint }}
                </p>
              </div>
            </li>
          </ol>
        </div>

        <div class="border-t border-default/30 lg:border-t-0 lg:border-l">
          <div class="flex items-center gap-2 border-b border-default/30 px-4 py-2.5">
            <UIcon name="i-lucide-package" class="size-3 text-primary" />
            <span class="font-mono text-[10px] tracking-widest text-dimmed uppercase">wide event · ai field</span>
            <span
              v-if="finished"
              class="ml-auto font-mono text-[9px] tracking-widest text-primary"
            >
              SEALED
            </span>
          </div>

          <div class="px-4 sm:px-5 py-4 font-mono text-[10px] sm:text-[11px] leading-relaxed">
            <div class="text-muted mb-2">
              {
            </div>
            <div class="pl-4 space-y-1 text-muted">
              <div class="flex items-baseline gap-2">
                <span class="text-sky-400">model</span><span class="text-dimmed">:</span>
                <span class="text-emerald-400">"claude-sonnet-4.6"</span>
              </div>
              <div class="flex items-baseline gap-2">
                <span class="text-sky-400">provider</span><span class="text-dimmed">:</span>
                <span class="text-emerald-400">"anthropic"</span>
              </div>
              <div class="flex items-baseline gap-2">
                <span class="text-sky-400">inputTokens</span><span class="text-dimmed">:</span>
                <span class="text-pink-400 tabular-nums">{{ inputTokens.toLocaleString('en-US') }}</span>
              </div>
              <div class="flex items-baseline gap-2">
                <span class="text-sky-400">outputTokens</span><span class="text-dimmed">:</span>
                <span class="text-pink-400 tabular-nums">{{ outputTokens.toLocaleString('en-US') }}</span>
                <span
                  v-if="phase >= 2 && !finished"
                  class="size-1 rounded-full bg-emerald-400 animate-pulse"
                  aria-hidden="true"
                />
              </div>
              <div class="flex items-baseline gap-2">
                <span class="text-sky-400">totalTokens</span><span class="text-dimmed">:</span>
                <span class="text-pink-400 tabular-nums">{{ totalTokens.toLocaleString('en-US') }}</span>
              </div>
              <div class="flex items-baseline gap-2 transition-opacity duration-500" :class="phase >= 1 ? 'opacity-100' : 'opacity-0'">
                <span class="text-sky-400">reasoningTokens</span><span class="text-dimmed">:</span>
                <span class="text-pink-400 tabular-nums">{{ FINAL_REASONING }}</span>
              </div>
              <div class="flex items-baseline gap-2 transition-opacity duration-500" :class="toolName ? 'opacity-100' : 'opacity-0'">
                <span class="text-sky-400">tools</span><span class="text-dimmed">:</span>
                <span class="text-emerald-400">[{{ toolName ? `"${toolName}"` : '' }}]</span>
              </div>
              <div class="flex items-baseline gap-2 transition-opacity duration-500" :class="phase >= 1 ? 'opacity-100' : 'opacity-0'">
                <span class="text-sky-400">msToFirstChunk</span><span class="text-dimmed">:</span>
                <span class="text-pink-400">234</span>
              </div>
              <div class="flex items-baseline gap-2 transition-opacity duration-500" :class="finished ? 'opacity-100' : 'opacity-0'">
                <span class="text-sky-400">msToFinish</span><span class="text-dimmed">:</span>
                <span class="text-pink-400">{{ FINAL_DURATION }}</span>
              </div>
              <div class="flex items-baseline gap-2 transition-opacity duration-500" :class="finished ? 'opacity-100' : 'opacity-0'">
                <span class="text-sky-400">tokensPerSecond</span><span class="text-dimmed">:</span>
                <span class="text-pink-400 tabular-nums">{{ tokensPerSecond }}</span>
              </div>
              <div class="flex items-baseline gap-2 transition-opacity duration-500" :class="finished ? 'opacity-100' : 'opacity-0'">
                <span class="text-sky-400">finishReason</span><span class="text-dimmed">:</span>
                <span class="text-emerald-400">"stop"</span>
              </div>
              <div class="flex items-baseline gap-2 transition-opacity duration-500" :class="finished ? 'opacity-100' : 'opacity-0'">
                <span class="text-sky-400">estimatedCost</span><span class="text-dimmed">:</span>
                <span class="text-amber-400 tabular-nums">${{ estimatedCost }}</span>
              </div>
            </div>
            <div class="text-muted mt-2">
              }
            </div>
          </div>
        </div>
      </div>

      <div class="border-t border-muted/50 px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-[10px]">
        <div class="flex flex-col gap-0.5">
          <span class="text-dimmed text-[9px] tracking-widest uppercase">tokens</span>
          <span class="text-pink-400 tabular-nums">{{ totalTokens.toLocaleString('en-US') }}</span>
        </div>
        <div class="flex flex-col gap-0.5">
          <span class="text-dimmed text-[9px] tracking-widest uppercase">tools</span>
          <span class="text-emerald-400">{{ toolName ? '1' : '0' }}</span>
        </div>
        <div class="flex flex-col gap-0.5">
          <span class="text-dimmed text-[9px] tracking-widest uppercase">duration</span>
          <span class="text-muted">{{ finished ? `${(FINAL_DURATION / 1000).toFixed(1)}s` : '—' }}</span>
        </div>
        <div class="flex flex-col gap-0.5 text-right sm:text-left">
          <span class="text-dimmed text-[9px] tracking-widest uppercase">cost</span>
          <span class="text-amber-400 tabular-nums">${{ estimatedCost }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
