<script setup lang="ts">
import type { TimedEvent } from '~/composables/useTimedSequence'

interface Branch {
  code: string
  label: string
  toast: string
  icon: string
  color: string
}

const branches: Branch[] = [
  { code: '\'PAYMENT_DECLINED\'', label: 'showRetryWithDifferentCard()', toast: 'Try a different payment method', icon: 'i-lucide-credit-card', color: 'text-rose-400' },
  { code: '\'CART_EXPIRED\'', label: 'rebuildCart()', toast: 'Your cart expired — rebuilding…', icon: 'i-lucide-shopping-cart', color: 'text-amber-400' },
  { code: 'default', label: 'toast.add({ ...error })', toast: '—', icon: 'i-lucide-bell-ring', color: 'text-dimmed' },
]

const ACTIVE_BRANCH = 0

type Phase
  = | 'idle'
    | 'server-typing'
    | 'server-thrown'
    | 'in-flight'
    | 'parsing'
    | 'switching'
    | 'matched'
    | 'toast-shown'
    | 'hold'

const phase = ref<Phase>('idle')
const envelopeProgress = ref(0)
const parsedFields = ref({ code: false, message: false, status: false, why: false, fix: false })
const branchHighlight = ref(-1)
const prefersReducedMotion = ref(false)
const wrapperRef = ref<HTMLElement>()

function resetState() {
  phase.value = 'idle'
  envelopeProgress.value = 0
  parsedFields.value = { code: false, message: false, status: false, why: false, fix: false }
  branchHighlight.value = -1
}

const SERVER_AT = 200
const SERVER_TYPING_HOLD = 800
const THROW_AT = SERVER_AT + SERVER_TYPING_HOLD
const ENVELOPE_AT = THROW_AT + 250
const ENVELOPE_DURATION = 1200
const PARSE_AT = ENVELOPE_AT + ENVELOPE_DURATION + 200
const PARSE_FIELD_INTERVAL = 220
const PARSE_FIELDS = ['code', 'message', 'status', 'why', 'fix'] as const
const SWITCH_AT = PARSE_AT + PARSE_FIELDS.length * PARSE_FIELD_INTERVAL + 250
const BRANCH_INTERVAL = 320
const MATCH_AT = SWITCH_AT + branches.length * BRANCH_INTERVAL
const TOAST_AT = MATCH_AT + 350
const HOLD_MS = 4000

function buildEvents(): TimedEvent[] {
  const events: TimedEvent[] = []

  events.push({ at: SERVER_AT - 50, run: () => {
    phase.value = 'server-typing' 
  } })
  events.push({ at: THROW_AT, run: () => {
    phase.value = 'server-thrown' 
  } })

  events.push({ at: ENVELOPE_AT, run: () => {
    phase.value = 'in-flight'
    envelopeProgress.value = 0
  } })
  const STEPS = 30
  for (let i = 1; i <= STEPS; i++) {
    events.push({
      at: ENVELOPE_AT + (i / STEPS) * ENVELOPE_DURATION,
      run: () => {
        envelopeProgress.value = i / STEPS 
      },
    })
  }

  events.push({ at: PARSE_AT, run: () => {
    phase.value = 'parsing' 
  } })
  PARSE_FIELDS.forEach((field, i) => {
    events.push({
      at: PARSE_AT + (i + 1) * PARSE_FIELD_INTERVAL,
      run: () => {
        parsedFields.value = { ...parsedFields.value, [field]: true } 
      },
    })
  })

  events.push({ at: SWITCH_AT, run: () => {
    phase.value = 'switching' 
  } })
  branches.forEach((_, i) => {
    events.push({
      at: SWITCH_AT + i * BRANCH_INTERVAL,
      run: () => {
        branchHighlight.value = i 
      },
    })
  })

  events.push({
    at: MATCH_AT,
    run: () => {
      phase.value = 'matched'
      branchHighlight.value = ACTIVE_BRANCH
    },
  })

  events.push({ at: TOAST_AT, run: () => {
    phase.value = 'toast-shown' 
  } })
  events.push({ at: TOAST_AT + HOLD_MS - 200, run: () => {
    phase.value = 'hold' 
  } })

  return events
}

const events = buildEvents()
const totalDuration = TOAST_AT + HOLD_MS

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
    envelopeProgress.value = 1
    parsedFields.value = { code: true, message: true, status: true, why: true, fix: true }
    branchHighlight.value = ACTIVE_BRANCH
    phase.value = 'toast-shown'
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

const toastVisible = computed(() => phase.value === 'toast-shown' || phase.value === 'hold')
const envelopeVisible = computed(() =>
  phase.value !== 'idle' && phase.value !== 'server-typing' && phase.value !== 'server-thrown',
)
const envelopeInFlight = computed(() => phase.value === 'in-flight')

function statusLabel() {
  if (toastVisible.value) return 'TOASTED'
  if (phase.value === 'matched' || phase.value === 'switching') return 'BRANCHING'
  if (phase.value === 'parsing') return 'PARSING'
  if (phase.value === 'in-flight') return 'IN FLIGHT'
  if (phase.value === 'server-thrown') return 'THROWN'
  return 'SERVER'
}

function statusClass() {
  if (toastVisible.value) return 'text-emerald-400'
  if (phase.value === 'matched' || phase.value === 'switching') return 'text-primary'
  if (phase.value === 'parsing') return 'text-amber-400'
  return 'text-dimmed'
}
</script>

<template>
  <div class="not-prose my-8" data-section="structured-error-branching">
    <div ref="wrapperRef" class="overflow-hidden border border-muted bg-default">
      <div class="flex items-center gap-2 border-b border-muted px-4 py-2">
        <div class="flex gap-1.5">
          <div class="size-3 rounded-full bg-accented" />
          <div class="size-3 rounded-full bg-accented" />
          <div class="size-3 rounded-full bg-accented" />
        </div>
        <span class="ml-3 font-mono text-xs text-dimmed">structured error · server → client</span>
        <span class="text-dimmed">·</span>
        <span
          class="font-mono text-[10px] tracking-widest uppercase transition-colors duration-300"
          :class="statusClass()"
        >
          {{ statusLabel() }}
        </span>
        <div class="ml-auto hidden md:flex items-center gap-1.5 font-mono text-[9px] tracking-widest text-dimmed">
          <UIcon name="i-lucide-shield-alert" class="size-3 text-rose-400" />
          <span>code: PAYMENT_DECLINED</span>
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

      <div class="grid gap-px bg-muted/40 lg:grid-cols-3">
        <div class="bg-default px-4 py-4 sm:px-5 sm:py-5 min-w-0">
          <div class="flex items-center gap-2 mb-3">
            <UIcon name="i-lucide-server" class="size-3 text-primary" />
            <span class="font-mono text-[10px] tracking-widest uppercase text-dimmed">server</span>
            <span class="ml-auto font-mono text-[9px] text-dimmed truncate max-w-[55%]">checkout.post.ts</span>
          </div>
          <pre class="font-mono text-[10px] sm:text-[11px] leading-relaxed text-muted overflow-x-auto"><code><span class="text-violet-400">throw</span> <span class="text-amber-400">createError</span>({
  <span class="text-sky-400">code</span>:    <span class="text-emerald-400">'PAYMENT_DECLINED'</span>,
  <span class="text-sky-400">message</span>: <span class="text-emerald-400">'Payment failed'</span>,
  <span class="text-sky-400">status</span>:  <span class="text-pink-400">402</span>,
  <span class="text-sky-400">why</span>:     <span class="text-emerald-400">'Card declined by issuer'</span>,
  <span class="text-sky-400">fix</span>:     <span class="text-emerald-400">'Try a different…'</span>,
})</code></pre>
          <div class="mt-3 pt-3 border-t border-default/30 font-mono text-[9px] tracking-widest text-dimmed">
            <UIcon
              :name="phase === 'idle' || phase === 'server-typing' ? 'i-lucide-circle-dashed' : 'i-lucide-flame'"
              class="size-3 inline -mt-0.5 mr-1"
              :class="phase === 'idle' || phase === 'server-typing' ? 'text-dimmed/60' : 'text-rose-400'"
            />
            <span :class="phase === 'idle' || phase === 'server-typing' ? 'text-dimmed/60' : 'text-rose-400'">
              {{ phase === 'idle' || phase === 'server-typing' ? 'awaiting throw' : 'thrown · http 402' }}
            </span>
          </div>
        </div>

        <div class="bg-default relative px-4 py-4 sm:px-5 sm:py-5 min-h-[210px] flex flex-col overflow-hidden min-w-0">
          <div class="flex items-center gap-2 mb-3">
            <UIcon name="i-lucide-globe" class="size-3 text-primary" />
            <span class="font-mono text-[10px] tracking-widest uppercase text-dimmed">network</span>
            <span class="ml-auto font-mono text-[9px] text-dimmed truncate max-w-[55%]">POST /api/checkout</span>
          </div>

          <div class="flex-1 flex flex-col justify-center gap-4 min-w-0">
            <div
              class="border bg-elevated/50 px-3 py-2 transition-all duration-500 min-w-0"
              :class="[
                envelopeVisible ? 'opacity-100' : 'opacity-30',
                envelopeInFlight ? 'border-rose-400/40 shadow-[0_0_0_1px_rgba(251,113,133,0.15)]' : 'border-muted',
              ]"
            >
              <div class="flex items-center gap-1.5 mb-1.5">
                <UIcon name="i-lucide-package" class="size-3 text-rose-400" />
                <span class="font-mono text-[9px] tracking-widest uppercase text-dimmed">json envelope</span>
              </div>
              <pre class="font-mono text-[10px] leading-relaxed text-muted overflow-hidden"><code>{
  <span class="text-sky-400">status</span>: <span class="text-pink-400">402</span>,
  <span class="text-sky-400">message</span>: <span class="text-emerald-400">'Payment failed'</span>,
  <span class="text-sky-400">data</span>: { <span class="text-sky-400">code</span>: <span class="text-emerald-400">'PAYMENT_DECLINED'</span> }
}</code></pre>
            </div>

            <div class="flex items-center gap-2 font-mono text-[9px] tracking-widest uppercase text-dimmed">
              <UIcon name="i-lucide-server" class="size-3 shrink-0" :class="envelopeInFlight ? 'text-primary' : ''" />
              <span class="shrink-0">server</span>
              <div class="flex-1 relative h-px bg-muted/60 mx-1">
                <div
                  class="absolute inset-y-0 left-0 bg-rose-400/50 transition-[width] duration-200 ease-linear"
                  :style="{ width: `${Math.round(envelopeProgress * 100)}%` }"
                />
                <div
                  class="absolute top-1/2 -translate-y-1/2 size-2 rounded-full bg-rose-400 transition-[left,opacity] duration-200 ease-linear"
                  :class="envelopeProgress > 0 && envelopeProgress < 1 ? 'opacity-100 shadow-[0_0_8px_rgba(251,113,133,0.7)]' : 'opacity-0'"
                  :style="{ left: `calc(${Math.round(envelopeProgress * 100)}% - 4px)` }"
                />
              </div>
              <span class="shrink-0">client</span>
              <UIcon
                name="i-lucide-monitor"
                class="size-3 shrink-0"
                :class="envelopeProgress >= 1 ? 'text-emerald-400' : ''"
              />
            </div>
          </div>
        </div>

        <div class="bg-default px-4 py-4 sm:px-5 sm:py-5 min-w-0">
          <div class="flex items-center gap-2 mb-3">
            <UIcon name="i-lucide-monitor" class="size-3 text-primary" />
            <span class="font-mono text-[10px] tracking-widest uppercase text-dimmed">client</span>
            <span class="ml-auto font-mono text-[9px] text-dimmed truncate max-w-[55%]">useCheckout.ts</span>
          </div>

          <div class="space-y-2">
            <div class="border border-muted bg-elevated/30 px-3 py-2 min-w-0">
              <div class="font-mono text-[9px] tracking-widest uppercase text-dimmed mb-1.5">
                parseError(err)
              </div>
              <pre class="font-mono text-[10px] leading-relaxed text-muted overflow-hidden"><code>{
  <span class="text-sky-400">code</span>:    <span
    class="transition-opacity duration-300"
    :class="parsedFields.code ? 'opacity-100 text-emerald-400' : 'opacity-30'"
  >'PAYMENT_DECLINED'</span>,
  <span class="text-sky-400">message</span>: <span
    class="transition-opacity duration-300"
    :class="parsedFields.message ? 'opacity-100 text-emerald-400' : 'opacity-30'"
  >'Payment failed'</span>,
  <span class="text-sky-400">status</span>:  <span
    class="transition-opacity duration-300"
    :class="parsedFields.status ? 'opacity-100 text-pink-400' : 'opacity-30'"
  >402</span>,
  <span class="text-sky-400">why</span>:     <span
    class="transition-opacity duration-300"
    :class="parsedFields.why ? 'opacity-100 text-emerald-400' : 'opacity-30'"
  >'Card declined…'</span>,
  <span class="text-sky-400">fix</span>:     <span
    class="transition-opacity duration-300"
    :class="parsedFields.fix ? 'opacity-100 text-emerald-400' : 'opacity-30'"
  >'Try another…'</span>,
}</code></pre>
            </div>

            <div class="border border-muted bg-elevated/30 px-3 py-2 space-y-1">
              <div class="font-mono text-[9px] tracking-widest uppercase text-dimmed mb-1">
                switch (error.code)
              </div>
              <div
                v-for="(b, i) in branches"
                :key="b.code"
                class="px-1.5 py-1 transition-all duration-300 font-mono text-[10px] min-w-0"
                :class="branchHighlight === i
                  ? (i === ACTIVE_BRANCH && (phase === 'matched' || phase === 'toast-shown' || phase === 'hold')
                    ? 'bg-primary/15 text-default'
                    : 'bg-muted/40 text-default')
                  : 'opacity-50'"
              >
                <div class="flex items-center gap-1.5 min-w-0">
                  <UIcon
                    :name="b.icon"
                    class="size-3 shrink-0"
                    :class="b.color"
                  />
                  <template v-if="b.code === 'default'">
                    <span class="text-violet-400 shrink-0">default:</span>
                  </template>
                  <template v-else>
                    <span class="text-violet-400 shrink-0">case</span>
                    <span class="text-emerald-400 truncate">{{ b.code }}</span>
                    <span class="text-violet-400 shrink-0">:</span>
                  </template>
                </div>
                <div class="pl-5 mt-0.5 flex items-center gap-1 min-w-0">
                  <span class="text-dimmed shrink-0">→</span>
                  <span class="truncate text-muted">{{ b.label }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="border-t border-muted/50 px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[10px]">
        <div
          class="flex items-center gap-2 transition-all duration-500"
          :class="toastVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1'"
        >
          <UIcon name="i-lucide-bell-ring" class="size-3 text-emerald-400" />
          <span class="text-dimmed">toast →</span>
          <span class="border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-300">
            {{ branches[ACTIVE_BRANCH]?.toast }}
          </span>
        </div>
        <div class="ml-auto flex items-center gap-3 text-dimmed">
          <span class="inline-flex items-center gap-1.5">
            <UIcon name="i-lucide-shield-check" class="size-3 text-emerald-400" />
            <span>stable code, no message parsing</span>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
