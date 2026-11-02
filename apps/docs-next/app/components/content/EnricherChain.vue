<script setup lang="ts">
import type { TimedEvent } from '~/composables/useTimedSequence'

interface Enricher {
  id: string
  name: string
  icon: string
  fields: { key: string; value: string }[]
}

const enrichers: Enricher[] = [
  {
    id: 'ua',
    name: 'UserAgent',
    icon: 'i-lucide-monitor-smartphone',
    fields: [
      { key: 'userAgent.browser', value: '"chrome 142"' },
      { key: 'userAgent.os', value: '"macOS 26"' },
      { key: 'userAgent.device', value: '"desktop"' },
    ],
  },
  {
    id: 'geo',
    name: 'Geo',
    icon: 'i-lucide-map-pin',
    fields: [
      { key: 'geo.country', value: '"FR"' },
      { key: 'geo.city', value: '"Paris"' },
      { key: 'geo.region', value: '"Île-de-France"' },
    ],
  },
  {
    id: 'size',
    name: 'RequestSize',
    icon: 'i-lucide-hard-drive',
    fields: [
      { key: 'request.size', value: '1248' },
      { key: 'response.size', value: '8412' },
    ],
  },
  {
    id: 'trace',
    name: 'TraceContext',
    icon: 'i-lucide-route',
    fields: [
      { key: 'trace.traceId', value: '"4bf92f3577b34da6a3ce…"' },
      { key: 'trace.spanId', value: '"00f067aa0ba902b7"' },
    ],
  },
]

const enricherActive = ref<number>(-1)
const enricherDone = ref<boolean[]>(enrichers.map(() => false))
const drained = ref(false)
const prefersReducedMotion = ref(false)
const wrapperRef = ref<HTMLElement>()

function resetState() {
  enricherActive.value = -1
  enricherDone.value = enrichers.map(() => false)
  drained.value = false
}

const ENTER_AT = 200
const STEP_INTERVAL = 1100
const ACTIVATE_DURATION = 350
const DRAIN_AT = ENTER_AT + enrichers.length * STEP_INTERVAL + 400
const TAIL_HOLD = 4500

function buildEvents(): TimedEvent[] {
  const events: TimedEvent[] = []

  enrichers.forEach((_, i) => {
    const at = ENTER_AT + i * STEP_INTERVAL
    events.push({
      at,
      run: () => {
        enricherActive.value = i
      },
    })
    events.push({
      at: at + ACTIVATE_DURATION,
      run: () => {
        enricherDone.value = enricherDone.value.map((v, idx) => idx === i ? true : v)
      },
    })
  })

  events.push({
    at: DRAIN_AT,
    run: () => {
      enricherActive.value = -1
      drained.value = true
    },
  })

  return events
}

const events = buildEvents()
const totalDuration = DRAIN_AT + TAIL_HOLD

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
    enricherDone.value = enrichers.map(() => true)
    drained.value = true
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

function isActive(i: number) {
  return enricherActive.value === i
}
function isDone(i: number) {
  return enricherDone.value[i]
}
function isReached(i: number) {
  return isActive(i) || isDone(i)
}

const totalEnrichedFields = computed(() =>
  enrichers.reduce((acc, e, i) => acc + (enricherDone.value[i] ? e.fields.length : 0), 0),
)
</script>

<template>
  <div class="not-prose my-8" data-section="enricher-chain">
    <div ref="wrapperRef" class="overflow-hidden border border-muted bg-default">
      <div class="flex items-center gap-2 border-b border-muted px-4 py-2.5">
        <UIcon name="i-lucide-sparkles" class="size-3.5 text-primary" />
        <span class="font-mono text-xs text-dimmed">enrich pipeline</span>
        <span class="text-dimmed">·</span>
        <span class="font-mono text-[10px] tracking-widest uppercase transition-colors duration-300" :class="drained ? 'text-primary' : enricherActive >= 0 ? 'text-amber-400' : 'text-dimmed'">
          {{ drained ? 'ready for drains' : enricherActive >= 0 ? `enriching · ${enrichers[enricherActive]?.name ?? ''}` : 'idle' }}
        </span>
        <div class="ml-auto hidden sm:flex items-center gap-1.5 font-mono text-[9px] tracking-widest text-dimmed">
          <span>evlog:enrich · runs after emit, before drains</span>
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

      <div class="px-4 sm:px-6 py-5">
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-5">
          <div
            v-for="(enricher, i) in enrichers"
            :key="enricher.id"
            class="relative border bg-elevated/30 px-3 py-3 transition-all duration-400"
            :class="{
              'border-primary/50 shadow-[0_0_16px_color-mix(in_srgb,var(--ui-color-primary-500)_18%,transparent)]': isActive(i),
              'border-emerald-500/30': isDone(i) && !isActive(i),
              'border-muted': !isReached(i),
            }"
          >
            <div class="flex items-center gap-2 mb-1.5">
              <UIcon
                :name="enricher.icon"
                class="size-3.5 transition-colors duration-300"
                :class="{
                  'text-primary': isActive(i),
                  'text-emerald-400': isDone(i) && !isActive(i),
                  'text-dimmed/60': !isReached(i),
                }"
              />
              <span
                class="font-mono text-[11px] transition-colors duration-300"
                :class="isReached(i) ? 'text-highlighted' : 'text-dimmed'"
              >
                {{ enricher.name }}
              </span>
              <span
                v-if="isActive(i)"
                class="ml-auto size-1.5 rounded-full bg-primary animate-pulse"
                aria-hidden="true"
              />
              <UIcon
                v-else-if="isDone(i)"
                name="i-lucide-check"
                class="ml-auto size-3 text-emerald-400"
              />
            </div>
            <div class="font-mono text-[9px] text-dimmed">
              +{{ enricher.fields.length }} field{{ enricher.fields.length > 1 ? 's' : '' }}
            </div>

            <div
              v-if="i < enrichers.length - 1"
              aria-hidden="true"
              class="hidden sm:block absolute top-1/2 right-0 translate-x-full -translate-y-1/2 z-10"
            >
              <UIcon
                name="i-lucide-chevron-right"
                class="size-4 transition-colors duration-300"
                :class="isDone(i) ? 'text-primary/60' : 'text-dimmed/40'"
              />
            </div>
          </div>
        </div>

        <div
          class="border bg-elevated/30 transition-colors duration-500"
          :class="drained ? 'border-primary/30' : 'border-muted'"
        >
          <div class="flex items-center gap-2 border-b border-default/30 px-3.5 py-2">
            <UIcon name="i-lucide-package" class="size-3 text-primary" />
            <span class="font-mono text-[10px] tracking-widest uppercase text-dimmed">wide event</span>
            <span class="text-dimmed">·</span>
            <span class="font-mono text-[10px] text-muted">{{ 4 + totalEnrichedFields }} fields</span>
            <span
              v-if="drained"
              class="ml-auto font-mono text-[9px] tracking-widest text-primary"
            >
              READY
            </span>
          </div>

          <div class="px-3.5 sm:px-4 py-3 font-mono text-[10px] sm:text-[11px] leading-relaxed">
            <div class="text-muted mb-1">
              {
            </div>
            <div class="pl-4 space-y-0.5 text-muted">
              <div class="flex items-baseline gap-2">
                <span class="text-sky-400">method</span><span class="text-dimmed">:</span>
                <span class="text-emerald-400">"POST"</span><span class="text-dimmed">,</span>
              </div>
              <div class="flex items-baseline gap-2">
                <span class="text-sky-400">path</span><span class="text-dimmed">:</span>
                <span class="text-emerald-400">"/api/checkout"</span><span class="text-dimmed">,</span>
              </div>
              <div class="flex items-baseline gap-2">
                <span class="text-sky-400">status</span><span class="text-dimmed">:</span>
                <span class="text-pink-400">200</span><span class="text-dimmed">,</span>
              </div>
              <div class="flex items-baseline gap-2">
                <span class="text-sky-400">duration</span><span class="text-dimmed">:</span>
                <span class="text-pink-400">234</span><span class="text-dimmed">,</span>
              </div>

              <template
                v-for="(enricher, i) in enrichers"
                :key="`fields-${enricher.id}`"
              >
                <div
                  v-for="(field, fi) in enricher.fields"
                  :key="`f-${enricher.id}-${field.key}`"
                  class="flex items-baseline gap-2 transition-all duration-400"
                  :class="isDone(i) ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-1'"
                  :style="{ transitionDelay: isDone(i) ? `${fi * 80}ms` : '0ms' }"
                >
                  <span class="text-sky-400">{{ field.key }}</span><span class="text-dimmed">:</span>
                  <span class="text-emerald-400">{{ field.value }}</span><span class="text-dimmed">,</span>
                  <span class="text-primary/70 text-[9px] uppercase tracking-widest ml-auto">+{{ enricher.name }}</span>
                </div>
              </template>
            </div>
            <div class="text-muted mt-1">
              }
            </div>
          </div>
        </div>
      </div>

      <div class="border-t border-muted/50 px-4 py-3 grid grid-cols-3 gap-3 font-mono text-[10px]">
        <div class="flex flex-col gap-0.5">
          <span class="text-dimmed text-[9px] tracking-widest uppercase">base fields</span>
          <span class="text-muted">4</span>
        </div>
        <div class="flex flex-col gap-0.5 text-center">
          <span class="text-dimmed text-[9px] tracking-widest uppercase">enriched fields</span>
          <span class="text-emerald-400 tabular-nums">+{{ totalEnrichedFields }}</span>
        </div>
        <div class="flex flex-col gap-0.5 text-right">
          <span class="text-dimmed text-[9px] tracking-widest uppercase">app code touched</span>
          <span class="text-primary">0 lines</span>
        </div>
      </div>
    </div>
  </div>
</template>
