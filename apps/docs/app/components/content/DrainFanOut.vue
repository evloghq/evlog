<script setup lang="ts">
import type { TimedEvent } from '~/composables/useTimedSequence'

type AdapterState = 'pending' | 'inflight' | 'ok' | 'failing' | 'backoff' | 'retrying'

interface Adapter {
  id: string
  name: string
  icon: string
  result: string
  okText: string
  flaky?: boolean
}

const adapters: Adapter[] = [
  { id: 'axiom', name: 'axiom', icon: 'i-custom-axiom', result: '200', okText: 'ingested' },
  { id: 'otlp', name: 'otlp', icon: 'i-simple-icons-opentelemetry', result: '200', okText: 'ingested', flaky: true },
  { id: 'sentry', name: 'sentry', icon: 'i-simple-icons-sentry', result: '200', okText: 'ingested' },
  { id: 'nuxthub', name: 'nuxthub', icon: 'i-simple-icons-nuxt', result: '200', okText: 'stored' },
  { id: 'fs', name: 'fs', icon: 'i-lucide-hard-drive', result: 'ok', okText: 'written' },
]

const state = ref<Record<string, AdapterState>>(
  Object.fromEntries(adapters.map(a => [a.id, 'pending'])),
)
const retryCount = ref<Record<string, number>>(
  Object.fromEntries(adapters.map(a => [a.id, 0])),
)
const eventSent = ref(false)
const allDone = ref(false)
const prefersReducedMotion = ref(false)
const wrapperRef = ref<HTMLElement>()

const EMIT_AT = 450
const ADAPTER_INTERVAL = 750
const RESOLVE_DELAY = 850
const FLAKY_FAIL_AT = 850
const FLAKY_BACKOFF_AT = 1500
const FLAKY_RETRY_AT = 3100
const FLAKY_OK_AT = 3900
const TAIL_HOLD = 5000

function resetState() {
  state.value = Object.fromEntries(adapters.map(a => [a.id, 'pending']))
  retryCount.value = Object.fromEntries(adapters.map(a => [a.id, 0]))
  eventSent.value = false
  allDone.value = false
}

function setState(id: string, s: AdapterState) {
  state.value = { ...state.value, [id]: s }
}

const events: TimedEvent[] = [
  { at: EMIT_AT, run: () => {
    eventSent.value = true 
  } },
]

let lastResolve = EMIT_AT

adapters.forEach((adapter, i) => {
  const flightStart = EMIT_AT + 200 + i * ADAPTER_INTERVAL

  events.push({
    at: flightStart,
    run: () => setState(adapter.id, 'inflight'),
  })

  if (adapter.flaky) {
    events.push({
      at: flightStart + FLAKY_FAIL_AT,
      run: () => {
        setState(adapter.id, 'failing')
        retryCount.value = { ...retryCount.value, [adapter.id]: 1 }
      },
    })
    events.push({
      at: flightStart + FLAKY_BACKOFF_AT,
      run: () => setState(adapter.id, 'backoff'),
    })
    events.push({
      at: flightStart + FLAKY_RETRY_AT,
      run: () => setState(adapter.id, 'retrying'),
    })
    events.push({
      at: flightStart + FLAKY_OK_AT,
      run: () => setState(adapter.id, 'ok'),
    })
    lastResolve = Math.max(lastResolve, flightStart + FLAKY_OK_AT)
  } else {
    events.push({
      at: flightStart + RESOLVE_DELAY,
      run: () => setState(adapter.id, 'ok'),
    })
    lastResolve = Math.max(lastResolve, flightStart + RESOLVE_DELAY)
  }
})

events.push({
  at: lastResolve + 200,
  run: () => {
    allDone.value = true 
  },
})

const totalDuration = lastResolve + 200 + TAIL_HOLD

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
    eventSent.value = true
    state.value = Object.fromEntries(adapters.map(a => [a.id, 'ok']))
    allDone.value = true
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

const successCount = computed(() =>
  Object.values(state.value).filter(s => s === 'ok').length,
)

function stateOf(id: string): AdapterState {
  return state.value[id] ?? 'pending'
}

function statusClass(s: AdapterState) {
  switch (s) {
    case 'pending': return 'text-dimmed'
    case 'inflight': return 'text-primary'
    case 'failing': return 'text-rose-400'
    case 'backoff': return 'text-amber-500'
    case 'retrying': return 'text-amber-400'
    case 'ok': return 'text-emerald-500'
  }
}

function statusIcon(s: AdapterState) {
  switch (s) {
    case 'pending': return 'i-lucide-circle-dashed'
    case 'inflight': return 'i-lucide-loader'
    case 'failing': return 'i-lucide-x'
    case 'backoff': return 'i-lucide-clock'
    case 'retrying': return 'i-lucide-refresh-ccw'
    case 'ok': return 'i-lucide-check'
  }
}

function statusLabel(adapter: Adapter, s: AdapterState) {
  switch (s) {
    case 'pending': return 'pending'
    case 'inflight': return 'POST →'
    case 'failing': return '503'
    case 'backoff': return `backoff ${retryCount.value[adapter.id] ?? 0}/2`
    case 'retrying': return 'retry →'
    case 'ok': return `${adapter.result} · ${adapter.okText}`
  }
}
</script>

<template>
  <div class="not-prose my-8" data-section="drain-fan-out">
    <div ref="wrapperRef" class="overflow-hidden border border-muted bg-default">
      <div class="flex items-center gap-2 border-b border-muted px-4 py-3">
        <div class="flex gap-1.5">
          <div class="size-3 rounded-full bg-accented" />
          <div class="size-3 rounded-full bg-accented" />
          <div class="size-3 rounded-full bg-accented" />
        </div>
        <span class="ml-3 font-mono text-xs text-dimmed">drain pipeline</span>
        <div class="ml-auto flex items-center gap-2 font-mono text-[9px] tracking-widest">
          <span :class="allDone ? 'text-emerald-500' : 'text-primary'">
            {{ successCount }}/{{ adapters.length }} delivered
          </span>
          <span class="hidden sm:inline text-dimmed">·</span>
          <span class="hidden sm:inline text-dimmed">Promise.allSettled</span>
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

      <div class="grid gap-0 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
        <div class="relative flex items-center justify-center px-6 py-8 lg:py-10 border-b border-default/30 lg:border-b-0 lg:border-r">
          <div
            class="relative border bg-elevated/30 p-4 transition-colors duration-500"
            :class="eventSent ? 'border-primary/25' : 'border-muted'"
          >
            <div class="flex items-center gap-2 mb-2.5">
              <UIcon name="i-lucide-package" class="size-3.5 text-primary" />
              <span class="font-mono text-[10px] uppercase tracking-widest text-dimmed">wide event</span>
              <span
                aria-hidden="true"
                class="ml-auto relative flex size-1.5 transition-opacity duration-500"
                :class="eventSent ? 'opacity-100' : 'opacity-0'"
              >
                <span class="absolute inline-flex size-full animate-ping rounded-full bg-primary/50" />
                <span class="relative inline-flex size-1.5 rounded-full bg-primary" />
              </span>
            </div>
            <pre class="font-mono text-[10px] leading-relaxed text-muted"><code>{
  level:    <span class="text-emerald-400">"info"</span>,
  method:   <span class="text-emerald-400">"POST"</span>,
  path:     <span class="text-emerald-400">"/checkout"</span>,
  duration: <span class="text-pink-400">234</span>,
  user:     {...},
  cart:     {...}
}</code></pre>
            <div
              class="absolute -bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-default border font-mono text-[9px] tracking-widest transition-colors duration-500"
              :class="eventSent ? 'text-primary border-primary/30' : 'text-dimmed border-muted'"
            >
              {{ eventSent ? 'EMITTED' : 'BUILDING' }}
            </div>
          </div>
        </div>

        <div class="px-3 sm:px-4 py-4 sm:py-5">
          <ol class="space-y-1">
            <li
              v-for="(adapter, i) in adapters"
              :key="adapter.id"
              class="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 sm:gap-3 py-1"
            >
              <div class="relative h-full flex items-center justify-center">
                <div
                  class="absolute left-1/2 w-px bg-muted/50"
                  :class="[
                    i === 0 ? 'top-1/2' : 'top-0',
                    i === adapters.length - 1 ? 'bottom-1/2' : 'bottom-0',
                  ]"
                />
                <div class="relative h-px w-3 bg-muted/60" />
                <div
                  class="absolute size-1.5 rounded-full transition-all duration-300"
                  :class="{
                    'bg-accented': stateOf(adapter.id) === 'pending',
                    'bg-primary shadow-[0_0_8px_var(--ui-color-primary-500)]': stateOf(adapter.id) === 'inflight' || stateOf(adapter.id) === 'retrying',
                    'bg-rose-400': stateOf(adapter.id) === 'failing',
                    'bg-amber-500': stateOf(adapter.id) === 'backoff',
                    'bg-emerald-500': stateOf(adapter.id) === 'ok',
                  }"
                  style="right: -4px"
                />
              </div>

              <div
                class="flex items-center gap-2 sm:gap-2.5 px-2.5 sm:px-3 py-2 border transition-all duration-300"
                :class="{
                  'border-muted/40 bg-transparent': stateOf(adapter.id) === 'pending',
                  'border-primary/30 bg-primary/4': stateOf(adapter.id) === 'inflight' || stateOf(adapter.id) === 'retrying',
                  'border-rose-400/30 bg-rose-400/4': stateOf(adapter.id) === 'failing',
                  'border-amber-500/30 bg-amber-500/4': stateOf(adapter.id) === 'backoff',
                  'border-emerald-500/20 bg-emerald-500/3': stateOf(adapter.id) === 'ok',
                }"
              >
                <UIcon
                  :name="adapter.icon"
                  class="size-3.5 transition-opacity duration-300"
                  :class="stateOf(adapter.id) === 'pending' ? 'opacity-50' : 'opacity-100'"
                />
                <span
                  class="font-mono text-xs transition-colors duration-300"
                  :class="stateOf(adapter.id) === 'pending' ? 'text-dimmed' : 'text-highlighted'"
                >
                  {{ adapter.name }}
                </span>
                <span
                  v-if="stateOf(adapter.id) === 'inflight' || stateOf(adapter.id) === 'retrying'"
                  aria-hidden="true"
                  class="ml-auto h-1 w-12 sm:w-16 overflow-hidden bg-muted/30 relative"
                >
                  <span class="absolute inset-y-0 inflight-pulse" />
                </span>
              </div>

              <div class="flex items-center gap-1.5 font-mono text-[10px] sm:text-[11px] tracking-wide">
                <UIcon
                  :name="statusIcon(stateOf(adapter.id))"
                  class="size-3 transition-colors duration-300"
                  :class="[
                    statusClass(stateOf(adapter.id)),
                    stateOf(adapter.id) === 'inflight' || stateOf(adapter.id) === 'retrying' ? 'animate-spin' : '',
                  ]"
                />
                <span
                  class="transition-colors duration-300 tabular-nums whitespace-nowrap"
                  :class="statusClass(stateOf(adapter.id))"
                >
                  {{ statusLabel(adapter, stateOf(adapter.id)) }}
                </span>
              </div>
            </li>
          </ol>
        </div>
      </div>

      <div class="border-t border-muted/50 px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[10px] text-dimmed">
        <span class="inline-flex items-center gap-1.5">
          <UIcon name="i-lucide-zap" class="size-3 text-primary" />
          fire-and-forget
        </span>
        <span class="inline-flex items-center gap-1.5">
          <UIcon name="i-lucide-refresh-ccw" class="size-3 text-amber-500" />
          retry with backoff
        </span>
        <span class="inline-flex items-center gap-1.5">
          <UIcon name="i-lucide-shield-check" class="size-3 text-emerald-500" />
          one failure ≠ blocked response
        </span>
        <span
          class="ml-auto transition-opacity duration-500"
          :class="allDone ? 'opacity-100 text-emerald-500' : 'opacity-0'"
        >
          ✓ all destinations resolved
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.inflight-pulse {
  width: 35%;
  background: linear-gradient(
    90deg,
    transparent 0%,
    color-mix(in srgb, var(--ui-color-primary-500) 80%, transparent) 50%,
    transparent 100%
  );
  animation: inflight-flow 1.1s ease-in-out infinite;
}

@keyframes inflight-flow {
  0% { left: -35%; }
  100% { left: 100%; }
}

@media (prefers-reduced-motion: reduce) {
  .inflight-pulse {
    animation: none;
  }
}
</style>
