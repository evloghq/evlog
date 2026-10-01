<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import type { WideEvent } from 'evlog'

definePageMeta({ layout: false })
useHead({ title: 'evlog stream — test surface' })

interface Envelope {
  evlog: '1'
  type: 'event' | 'replay' | 'ping' | 'hello'
  data: unknown
}

interface DemoButton {
  label: string
  path: string
  method?: 'GET' | 'POST'
}

interface DemoGroup {
  title: string
  hint?: string
  items: DemoButton[]
}

const events = shallowRef<WideEvent[]>([])
const status = ref<'discovering' | 'connecting' | 'connected' | 'error' | 'unavailable'>('discovering')
const helloPayload = ref<{ evlogVersion: string; bufferSize?: number; heartbeatMs?: number } | null>(null)
const streamUrl = ref<string | null>(null)
const search = ref('')
const levelFilter = ref<'' | 'info' | 'warn' | 'error' | 'debug' | 'fatal' | 'trace'>('')
const paused = ref(false)
const droppedWhilePaused = ref(0)
const selected = ref<WideEvent | null>(null)
const lastPing = ref<number | null>(null)
const burstInFlight = ref(false)

let es: EventSource | null = null

function pushEvent(event: WideEvent) {
  if (paused.value) {
    droppedWhilePaused.value++
    return
  }
  events.value = [event, ...events.value].slice(0, 500)
}

function pickStringField(obj: WideEvent, key: string): string | undefined {
  const value = obj[key]
  return typeof value === 'string' ? value : undefined
}

function actionLabel(event: WideEvent) {
  return pickStringField(event, 'action')
    ?? pickStringField(event, 'message')
    ?? pickStringField(event, 'path')
    ?? ''
}

function isHelloPayload(data: unknown): data is NonNullable<typeof helloPayload.value> {
  return typeof data === 'object'
    && data !== null
    && 'evlogVersion' in data
    && typeof Reflect.get(data, 'evlogVersion') === 'string'
}

function isWideEvent(data: unknown): data is WideEvent {
  return typeof data === 'object'
    && data !== null
    && 'timestamp' in data
    && 'level' in data
    && 'service' in data
}

function eventMatches(event: WideEvent) {
  if (levelFilter.value && event.level !== levelFilter.value) return false
  const q = search.value.trim().toLowerCase()
  if (!q) return true
  try {
    return JSON.stringify(event).toLowerCase().includes(q)
  } catch {
    return false
  }
}

const filtered = computed(() => events.value.filter(eventMatches))

const errorRate = computed(() => {
  if (events.value.length === 0) return 0
  const errors = events.value.filter(e => e.level === 'error').length
  return Math.round((errors / events.value.length) * 100)
})

function fire(item: DemoButton) {
  $fetch(item.path, { method: item.method ?? 'GET' }).catch(() => {})
}

async function fireBurst() {
  if (burstInFlight.value) return
  burstInFlight.value = true
  const targets = [
    '/api/test/wide-event',
    '/api/test/success',
    '/api/test/tail-sampling/fast',
    '/api/test/tail-sampling/error',
    '/api/test/error',
  ]
  try {
    for (let i = 0; i < 30; i++) {
      const url = targets[i % targets.length]!
      $fetch(url).catch(() => {})
      await new Promise(r => setTimeout(r, 60))
    }
  } finally {
    burstInFlight.value = false
  }
}

const groups: DemoGroup[] = [
  {
    title: 'Levels',
    hint: 'See how levels render (info / warn / error)',
    items: [
      { label: 'info / wide-event', path: '/api/test/wide-event' },
      { label: 'info / success', path: '/api/test/success' },
      { label: 'error / 400', path: '/api/test/error' },
      { label: 'error / h3', path: '/api/test/h3-error' },
      { label: 'error / structured', path: '/api/test/structured-error' },
    ],
  },
  {
    title: 'Services',
    hint: 'Route-based service override',
    items: [
      { label: 'playground', path: '/api/test/wide-event' },
      { label: 'auth-service', path: '/api/auth/login', method: 'POST' },
      { label: 'payment-service', path: '/api/payment/process', method: 'POST' },
      { label: 'booking-service', path: '/api/booking/create', method: 'POST' },
    ],
  },
  {
    title: 'Catalog errors',
    hint: 'Defined in error-catalog.ts',
    items: [
      { label: 'payment-declined', path: '/api/test/catalog/payment-declined' },
      { label: 'insufficient-funds', path: '/api/test/catalog/insufficient-funds' },
      { label: 'fraud-detected', path: '/api/test/catalog/fraud-detected' },
      { label: 'standalone', path: '/api/test/catalog/standalone' },
      { label: 'error-internal', path: '/api/test/error-internal' },
    ],
  },
  {
    title: 'Tail sampling',
    hint: 'Should always be kept (sampling rules)',
    items: [
      { label: 'fast (sampled)', path: '/api/test/tail-sampling/fast' },
      { label: 'slow (>500ms)', path: '/api/test/tail-sampling/slow' },
      { label: 'error (status≥400)', path: '/api/test/tail-sampling/error' },
      { label: 'premium user', path: '/api/test/tail-sampling/premium' },
      { label: 'critical path', path: '/api/test/critical/important' },
    ],
  },
]

async function connect() {
  status.value = 'discovering'
  let info: { url: string | null }
  try {
    info = await $fetch<{ url: string | null }>('/api/_evlog/stream-info')
  } catch {
    status.value = 'unavailable'
    return
  }
  if (!info.url) {
    status.value = 'unavailable'
    return
  }
  streamUrl.value = info.url
  status.value = 'connecting'

  es = new EventSource(info.url)

  es.onopen = () => {
    status.value = 'connected'
  }
  es.onerror = () => {
    status.value = 'error'
  }
  es.onmessage = (e) => {
    let envelope: Envelope
    try {
      envelope = JSON.parse(e.data)
    } catch {
      return
    }
    if (envelope.evlog !== '1') return
    if (envelope.type === 'hello') {
      if (isHelloPayload(envelope.data)) {
        helloPayload.value = envelope.data
      }
      return
    }
    if (envelope.type === 'event' || envelope.type === 'replay') {
      if (isWideEvent(envelope.data)) {
        pushEvent(envelope.data)
      }
    }
  }

  es.addEventListener('ping', () => {
    lastPing.value = Date.now()
  })
}

onMounted(() => {
  connect()
})

onBeforeUnmount(() => {
  es?.close()
})
</script>

<template>
  <div class="flex h-dvh bg-default text-default text-[13px]">
    <aside class="w-72 shrink-0 border-r border-default flex flex-col min-h-0">
      <div class="px-4 pt-5 pb-3">
        <NuxtLink to="/" class="text-[11px] text-muted hover:text-default">
          ← back
        </NuxtLink>
        <h1 class="mt-2 text-sm font-semibold tracking-tight">
          stream test surface
        </h1>
        <p class="text-[11px] text-muted mt-0.5">
          Local-only verification panel
        </p>
        <a
          href="https://www.evlog.dev/build-on-top/consumer-recipes"
          target="_blank"
          rel="noopener"
          class="mt-2 inline-flex items-center gap-1 text-[10px] text-muted hover:text-default"
        >
          docs · build your own consumer →
        </a>
      </div>

      <div class="px-4 pb-3 space-y-2 text-[11px] text-muted border-b border-default">
        <div class="flex items-center gap-2">
          <span
            class="size-2 rounded-full"
            :class="{
              'bg-green-500': status === 'connected',
              'bg-yellow-500': status === 'connecting' || status === 'discovering',
              'bg-red-500': status === 'error' || status === 'unavailable',
            }"
          />
          <span class="capitalize">{{ status }}</span>
          <span v-if="helloPayload" class="ml-auto opacity-60">v{{ helloPayload.evlogVersion }}</span>
        </div>
        <div v-if="streamUrl" class="text-[10px] opacity-60 truncate" :title="streamUrl">
          {{ streamUrl }}
        </div>
        <div v-else-if="status === 'unavailable'" class="text-[10px] text-yellow-500">
          stream server not running. Set <code class="px-1 bg-elevated rounded">evlog: { stream: true }</code>.
        </div>
        <div class="grid grid-cols-2 gap-2 tabular-nums">
          <div class="rounded border border-default px-2 py-1">
            <div class="opacity-60">
              total
            </div>
            <div class="text-default text-sm">
              {{ events.length }}
            </div>
          </div>
          <div class="rounded border border-default px-2 py-1">
            <div class="opacity-60">
              error %
            </div>
            <div class="text-default text-sm">
              {{ errorRate }}
            </div>
          </div>
        </div>
        <div v-if="lastPing" class="text-[10px] opacity-60">
          last ping: {{ new Date(lastPing).toLocaleTimeString() }}
        </div>
      </div>

      <div class="flex-1 overflow-y-auto">
        <div
          v-for="group in groups"
          :key="group.title"
          class="px-4 py-3 border-b border-default"
        >
          <div class="text-[10px] uppercase tracking-wider text-muted">
            {{ group.title }}
          </div>
          <p v-if="group.hint" class="text-[10px] text-muted opacity-60 mt-0.5 mb-2">
            {{ group.hint }}
          </p>
          <div v-else class="mb-2" />
          <div class="space-y-1">
            <button
              v-for="item in group.items"
              :key="item.path"
              class="w-full text-left text-[11px] px-2 py-1 rounded border border-default hover:bg-elevated flex items-center gap-2"
              @click="fire(item)"
            >
              <span class="text-[9px] opacity-50 tabular-nums w-8">{{ item.method ?? 'GET' }}</span>
              <span class="flex-1 truncate">{{ item.label }}</span>
            </button>
          </div>
        </div>

        <div class="px-4 py-3">
          <div class="text-[10px] uppercase tracking-wider text-muted mb-2">
            Stress
          </div>
          <button
            class="w-full text-left text-[11px] px-2 py-1.5 rounded border border-default hover:bg-elevated disabled:opacity-50"
            :disabled="burstInFlight"
            @click="fireBurst"
          >
            {{ burstInFlight ? 'firing 30 events…' : 'Burst (30 events, 60ms apart)' }}
          </button>
          <p class="text-[10px] text-muted opacity-60 mt-1">
            For pause / scroll / backpressure tests.
          </p>
        </div>
      </div>
    </aside>

    <main class="flex-1 flex flex-col min-w-0">
      <div class="flex items-center gap-2 px-4 py-2 border-b border-default">
        <input
          v-model="search"
          type="search"
          placeholder="filter events…"
          class="flex-1 px-2 py-1 text-[12px] bg-elevated border border-default rounded outline-none focus:border-primary"
        >
        <select
          v-model="levelFilter"
          class="px-2 py-1 text-[12px] bg-elevated border border-default rounded outline-none focus:border-primary"
        >
          <option value="">
            all levels
          </option>
          <option value="info">
            info
          </option>
          <option value="warn">
            warn
          </option>
          <option value="error">
            error
          </option>
          <option value="debug">
            debug
          </option>
          <option value="fatal">
            fatal
          </option>
          <option value="trace">
            trace
          </option>
        </select>
        <button
          class="px-2 py-1 text-[12px] border border-default rounded hover:bg-elevated"
          :class="{ 'bg-primary/10 text-primary border-primary': paused }"
          @click="paused = !paused"
        >
          {{ paused ? `paused (${droppedWhilePaused})` : 'pause' }}
        </button>
        <button
          class="px-2 py-1 text-[12px] border border-default rounded hover:bg-elevated"
          @click="events = []; selected = null; droppedWhilePaused = 0"
        >
          clear
        </button>
      </div>

      <div class="flex flex-1 min-h-0">
        <div class="flex-1 overflow-y-auto">
          <table class="w-full">
            <thead class="text-[10px] uppercase tracking-wider text-muted">
              <tr>
                <th class="text-left px-3 py-2 font-normal w-24">
                  time
                </th>
                <th class="text-left px-3 py-2 font-normal w-16">
                  level
                </th>
                <th class="text-left px-3 py-2 font-normal w-32">
                  service
                </th>
                <th class="text-left px-3 py-2 font-normal w-16">
                  status
                </th>
                <th class="text-left px-3 py-2 font-normal">
                  action / path
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(event, idx) in filtered"
                :key="`${event.timestamp}-${idx}`"
                class="border-t border-default cursor-pointer hover:bg-elevated"
                :class="{ 'bg-primary/5': selected === event }"
                @click="selected = event"
              >
                <td class="px-3 py-1.5 text-[11px] tabular-nums text-muted">
                  {{ new Date(event.timestamp).toLocaleTimeString() }}
                </td>
                <td class="px-3 py-1.5">
                  <span
                    class="text-[10px] px-1.5 py-0.5 rounded"
                    :class="{
                      'bg-blue-500/10 text-blue-500': event.level === 'info',
                      'bg-yellow-500/10 text-yellow-500': event.level === 'warn',
                      'bg-red-500/10 text-red-500': event.level === 'error' || event.level === 'fatal',
                      'bg-purple-500/10 text-purple-500': event.level === 'debug' || event.level === 'trace',
                    }"
                  >
                    {{ event.level }}
                  </span>
                </td>
                <td class="px-3 py-1.5 text-[11px] truncate max-w-32 text-muted">
                  {{ event.service }}
                </td>
                <td class="px-3 py-1.5 text-[11px] tabular-nums text-muted">
                  {{ typeof event.status === 'number' ? event.status : '' }}
                </td>
                <td class="px-3 py-1.5 text-[11px] truncate">
                  {{ actionLabel(event) }}
                </td>
              </tr>
              <tr v-if="filtered.length === 0">
                <td colspan="5" class="text-center text-muted py-12 text-[12px]">
                  Waiting for events… click any test button on the left.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <aside class="w-96 shrink-0 border-l border-default overflow-y-auto p-4">
          <div class="flex items-center justify-between mb-2">
            <h2 class="text-[10px] uppercase tracking-wider text-muted">
              Inspector
            </h2>
            <button
              v-if="selected"
              class="text-[11px] text-muted hover:text-default"
              @click="selected = null"
            >
              clear
            </button>
          </div>
          <div v-if="!selected" class="text-[12px] text-muted leading-relaxed">
            Click any row in the table to inspect the full wide event JSON.
          </div>
          <pre v-else class="text-[11px] leading-relaxed font-mono whitespace-pre-wrap wrap-break-word"><code>{{ JSON.stringify(selected, null, 2) }}</code></pre>
        </aside>
      </div>
    </main>
  </div>
</template>
