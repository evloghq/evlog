<script setup lang="ts">
import type { TimedEvent } from '~/composables/useTimedSequence'

interface Suggestion {
  key: string
  type: string
  hint: string
}

const suggestions: Suggestion[] = [
  { key: 'user', type: '{ id: string; plan: string }', hint: 'CheckoutFields' },
  { key: 'cart', type: '{ items: number; total: number }', hint: 'CheckoutFields' },
  { key: 'action', type: 'string', hint: 'CheckoutFields' },
  { key: 'status', type: 'number', hint: 'InternalFields' },
  { key: 'service', type: 'string', hint: 'InternalFields' },
]

const TYPE_INTERFACE = 'interface CheckoutFields {'
const TYPED_LINE = 'const log = useLogger<CheckoutFields>(event)'
const VALID_LINE = 'log.set({ user: { id: \'123\', plan: \'pro\' } })'
const TYPO_LINE = 'log.set({ account: \'123\' })'

type Phase
  = | 'idle'
    | 'typing-valid'
    | 'completion-open'
    | 'valid-accepted'
    | 'typing-typo'
    | 'error-shown'
    | 'hold'

const phase = ref<Phase>('idle')
const validProgress = ref(0)
const completionHighlight = ref(0)
const typoProgress = ref(0)
const prefersReducedMotion = ref(false)
const wrapperRef = ref<HTMLElement>()

function resetState() {
  phase.value = 'idle'
  validProgress.value = 0
  completionHighlight.value = 0
  typoProgress.value = 0
}

const TYPE_AT = 200
const CHAR_INTERVAL = 38
const COMPLETION_OPEN_AT = TYPE_AT + Math.floor(VALID_LINE.indexOf('user') * CHAR_INTERVAL)
const COMPLETION_HOVER_AT = COMPLETION_OPEN_AT + 600
const COMPLETION_PICK_AT = COMPLETION_HOVER_AT + 700
const VALID_DONE_AT = TYPE_AT + VALID_LINE.length * CHAR_INTERVAL
const TYPO_START_AT = VALID_DONE_AT + 900
const TYPO_DONE_AT = TYPO_START_AT + TYPO_LINE.length * CHAR_INTERVAL
const ERROR_AT = TYPO_DONE_AT + 280
const HOLD_MS = 4200

function buildEvents(): TimedEvent[] {
  const events: TimedEvent[] = []

  events.push({
    at: TYPE_AT - 50,
    run: () => {
      phase.value = 'typing-valid'
    },
  })

  for (let i = 1; i <= VALID_LINE.length; i++) {
    events.push({
      at: TYPE_AT + i * CHAR_INTERVAL,
      run: () => {
        validProgress.value = i
      },
    })
  }

  events.push({
    at: COMPLETION_OPEN_AT,
    run: () => {
      phase.value = 'completion-open'
      completionHighlight.value = 0
    },
  })
  events.push({
    at: COMPLETION_HOVER_AT,
    run: () => {
      completionHighlight.value = 0
    },
  })
  events.push({
    at: COMPLETION_PICK_AT,
    run: () => {
      phase.value = 'typing-valid'
    },
  })
  events.push({
    at: VALID_DONE_AT,
    run: () => {
      phase.value = 'valid-accepted'
    },
  })

  events.push({
    at: TYPO_START_AT,
    run: () => {
      phase.value = 'typing-typo'
    },
  })

  for (let i = 1; i <= TYPO_LINE.length; i++) {
    events.push({
      at: TYPO_START_AT + i * CHAR_INTERVAL,
      run: () => {
        typoProgress.value = i
      },
    })
  }

  events.push({
    at: ERROR_AT,
    run: () => {
      phase.value = 'error-shown'
    },
  })

  events.push({
    at: ERROR_AT + HOLD_MS - 200,
    run: () => {
      phase.value = 'hold'
    },
  })

  return events
}

const events = buildEvents()
const totalDuration = ERROR_AT + HOLD_MS

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
    validProgress.value = VALID_LINE.length
    typoProgress.value = TYPO_LINE.length
    phase.value = 'error-shown'
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

const validTyped = computed(() => VALID_LINE.slice(0, validProgress.value))
const typoTyped = computed(() => TYPO_LINE.slice(0, typoProgress.value))

const showCaretValid = computed(() =>
  phase.value === 'typing-valid' || phase.value === 'completion-open',
)
const showCaretTypo = computed(() => phase.value === 'typing-typo')

const completionVisible = computed(() => phase.value === 'completion-open')

const errorVisible = computed(() =>
  phase.value === 'error-shown' || phase.value === 'hold',
)

const validLineDone = computed(() =>
  phase.value === 'valid-accepted'
    || phase.value === 'typing-typo'
    || phase.value === 'error-shown'
    || phase.value === 'hold',
)

const typoUnderlinePos = computed(() => {
  const start = TYPO_LINE.indexOf('account')
  if (start < 0) return null
  const end = start + 'account'.length
  if (typoProgress.value < end) return null
  return { start, length: end - start }
})

function statusLabel() {
  if (phase.value === 'error-shown' || phase.value === 'hold') return 'TS ERROR'
  if (phase.value === 'completion-open') return 'COMPLETIONS'
  if (validLineDone.value) return 'TYPED · OK'
  return 'EDITING'
}

function statusClass() {
  if (phase.value === 'error-shown' || phase.value === 'hold') return 'text-rose-400'
  if (validLineDone.value) return 'text-emerald-400'
  return 'text-primary'
}
</script>

<template>
  <div class="not-prose my-8" data-section="typed-fields-intellisense">
    <div ref="wrapperRef" class="overflow-hidden border border-muted bg-default">
      <div class="flex items-center gap-2 border-b border-muted px-4 py-2">
        <div class="flex gap-1.5">
          <div class="size-3 rounded-full bg-accented" />
          <div class="size-3 rounded-full bg-accented" />
          <div class="size-3 rounded-full bg-accented" />
        </div>
        <span class="ml-3 font-mono text-xs text-dimmed">checkout.post.ts</span>
        <span class="text-dimmed">·</span>
        <span
          class="font-mono text-[10px] tracking-widest uppercase transition-colors duration-300"
          :class="statusClass()"
        >
          {{ statusLabel() }}
        </span>
        <div class="ml-auto hidden sm:flex items-center gap-1.5 font-mono text-[9px] tracking-widest text-dimmed">
          <UIcon name="i-simple-icons-typescript" class="size-3 text-sky-400" />
          <span>tsc · strict</span>
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

      <div class="grid gap-0 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div class="px-4 sm:px-5 py-4 font-mono text-[11px] sm:text-xs leading-relaxed">
          <div class="flex items-baseline gap-3 text-dimmed/60">
            <span class="select-none w-4 text-right shrink-0">1</span>
            <span><span class="text-violet-400">import</span> { useLogger } <span class="text-violet-400">from</span> <span class="text-emerald-400">'evlog'</span></span>
          </div>
          <div class="flex items-baseline gap-3 text-dimmed/60">
            <span class="select-none w-4 text-right shrink-0">2</span>
            <span class="text-muted">{{ TYPE_INTERFACE }}</span>
          </div>
          <div class="flex items-baseline gap-3 text-dimmed/60 pl-6">
            <span class="text-sky-400">user</span><span class="text-dimmed">: { id: string; plan: string }</span>
          </div>
          <div class="flex items-baseline gap-3 text-dimmed/60 pl-6">
            <span class="text-sky-400">cart</span><span class="text-dimmed">: { items: number; total: number }</span>
          </div>
          <div class="flex items-baseline gap-3 text-dimmed/60 pl-6">
            <span class="text-sky-400">action</span><span class="text-dimmed">: string</span>
          </div>
          <div class="flex items-baseline gap-3 text-dimmed/60">
            <span class="select-none w-4 text-right shrink-0">6</span>
            <span class="text-muted">}</span>
          </div>
          <div class="flex items-baseline gap-3 text-dimmed/60 mt-2">
            <span class="select-none w-4 text-right shrink-0">8</span>
            <span class="text-dimmed">{{ TYPED_LINE }}</span>
          </div>

          <div class="relative flex items-baseline gap-3 mt-2">
            <span class="select-none w-4 text-right shrink-0 text-dimmed/60">10</span>
            <div class="relative">
              <span
                class="transition-colors duration-300"
                :class="validLineDone ? 'text-emerald-400/80' : 'text-default'"
              >
                {{ validTyped }}
              </span>
              <span
                v-if="showCaretValid"
                aria-hidden="true"
                class="inline-block w-[1px] h-[1.1em] -mb-[0.15em] bg-primary animate-pulse ml-px"
              />
              <span
                v-if="validLineDone"
                aria-hidden="true"
                class="absolute -right-5 top-0 text-emerald-400"
              >
                <UIcon name="i-lucide-check" class="size-3" />
              </span>

              <div
                v-show="completionVisible"
                class="absolute left-[5.6em] top-[1.4em] z-10 w-[290px] sm:w-[320px] border border-primary/40 bg-elevated shadow-[0_8px_24px_-8px_rgba(0,0,0,0.45)]"
              >
                <div class="flex items-center gap-1.5 border-b border-default/30 px-2.5 py-1.5">
                  <UIcon name="i-lucide-list" class="size-3 text-primary" />
                  <span class="font-mono text-[9px] tracking-widest uppercase text-dimmed">suggestions</span>
                  <span class="ml-auto font-mono text-[9px] text-dimmed">{{ suggestions.length }}</span>
                </div>
                <ul class="py-1 text-[10px] sm:text-[11px]">
                  <li
                    v-for="(s, i) in suggestions"
                    :key="s.key"
                    class="flex items-baseline gap-2 px-2.5 py-1 transition-colors"
                    :class="i === completionHighlight ? 'bg-primary/15' : ''"
                  >
                    <UIcon
                      :name="s.hint === 'InternalFields' ? 'i-lucide-shield' : 'i-lucide-square-pen'"
                      class="size-3 shrink-0"
                      :class="s.hint === 'InternalFields' ? 'text-dimmed' : 'text-sky-400'"
                    />
                    <span
                      class="font-mono"
                      :class="i === completionHighlight ? 'text-default' : 'text-muted'"
                    >
                      {{ s.key }}
                    </span>
                    <span class="font-mono text-dimmed truncate">{{ s.type }}</span>
                    <span class="ml-auto font-mono text-[9px] text-dimmed/70 shrink-0">{{ s.hint }}</span>
                  </li>
                </ul>
                <div class="border-t border-default/30 px-2.5 py-1 font-mono text-[9px] text-dimmed">
                  <UIcon name="i-lucide-arrow-up-down" class="size-3 inline mr-1 -mt-0.5" />
                  pick · <UIcon name="i-lucide-corner-down-left" class="size-3 inline mx-1 -mt-0.5" /> accept · <span class="text-dimmed/70">esc</span> dismiss
                </div>
              </div>
            </div>
          </div>

          <div class="relative flex items-baseline gap-3 mt-2">
            <span class="select-none w-4 text-right shrink-0 text-dimmed/60">11</span>
            <div class="relative">
              <template v-for="(ch, i) in typoTyped.split('')" :key="i">
                <span
                  :class="typoUnderlinePos && i >= typoUnderlinePos.start && i < typoUnderlinePos.start + typoUnderlinePos.length
                    ? 'text-rose-300 underline decoration-rose-400 decoration-wavy underline-offset-[3px]'
                    : 'text-default'"
                >
                  {{ ch }}
                </span>
              </template>
              <span
                v-if="showCaretTypo"
                aria-hidden="true"
                class="inline-block w-[1px] h-[1.1em] -mb-[0.15em] bg-primary animate-pulse ml-px"
              />
              <span
                v-if="errorVisible"
                aria-hidden="true"
                class="absolute -right-5 top-0 text-rose-400"
              >
                <UIcon name="i-lucide-x" class="size-3" />
              </span>
            </div>
          </div>
        </div>

        <div class="border-t border-default/30 lg:border-t-0 lg:border-l">
          <div class="flex items-center gap-2 border-b border-default/30 px-4 py-2.5">
            <UIcon
              :name="errorVisible ? 'i-lucide-circle-alert' : 'i-lucide-info'"
              class="size-3"
              :class="errorVisible ? 'text-rose-400' : 'text-primary'"
            />
            <span class="font-mono text-[10px] tracking-widest text-dimmed uppercase">
              {{ errorVisible ? 'problems · 1' : 'problems · 0' }}
            </span>
            <span class="ml-auto font-mono text-[9px] tracking-widest text-dimmed">tsserver</span>
          </div>

          <div class="p-4 sm:p-5 space-y-3 min-h-[260px]">
            <div
              v-if="!errorVisible"
              class="flex items-start gap-2 font-mono text-[10px] sm:text-[11px] text-dimmed"
            >
              <UIcon name="i-lucide-check" class="size-3 text-emerald-400 mt-0.5 shrink-0" />
              <span>No type errors. Excess properties on the literal would be flagged here.</span>
            </div>

            <div
              v-else
              class="border border-rose-400/30 bg-rose-500/5 p-3 space-y-2"
            >
              <div class="flex items-center gap-2 font-mono text-[10px] tracking-widest uppercase text-rose-400">
                <UIcon name="i-lucide-circle-alert" class="size-3" />
                <span>ts2353</span>
                <span class="ml-auto text-dimmed font-normal normal-case tracking-normal">checkout.post.ts:11</span>
              </div>
              <p class="font-mono text-[10px] sm:text-[11px] text-default leading-relaxed">
                Object literal may only specify known properties, and
                <span class="text-rose-300">'account'</span>
                does not exist in type
                <span class="text-sky-400">'CheckoutFields &amp; Partial&lt;InternalFields&gt;'</span>.
              </p>
              <div class="font-mono text-[10px] text-dimmed leading-relaxed">
                <UIcon name="i-lucide-lightbulb" class="size-3 inline -mt-0.5 mr-1 text-amber-400" />
                Did you mean <span class="text-sky-400">user</span>, <span class="text-sky-400">cart</span>, or <span class="text-sky-400">action</span>?
              </div>
            </div>

            <div class="border-t border-default/30 pt-3 font-mono text-[10px] text-dimmed space-y-1">
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-shield" class="size-3 text-primary/70" />
                <span>useLogger&lt;CheckoutFields&gt;(event)</span>
              </div>
              <div class="text-dimmed/70 pl-5">
                Excess property checking happens at the literal — autocomplete only suggests known keys.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
