<script setup lang="ts">
import type { TimedEvent } from '~/composables/useTimedSequence'

interface Stage {
  id: string
  label: string
  hint: string
  detail: string
  detailColor: string
  setLines?: { key: string, value: string }[]
}

const stages: Stage[] = [
  {
    id: 'filter',
    label: 'filter',
    hint: 'route allowed',
    detail: '/api/checkout matches include',
    detailColor: 'text-dimmed',
  },
  {
    id: 'create',
    label: 'create logger',
    hint: 'requestId · startTime',
    detail: 'POST · /api/checkout · req_8a2c',
    detailColor: 'text-muted',
  },
  {
    id: 'handler',
    label: 'handler',
    hint: 'log.set() x3',
    detail: 'context accumulates',
    detailColor: 'text-muted',
    setLines: [
      { key: 'user', value: '{ id: 1, plan: "pro" }' },
      { key: 'cart', value: '{ items: 3, total: 9999 }' },
      { key: 'payment', value: '{ method: "card", status: "ok" }' },
    ],
  },
  {
    id: 'tail',
    label: 'tail sample',
    hint: 'evlog:emit:keep',
    detail: 'no rule matched',
    detailColor: 'text-dimmed',
  },
  {
    id: 'head',
    label: 'head sample',
    hint: 'info: 100% kept',
    detail: 'random < rate',
    detailColor: 'text-dimmed',
  },
  {
    id: 'emit',
    label: 'emit',
    hint: 'WideEvent built',
    detail: 'logger sealed · ready to ship',
    detailColor: 'text-primary',
  },
  {
    id: 'enrich',
    label: 'enrich',
    hint: 'evlog:enrich',
    detail: '+ userAgent · + geo',
    detailColor: 'text-muted',
  },
  {
    id: 'drain',
    label: 'drain',
    hint: 'evlog:drain',
    detail: '→ axiom · → fs',
    detailColor: 'text-muted',
  },
]

const phase = ref(-1)
const setLineCount = ref(0)
const prefersReducedMotion = ref(false)
const wrapperRef = ref<HTMLElement>()

const HANDLER_INDEX = stages.findIndex(s => s.id === 'handler')

const STAGE_DELAY = 1100
const HANDLER_PRELUDE = 450
const HANDLER_LINE_INTERVAL = 650
const HANDLER_AFTER = 550
const TAIL_HOLD = 3800

function buildEvents() {
  const events: TimedEvent[] = []
  let cursor = 250

  for (let i = 0; i < stages.length; i++) {
    const idx = i
    const at = cursor
    events.push({
      at,
      run: () => {
        phase.value = idx
      },
    })

    if (idx === HANDLER_INDEX) {
      const lines = stages[idx]?.setLines?.length ?? 0
      for (let j = 0; j < lines; j++) {
        const lineIdx = j
        events.push({
          at: at + HANDLER_PRELUDE + lineIdx * HANDLER_LINE_INTERVAL,
          run: () => {
            setLineCount.value = lineIdx + 1
          },
        })
      }
      cursor += HANDLER_PRELUDE + lines * HANDLER_LINE_INTERVAL + HANDLER_AFTER
    } else {
      cursor += STAGE_DELAY
    }
  }

  return { events, totalDuration: cursor + TAIL_HOLD }
}

const { events, totalDuration } = buildEvents()

function resetState() {
  phase.value = -1
  setLineCount.value = 0
}

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
    phase.value = stages.length - 1
    setLineCount.value = stages[HANDLER_INDEX]?.setLines?.length ?? 0
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
  return phase.value >= i
}

function isActive(i: number) {
  return phase.value === i
}

const handlerSetLines = computed(() => stages[HANDLER_INDEX]?.setLines ?? [])

const isDone = computed(() => phase.value >= stages.length - 1)
</script>

<template>
  <div class="not-prose my-8" data-section="lifecycle-flow">
    <div ref="wrapperRef" class="overflow-hidden border border-muted bg-default">
      <div class="flex items-center gap-2 border-b border-muted px-4 py-2">
        <div class="flex gap-1.5">
          <div class="size-3 rounded-full bg-accented" />
          <div class="size-3 rounded-full bg-accented" />
          <div class="size-3 rounded-full bg-accented" />
        </div>
        <span class="ml-3 font-mono text-xs text-dimmed">request lifecycle</span>
        <div class="ml-auto flex items-center gap-2 font-mono text-[9px] tracking-widest">
          <span :class="isDone ? 'text-default' : 'text-primary'">
            {{ isDone ? 'DRAINED' : 'IN PIPELINE' }}
          </span>
          <span class="hidden sm:inline text-dimmed">·</span>
          <span class="hidden sm:inline text-dimmed">req_8a2c</span>
        </div>
        <div class="flex items-center gap-0.5 ml-1.5">
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
        <div class="relative px-4 sm:px-6 py-6 sm:py-7">
          <ol class="relative flex flex-col gap-3.5">
            <li
              v-for="(stage, i) in stages"
              :key="stage.id"
              class="relative flex items-start gap-3 sm:gap-4"
            >
              <span
                v-if="i < stages.length - 1"
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
                  <span
                    class="font-mono text-xs sm:text-sm transition-colors duration-300"
                    :class="isReached(i) ? 'text-highlighted' : 'text-dimmed'"
                  >
                    {{ stage.label }}
                  </span>
                  <span
                    class="font-mono text-[10px] sm:text-[11px] transition-colors duration-300"
                    :class="isReached(i) ? 'text-muted' : 'text-dimmed/70'"
                  >
                    {{ stage.hint }}
                  </span>
                </div>
                <p
                  class="font-mono text-[10px] sm:text-[11px] leading-relaxed transition-opacity duration-500"
                  :class="[
                    stage.detailColor,
                    isReached(i) ? 'opacity-100' : 'opacity-0',
                  ]"
                >
                  {{ stage.detail }}
                </p>
              </div>
            </li>
          </ol>
        </div>

        <div class="border-t border-default/30 lg:border-t-0 lg:border-l">
          <div class="flex items-center gap-2 border-b border-default/30 px-4 py-2.5">
            <UIcon name="i-lucide-layers" class="size-3 text-primary" />
            <span class="font-mono text-[10px] tracking-widest text-dimmed uppercase">
              context
            </span>
            <span
              v-if="isDone"
              class="ml-auto font-mono text-[9px] tracking-widest text-primary"
            >
              SEALED
            </span>
          </div>

          <div class="p-4 sm:p-5 font-mono text-[11px] sm:text-xs space-y-3">
            <div>
              <span class="text-dimmed">$</span>
              <span class="text-violet-400">POST</span>
              <span class="text-muted ml-1.5">/api/checkout</span>
            </div>

            <div class="space-y-1.5">
              <template v-for="(line, j) in handlerSetLines" :key="line.key">
                <div
                  class="flex items-start gap-2 transition-all duration-400"
                  :class="setLineCount > j ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2'"
                >
                  <span class="text-amber-400">log.set</span>
                  <span class="text-dimmed">(</span>
                  <span class="text-sky-400">{{ line.key }}</span>
                  <span class="text-dimmed">:</span>
                  <span class="text-emerald-400 truncate">{{ line.value }}</span>
                  <span class="text-dimmed">)</span>
                </div>
              </template>
            </div>

            <div
              class="border-t border-default/30 pt-3 transition-opacity duration-500"
              :class="isReached(5) ? 'opacity-100' : 'opacity-30'"
            >
              <div class="flex items-center gap-2 mb-1.5">
                <UIcon name="i-lucide-package-check" class="size-3 text-primary" />
                <span class="text-[10px] uppercase tracking-widest text-dimmed">wide event</span>
              </div>
              <pre class="text-[10px] sm:text-[11px] leading-relaxed text-muted overflow-x-auto"><code>{
  <span class="text-sky-400">level</span>:    <span class="text-emerald-400">"info"</span>,
  <span class="text-sky-400">method</span>:   <span class="text-emerald-400">"POST"</span>,
  <span class="text-sky-400">path</span>:     <span class="text-emerald-400">"/api/checkout"</span>,
  <span class="text-sky-400">duration</span>: <span class="text-pink-400">234</span>,
  <span class="text-sky-400">status</span>:   <span class="text-pink-400">200</span>,
  <span class="text-sky-400">user</span>:     { id: 1, plan: <span class="text-emerald-400">"pro"</span> },
  <span class="text-sky-400">cart</span>:     { items: 3, total: 9999 },
  <span class="text-sky-400">payment</span>:  { method: <span class="text-emerald-400">"card"</span>, status: <span class="text-emerald-400">"ok"</span> }<span
    class="transition-opacity duration-500"
    :class="isReached(6) ? 'opacity-100' : 'opacity-0'"
  >,
  <span class="text-sky-400">userAgent</span>: { browser: <span class="text-emerald-400">"chrome"</span> },
  <span class="text-sky-400">geo</span>:      { country: <span class="text-emerald-400">"FR"</span> }</span>
}</code></pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
