<script setup lang="ts">
import type { TimedEvent } from '~/composables/useTimedSequence'

interface Line {
  file: 0 | 1
  preview: string
  level: 'info' | 'warn' | 'error'
}

const lines: Line[] = [
  { file: 0, preview: 'POST /api/auth/login → 200', level: 'info' },
  { file: 0, preview: 'GET /api/me → 200', level: 'info' },
  { file: 0, preview: 'POST /api/checkout → 500', level: 'error' },
  { file: 0, preview: 'POST /api/email → 200', level: 'info' },
  { file: 0, preview: 'GET /healthz → 200', level: 'info' },
  { file: 1, preview: 'POST /api/auth/refresh → 200', level: 'info' },
  { file: 1, preview: 'GET /api/cart → 401', level: 'warn' },
  { file: 1, preview: 'POST /api/checkout → 200', level: 'info' },
]

const visible = ref<boolean[]>(lines.map(() => false))
const cursor = ref(-1)
const rotated = ref(false)
const totalConsumed = ref(0)
const errorsConsumed = ref(0)
const prefersReducedMotion = ref(false)
const wrapperRef = ref<HTMLElement>()

function resetState() {
  visible.value = lines.map(() => false)
  cursor.value = -1
  rotated.value = false
  totalConsumed.value = 0
  errorsConsumed.value = 0
}

const FIRST_APPEND_DELAY_MS = 200
const LINE_APPEND_INTERVAL_MS = 500
const APPEND_TO_CURSOR_MS = 220
const TAIL_HOLD_MS = 2800

function buildEvents(): TimedEvent[] {
  const events: TimedEvent[] = []
  let t = FIRST_APPEND_DELAY_MS

  lines.forEach((line, i) => {
    events.push({
      at: t,
      run: () => {
        visible.value = visible.value.map((v, idx) => (idx === i ? true : v))
        if (line.file === 1) rotated.value = true
      },
    })
    t += APPEND_TO_CURSOR_MS
    events.push({
      at: t,
      run: () => {
        cursor.value = i
        totalConsumed.value = i + 1
        if (line.level === 'error') errorsConsumed.value++
      },
    })
    t += LINE_APPEND_INTERVAL_MS - APPEND_TO_CURSOR_MS
  })

  return events
}

const events = buildEvents()
const totalDuration = FIRST_APPEND_DELAY_MS + lines.length * LINE_APPEND_INTERVAL_MS + TAIL_HOLD_MS

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
    visible.value = lines.map(() => true)
    cursor.value = lines.length - 1
    rotated.value = true
    totalConsumed.value = lines.length
    errorsConsumed.value = lines.filter(l => l.level === 'error').length
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

function levelClass(l: Line['level']) {
  switch (l) {
    case 'info': return 'text-sky-400'
    case 'warn': return 'text-amber-400'
    case 'error': return 'text-rose-400'
  }
}

const file0Lines = computed(() => lines.map((l, i) => ({ line: l, i })).filter(x => x.line.file === 0))
const file1Lines = computed(() => lines.map((l, i) => ({ line: l, i })).filter(x => x.line.file === 1))
const file0Visible = computed(() => visible.value.filter((v, i) => v && lines[i]?.file === 0).length)
const file1Visible = computed(() => visible.value.filter((v, i) => v && lines[i]?.file === 1).length)
const progress = computed(() => cursor.value < 0 ? 0 : ((cursor.value + 1) / lines.length) * 100)
</script>

<template>
  <div class="not-prose my-8" data-section="ndjson-tail">
    <div ref="wrapperRef" class="overflow-hidden border border-muted bg-default">
      <div class="flex items-center gap-2 border-b border-muted px-3 py-1.5">
        <UIcon name="i-lucide-folder-search" class="size-3 text-primary" />
        <span class="font-mono text-[11px] text-dimmed">tailFsLogs()</span>
        <span class="text-dimmed text-[10px]">·</span>
        <span class="font-mono text-[9px] tracking-widest uppercase text-amber-400">following</span>
        <div class="ml-auto hidden sm:flex items-center gap-1.5 font-mono text-[9px] tracking-widest text-dimmed">
          <span>{{ rotated ? '2 files' : '1 file' }}</span>
        </div>
        <div class="flex items-center gap-0.5 ml-1">
          <button type="button" class="size-5 inline-flex items-center justify-center text-dimmed hover:text-default focus:text-default focus:outline-none transition-colors" :aria-label="paused ? 'Play animation' : 'Pause animation'" :disabled="!started" @click="toggle">
            <UIcon :name="paused ? 'i-lucide-play' : 'i-lucide-pause'" class="size-3" />
          </button>
          <button type="button" class="size-5 inline-flex items-center justify-center text-dimmed hover:text-default focus:text-default focus:outline-none transition-colors" aria-label="Restart animation" :disabled="!started" @click="restart">
            <UIcon name="i-lucide-rotate-ccw" class="size-3" />
          </button>
        </div>
      </div>

      <div class="grid gap-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,200px)]">
        <div class="px-3 py-2.5 border-b border-default/30 sm:border-b-0 sm:border-r font-mono text-[10px] leading-snug">
          <div class="flex items-center gap-1.5 mb-1.5 text-dimmed">
            <UIcon name="i-lucide-file-text" class="size-2.5" />
            <span class="text-[9px] tracking-wider truncate">.evlog/logs/2026-05-08.jsonl</span>
            <span class="ml-auto text-[9px] tabular-nums whitespace-nowrap">{{ file0Visible }}/{{ file0Lines.length }}</span>
          </div>
          <div class="space-y-0.5">
            <div
              v-for="entry in file0Lines"
              :key="`f0-${entry.i}`"
              class="text-muted truncate transition-opacity duration-200 h-[18px] flex items-center"
              :class="visible[entry.i] ? 'opacity-100' : 'opacity-0'"
            >
              <span :class="levelClass(entry.line.level)">[{{ entry.line.level }}]</span>
              <span class="ml-1 text-dimmed">{{ entry.line.preview }}</span>
            </div>
          </div>

          <div class="mt-2 pt-2 border-t border-muted/30 transition-opacity duration-300" :class="rotated ? 'opacity-100' : 'opacity-50'">
            <div class="flex items-center gap-1.5 mb-1.5 text-dimmed">
              <UIcon name="i-lucide-file-plus" class="size-2.5" :class="rotated ? 'text-primary' : 'text-dimmed'" />
              <span class="text-[9px] tracking-wider truncate">.evlog/logs/2026-05-09.jsonl</span>
              <span class="ml-auto text-[9px] tabular-nums whitespace-nowrap" :class="rotated ? 'text-primary' : 'text-dimmed'">
                {{ rotated ? `rotated · ${file1Visible}/${file1Lines.length}` : 'awaiting rotation' }}
              </span>
            </div>
            <div class="space-y-0.5">
              <div
                v-for="entry in file1Lines"
                :key="`f1-${entry.i}`"
                class="text-muted truncate transition-opacity duration-200 h-[18px] flex items-center"
                :class="visible[entry.i] ? 'opacity-100' : 'opacity-0'"
              >
                <span :class="levelClass(entry.line.level)">[{{ entry.line.level }}]</span>
                <span class="ml-1 text-dimmed">{{ entry.line.preview }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="px-3 py-2.5">
          <div class="flex items-center gap-1.5 mb-2 text-dimmed">
            <UIcon name="i-lucide-cpu" class="size-2.5 text-emerald-400" />
            <span class="font-mono text-[9px] tracking-widest uppercase">reader</span>
            <span class="ml-auto font-mono text-[10px] text-emerald-400 tabular-nums">{{ cursor + 1 }}/{{ lines.length }}</span>
          </div>

          <div class="h-1 bg-muted/30 mb-2.5 overflow-hidden">
            <div
              class="h-full bg-emerald-500/60 transition-all duration-300"
              :style="{ width: `${progress}%` }"
            />
          </div>

          <div class="font-mono text-[10px] leading-snug space-y-0.5">
            <div class="flex justify-between items-center h-[18px]">
              <span class="text-dimmed">consumed</span>
              <span class="text-muted tabular-nums">{{ totalConsumed }}</span>
            </div>
            <div class="flex justify-between items-center h-[18px]">
              <span class="text-dimmed">errors</span>
              <span class="text-rose-400 tabular-nums">{{ errorsConsumed }}</span>
            </div>
            <div class="flex justify-between items-center h-[18px]">
              <span class="text-dimmed">files seen</span>
              <span class="text-muted tabular-nums">{{ rotated ? 2 : 1 }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="border-t border-muted/50 px-3 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[9px] text-dimmed">
        <span class="inline-flex items-center gap-1">
          <UIcon name="i-lucide-folder" class="size-2.5 text-primary" />
          NDJSON · 1 line / event
        </span>
        <span class="inline-flex items-center gap-1">
          <UIcon name="i-lucide-rotate-ccw" class="size-2.5 text-amber-400" />
          daily rotation
        </span>
        <span class="inline-flex items-center gap-1">
          <UIcon name="i-lucide-shield-check" class="size-2.5 text-emerald-500" />
          partial-write safe
        </span>
      </div>
    </div>
  </div>
</template>
