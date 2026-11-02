<script setup lang="ts">
import type { TimedEvent } from '~/composables/useTimedSequence'

interface SourceLine {
  no: number
  kind: 'import' | 'init' | 'debug' | 'info' | 'info-obj' | 'blank'
  text: string
  /** Index in `text` where to insert __source for info-obj lines. */
  insertAt?: number
}

const sourceLines: SourceLine[] = [
  { no: 1, kind: 'import', text: 'import { log } from \'evlog\'' },
  { no: 2, kind: 'init', text: 'initLogger({ env: { service: \'checkout\' } })' },
  { no: 3, kind: 'blank', text: '' },
  { no: 4, kind: 'debug', text: 'log.debug(\'checkout\', \'building cart from session\')' },
  { no: 5, kind: 'info', text: 'log.info(\'checkout\', \'cart built\')' },
  { no: 6, kind: 'info-obj', text: 'log.info({ action: \'checkout\', total: 99 })', insertAt: 'log.info({ action: \'checkout\', total: 99'.length },
  { no: 7, kind: 'debug', text: 'log.debug(\'checkout\', \'starting payment\')' },
  { no: 8, kind: 'info-obj', text: 'log.info({ action: \'paid\', amount: 99 })', insertAt: 'log.info({ action: \'paid\', amount: 99'.length },
]

type Mode = 'source' | 'building' | 'built'

const mode = ref<Mode>('source')
const phase = ref<'idle' | 'dev' | 'building' | 'prod' | 'hold'>('idle')
const debugStripped = ref(false)
const sourceInjected = ref(false)
const prefersReducedMotion = ref(false)
const wrapperRef = ref<HTMLElement>()

function resetState() {
  mode.value = 'source'
  phase.value = 'idle'
  debugStripped.value = false
  sourceInjected.value = false
}

const SHOW_AT = 200
const TRIGGER_AT = SHOW_AT + 1500
const STRIP_AT = TRIGGER_AT + 600
const INJECT_AT = STRIP_AT + 800
const BUILT_AT = INJECT_AT + 600
const HOLD_MS = 4500

function buildEvents(): TimedEvent[] {
  const events: TimedEvent[] = []
  events.push({ at: SHOW_AT - 50, run: () => {
    phase.value = 'dev' 
  } })
  events.push({ at: TRIGGER_AT, run: () => {
    phase.value = 'building'
    mode.value = 'building'
  } })
  events.push({ at: STRIP_AT, run: () => {
    debugStripped.value = true 
  } })
  events.push({ at: INJECT_AT, run: () => {
    sourceInjected.value = true 
  } })
  events.push({ at: BUILT_AT, run: () => {
    phase.value = 'prod'
    mode.value = 'built'
  } })
  events.push({ at: BUILT_AT + HOLD_MS - 200, run: () => {
    phase.value = 'hold' 
  } })
  return events
}

const events = buildEvents()
const totalDuration = BUILT_AT + HOLD_MS

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
    debugStripped.value = true
    sourceInjected.value = true
    mode.value = 'built'
    phase.value = 'prod'
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

function lineColor(kind: SourceLine['kind']) {
  if (kind === 'debug') return 'text-sky-400'
  if (kind === 'info' || kind === 'info-obj') return 'text-default'
  if (kind === 'import' || kind === 'init') return 'text-violet-400'
  return ''
}

function isStrippedLine(line: SourceLine) {
  return debugStripped.value && line.kind === 'debug'
}

function hasSourceTag(line: SourceLine) {
  return sourceInjected.value && line.kind === 'info-obj'
}

const builtLines = computed(() => {
  return sourceLines.filter(l => !(debugStripped.value && l.kind === 'debug') && !(l.kind === 'init' && phase.value === 'prod'))
})

const stripCount = computed(() => sourceLines.filter(l => l.kind === 'debug').length)
const injectCount = computed(() => sourceLines.filter(l => l.kind === 'info-obj').length)
</script>

<template>
  <div class="not-prose my-8" data-section="vite-strip-build">
    <div ref="wrapperRef" class="overflow-hidden border border-muted bg-default">
      <div class="flex items-center gap-2 border-b border-muted px-4 py-2">
        <div class="flex gap-1.5">
          <div class="size-3 rounded-full bg-accented" />
          <div class="size-3 rounded-full bg-accented" />
          <div class="size-3 rounded-full bg-accented" />
        </div>
        <span class="ml-3 font-mono text-xs text-dimmed">vite plugin · build-time transform</span>
        <span class="text-dimmed">·</span>
        <span
          class="font-mono text-[10px] tracking-widest uppercase transition-colors duration-300"
          :class="phase === 'building' ? 'text-amber-400' : (phase === 'prod' || phase === 'hold' ? 'text-primary' : 'text-dimmed')"
        >
          {{ phase === 'building' ? 'BUILDING' : (phase === 'prod' || phase === 'hold' ? 'PRODUCTION' : 'DEVELOPMENT') }}
        </span>
        <div class="ml-auto hidden md:flex items-center gap-1.5 font-mono text-[9px] tracking-widest text-dimmed">
          <UIcon name="i-custom-vite" class="size-3 text-primary" />
          <span>strip + sourceLocation</span>
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

      <div class="grid gap-px bg-muted/40 lg:grid-cols-2">
        <div class="bg-default p-4">
          <div class="flex items-center gap-2 mb-3">
            <UIcon name="i-lucide-file-code-2" class="size-3 text-primary" />
            <span class="font-mono text-[10px] tracking-widest uppercase text-dimmed">src/checkout.ts</span>
            <span class="ml-auto font-mono text-[9px] text-dimmed">source</span>
          </div>

          <div class="font-mono text-[11px] leading-relaxed">
            <div
              v-for="line in sourceLines"
              :key="line.no"
              class="flex items-baseline gap-3 transition-all duration-500"
              :class="{
                'opacity-30 line-through decoration-rose-400/60': isStrippedLine(line),
              }"
            >
              <span class="select-none text-dimmed/60 w-4 text-right shrink-0">{{ line.no }}</span>
              <span :class="lineColor(line.kind)">
                <template v-if="line.kind === 'blank'" />
                <template v-else>
                  {{ line.text }}
                </template>
              </span>
            </div>
          </div>
        </div>

        <div class="bg-default p-4 relative">
          <div class="flex items-center gap-2 mb-3">
            <UIcon name="i-lucide-package-check" class="size-3 text-primary" />
            <span class="font-mono text-[10px] tracking-widest uppercase text-dimmed">dist/checkout.js</span>
            <span class="ml-auto font-mono text-[9px]" :class="mode === 'built' ? 'text-emerald-400' : 'text-dimmed'">
              {{ mode === 'built' ? 'built · prod' : (mode === 'building' ? 'transforming…' : 'awaiting build') }}
            </span>
          </div>

          <div class="font-mono text-[11px] leading-relaxed">
            <template v-for="(line, idx) in builtLines" :key="line.no">
              <div class="flex items-baseline gap-3 transition-all duration-300">
                <span class="select-none text-dimmed/60 w-4 text-right shrink-0">{{ idx + 1 }}</span>
                <span :class="lineColor(line.kind)">
                  <template v-if="line.kind === 'info-obj' && hasSourceTag(line)">
                    {{ line.text.slice(0, line.insertAt) }}<span class="text-amber-400">, __source: <span class="text-emerald-400">'src/checkout.ts:{{ line.no }}'</span></span>{{ line.text.slice(line.insertAt) }}
                  </template>
                  <template v-else-if="line.kind === 'blank'" />
                  <template v-else>
                    {{ line.text }}
                  </template>
                </span>
              </div>
            </template>

            <div
              v-if="phase === 'idle' || phase === 'dev'"
              class="flex items-center gap-2 mt-3 font-mono text-[10px] text-dimmed"
            >
              <UIcon name="i-lucide-clock" class="size-3 text-dimmed/60" />
              run <span class="text-primary">vite build</span> to transform
            </div>
          </div>
        </div>
      </div>

      <div class="border-t border-muted/50 px-4 py-3 grid grid-cols-3 gap-3 font-mono text-[10px]">
        <div class="flex flex-col gap-0.5">
          <span class="text-dimmed text-[9px] tracking-widest uppercase">log.debug stripped</span>
          <span :class="debugStripped ? 'text-rose-400' : 'text-dimmed'">
            {{ debugStripped ? `${stripCount} call${stripCount === 1 ? '' : 's'} removed` : '—' }}
          </span>
        </div>
        <div class="flex flex-col gap-0.5 text-center">
          <span class="text-dimmed text-[9px] tracking-widest uppercase">__source injected</span>
          <span :class="sourceInjected ? 'text-amber-400' : 'text-dimmed'">
            {{ sourceInjected ? `${injectCount} call${injectCount === 1 ? '' : 's'}` : '—' }}
          </span>
        </div>
        <div class="flex flex-col gap-0.5 text-right">
          <span class="text-dimmed text-[9px] tracking-widest uppercase">initLogger()</span>
          <span :class="phase === 'prod' || phase === 'hold' ? 'text-emerald-400' : 'text-dimmed'">
            {{ phase === 'prod' || phase === 'hold' ? 'auto · compile-time' : 'manual' }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
