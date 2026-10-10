<script setup lang="ts">
import type { TimedEvent } from '~/composables/useTimedSequence'

interface ErrorField {
  key: string
  value: string
  hint: string
  color: string
}

const fields: ErrorField[] = [
  { key: 'message', value: '"Payment failed"', hint: 'what went wrong', color: 'text-emerald-400' },
  { key: 'status', value: '402', hint: 'HTTP status', color: 'text-pink-400' },
  { key: 'why', value: '"Card declined by issuer"', hint: 'technical reason', color: 'text-emerald-400' },
  { key: 'fix', value: '"Try a different card"', hint: 'actionable advice', color: 'text-emerald-400' },
  { key: 'link', value: '"/docs/payments/declined"', hint: 'docs link', color: 'text-emerald-400' },
]

type Phase = 'idle' | 'thrown' | 'enriching' | 'caught' | 'rendered'

const phase = ref<Phase>('idle')
const fieldRevealed = ref<boolean[]>(fields.map(() => false))
const prefersReducedMotion = ref(false)
const wrapperRef = ref<HTMLElement>()

function resetState() {
  phase.value = 'idle'
  fieldRevealed.value = fields.map(() => false)
}

const THROW_AT = 200
const ENRICH_AT = 700
const FIELD_INTERVAL = 550
const CAUGHT_AT = ENRICH_AT + fields.length * FIELD_INTERVAL + 300
const RENDER_AT = CAUGHT_AT + 700
const TAIL_HOLD = 4500

function buildEvents(): TimedEvent[] {
  const events: TimedEvent[] = []

  events.push({
    at: THROW_AT,
    run: () => {
      phase.value = 'thrown'
      fieldRevealed.value = fieldRevealed.value.map((_, idx) => idx === 0)
    },
  })

  events.push({
    at: ENRICH_AT - 50,
    run: () => {
      phase.value = 'enriching'
    },
  })

  fields.forEach((_, i) => {
    if (i === 0) return
    events.push({
      at: ENRICH_AT + i * FIELD_INTERVAL,
      run: () => {
        fieldRevealed.value = fieldRevealed.value.map((v, idx) => idx === i ? true : v)
      },
    })
  })

  events.push({
    at: CAUGHT_AT,
    run: () => {
      phase.value = 'caught'
    },
  })

  events.push({
    at: RENDER_AT,
    run: () => {
      phase.value = 'rendered'
    },
  })

  return events
}

const events = buildEvents()
const totalDuration = RENDER_AT + TAIL_HOLD

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
    fieldRevealed.value = fields.map(() => true)
    phase.value = 'rendered'
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

const reachedCaught = computed(() => phase.value === 'caught' || phase.value === 'rendered')
const reachedRendered = computed(() => phase.value === 'rendered')
</script>

<template>
  <div class="not-prose my-8" data-section="structured-error-context">
    <div ref="wrapperRef" class="overflow-hidden border border-muted bg-default">
      <div class="flex items-center gap-2 border-b border-muted px-4 py-2.5">
        <UIcon name="i-lucide-shield-alert" class="size-3.5 text-primary" />
        <span class="font-mono text-xs text-dimmed">error context</span>
        <span class="text-dimmed">·</span>
        <span class="font-mono text-[10px] tracking-widest uppercase transition-colors duration-300" :class="reachedRendered ? 'text-primary' : 'text-amber-400'">
          {{ phase === 'idle' ? 'idle' : phase === 'thrown' ? 'thrown' : phase === 'enriching' ? 'enriching…' : phase === 'caught' ? 'caught downstream' : 'shown to user' }}
        </span>
        <div class="ml-auto hidden sm:flex items-center gap-1.5 font-mono text-[9px] tracking-widest text-dimmed">
          <span>parseError() · safe by default</span>
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

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-px bg-muted/40">
        <div class="bg-default px-4 sm:px-5 py-4">
          <div class="flex items-center gap-2 mb-3">
            <span class="font-mono text-[10px] tracking-widest uppercase text-dimmed">vanilla</span>
            <span class="text-dimmed">·</span>
            <span class="font-mono text-[10px] text-muted">throw new Error()</span>
          </div>

          <div class="border border-muted bg-elevated/30 px-3.5 py-3 mb-3 min-h-[180px]">
            <pre class="font-mono text-[10px] sm:text-[11px] leading-relaxed text-muted overflow-x-auto"><code><span class="text-violet-400">throw</span> <span class="text-amber-400">new</span> <span class="text-sky-400">Error</span>(<span class="text-emerald-400">"Payment failed"</span>)
</code></pre>
            <div class="mt-3 pt-3 border-t border-default/30 transition-opacity duration-500" :class="reachedCaught ? 'opacity-100' : 'opacity-0'">
              <div class="font-mono text-[9px] tracking-widest uppercase text-dimmed mb-1.5">
                ↓ caller catches
              </div>
              <pre class="font-mono text-[10px] sm:text-[11px] leading-relaxed text-muted overflow-x-auto"><code>err.message <span class="text-dimmed">→</span> <span class="text-emerald-400">"Payment failed"</span>
err.status  <span class="text-dimmed">→</span> <span class="text-rose-400/80">undefined</span>
err.why     <span class="text-dimmed">→</span> <span class="text-rose-400/80">undefined</span>
err.fix     <span class="text-dimmed">→</span> <span class="text-rose-400/80">undefined</span></code></pre>
            </div>
          </div>

          <div
            class="border border-rose-500/30 bg-rose-500/4 px-3 py-3 transition-all duration-500 min-h-[88px]"
            :class="reachedRendered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'"
          >
            <div class="flex items-center gap-2 mb-1.5">
              <UIcon name="i-lucide-circle-alert" class="size-3.5 text-rose-400" />
              <span class="font-mono text-[10px] tracking-widest uppercase text-rose-400">error</span>
            </div>
            <p class="font-mono text-[11px] text-muted leading-relaxed">
              Something went wrong.<br>Please try again.
            </p>
          </div>
        </div>

        <div class="bg-default px-4 sm:px-5 py-4">
          <div class="flex items-center gap-2 mb-3">
            <span class="font-mono text-[10px] tracking-widest uppercase text-dimmed">structured</span>
            <span class="text-dimmed">·</span>
            <span class="font-mono text-[10px] text-primary">createError()</span>
          </div>

          <div
            class="border bg-elevated/30 px-3.5 py-3 mb-3 transition-colors duration-500 min-h-[180px]"
            :class="reachedRendered ? 'border-primary/25' : 'border-muted'"
          >
            <pre class="font-mono text-[10px] sm:text-[11px] leading-relaxed text-muted overflow-x-auto"><code><span class="text-violet-400">throw</span> <span class="text-sky-400">createError</span>({
<template v-for="(field, i) in fields" :key="`f-${field.key}`"><span
  class="transition-all duration-500"
  :class="fieldRevealed[i] ? 'opacity-100' : 'opacity-0'"
>  <span class="text-sky-400">{{ field.key }}</span>: <span :class="field.color">{{ field.value }}</span>{{ i < fields.length - 1 ? ',' : '' }}<span class="text-dimmed/50"> // {{ field.hint }}</span>
</span></template>})</code></pre>
            <div class="mt-3 pt-3 border-t border-default/30 transition-opacity duration-500" :class="reachedCaught ? 'opacity-100' : 'opacity-0'">
              <div class="font-mono text-[9px] tracking-widest uppercase text-dimmed mb-1.5">
                ↓ parseError(err)
              </div>
              <pre class="font-mono text-[10px] sm:text-[11px] leading-relaxed text-muted overflow-x-auto"><code>{ <span class="text-sky-400">message</span>, <span class="text-sky-400">status</span>, <span class="text-sky-400">why</span>, <span class="text-sky-400">fix</span>, <span class="text-sky-400">link</span> }
<span class="text-emerald-400">all fields available · safe by default</span></code></pre>
            </div>
          </div>

          <div
            class="border border-primary/30 bg-primary/4 px-3 py-3 transition-all duration-500 min-h-[88px]"
            :class="reachedRendered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'"
          >
            <div class="flex items-center gap-2 mb-1.5">
              <UIcon name="i-lucide-circle-alert" class="size-3.5 text-primary" />
              <span class="font-mono text-[10px] tracking-widest uppercase text-primary">payment failed · 402</span>
            </div>
            <p class="font-mono text-[11px] text-muted leading-relaxed mb-1.5">
              Card declined by issuer. Try a different card.
            </p>
            <a class="inline-flex items-center gap-1 font-mono text-[10px] text-primary">
              read more
              <UIcon name="i-lucide-arrow-up-right" class="size-3" />
            </a>
          </div>
        </div>
      </div>

      <div class="border-t border-muted/50 px-4 py-3 grid grid-cols-2 gap-3 font-mono text-[10px]">
        <div class="flex items-center gap-1.5 text-muted">
          <UIcon name="i-lucide-x" class="size-3 text-rose-400" />
          <span>1 field · user has to guess</span>
        </div>
        <div class="flex items-center gap-1.5 text-muted justify-end text-right">
          <UIcon name="i-lucide-check" class="size-3 text-emerald-400" />
          <span>{{ fields.length }} fields · actionable end-to-end</span>
        </div>
      </div>
    </div>
  </div>
</template>
