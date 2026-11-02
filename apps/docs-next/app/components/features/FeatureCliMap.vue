<script setup lang="ts">
import { Motion } from 'motion-v'

const props = defineProps<{
  link?: string
  linkLabel?: string
}>()

const pills = [
  { label: 'Deterministic scan', icon: 'i-lucide-scan-line', tone: 'primary' },
  { label: 'Every entry point', icon: 'i-lucide-list-tree', tone: 'primary' },
  { label: 'CI gate', icon: 'i-lucide-git-pull-request', tone: 'primary' },
  { label: 'Early days', icon: 'i-lucide-flask-conical', tone: 'amber' },
]

/** The real per-entry skyline from a 29-route Nuxt app, worst first. */
const skyline = [25, 25, 25, 38, 38, 38, 38, 38, 50, 75, 75, 75, 75, 75, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]

const coverage = [
  { label: 'API handlers', score: 79, note: '13 of 28 have gaps' },
  { label: 'Middleware & jobs', score: 45, note: 'run without any logging' },
  { label: 'Money & auth', score: 71, note: 'missing audit trails' },
]

const gaps = [
  { method: 'ANY', path: '/api/auth/:all*', badge: 'A', why: 'touches auth and logs nothing', file: 'server/api/auth/[...all].ts:1' },
  { method: 'POST', path: '/api/checkout', badge: '$', why: 'moves money with no audit trail', file: 'server/api/checkout.post.ts:14' },
  { method: 'POST', path: '/api/orders/:id/refund', badge: '$', why: 'throws plain errors with no why or fix', file: 'server/api/orders/[id]/refund.post.ts:22' },
]

const loop = [
  { icon: 'i-lucide-scan-line', title: 'evlog map --json', text: '29 entry points scanned · 8 emit nothing at all' },
  { icon: 'i-lucide-crosshair', title: 'Three targets, with line numbers', text: 'Every verdict carries the file, the line, and the rule it broke' },
  { icon: 'i-lucide-wand-sparkles', title: 'Fix, in the shape the report suggests', text: 'useLogger + log.set on two handlers, log.audit on the third' },
  { icon: 'i-lucide-repeat', title: 'Run it again', text: 'Same code in, same verdict out — the score moved because the app did' },
]

const FINAL_SCORE = 76
const RAISED_SCORE = 86
const GATE = 80

const prefersReducedMotion = ref(false)
const panelRef = ref<HTMLElement>()
const started = ref(false)
const score = ref(0)
const visibleGaps = ref(0)
const visibleSteps = ref(0)
const raised = ref(false)

const grade = computed(() => (score.value >= 90 ? 'excellent' : score.value >= 70 ? 'good' : score.value >= 50 ? 'needs work' : 'at risk'))

function barTone(value: number): string {
  if (value < 50) return 'bg-red-500/70'
  if (value < 75) return 'bg-amber-500/70'
  return 'bg-primary'
}

let frame: number | undefined
let observer: IntersectionObserver | undefined

function snapToEnd() {
  score.value = FINAL_SCORE
  visibleGaps.value = gaps.length
  visibleSteps.value = loop.length
  raised.value = true
}

const COUNT_UP_MS = 900

/** On the frame clock: a 24ms interval lands between frames and stutters. */
function countUp() {
  const startedAt = performance.now()
  const step = (now: number) => {
    const progress = Math.min((now - startedAt) / COUNT_UP_MS, 1)
    score.value = Math.round(FINAL_SCORE * progress)
    if (progress < 1) frame = requestAnimationFrame(step)
  }
  frame = requestAnimationFrame(step)
}

/*
 * On the frame clock, like every other demo here.
 *
 * This ran on `setTimeout` and the counter beside it ran on `requestAnimationFrame`,
 * which is two clocks for one animation. On the site they agree closely enough;
 * anywhere that drives frames by hand — Render labs stepping a take, or a tab
 * throttled in the background — they do not, and the score finished counting
 * while the rows it belongs to were still waiting on a wall-clock timer.
 */
const RAISED_AT = 2600 + loop.length * 620

const sequence = useTimedSequence({
  events: [
    { at: 400, run: countUp },
    ...gaps.map((_, i) => ({ at: 1600 + i * 260, run: () => {
      visibleGaps.value = i + 1 
    } })),
    ...loop.map((_, i) => ({ at: 2600 + i * 620, run: () => {
      visibleSteps.value = i + 1 
    } })),
    { at: RAISED_AT, run: () => {
      raised.value = true 
    } },
  ],
  // A beat past the last event, so a clip cut to this length lands on the
  // finished state instead of on the frame that completes it.
  totalDuration: RAISED_AT + 900,
})

function start() {
  if (started.value) return
  started.value = true
  sequence.start()
}

onMounted(() => {
  prefersReducedMotion.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (prefersReducedMotion.value) {
    started.value = true
    snapToEnd()
    return
  }

  const el = panelRef.value
  if (!el) return
  observer = new IntersectionObserver((entries) => {
    if (entries[0]?.isIntersecting) {
      start()
      observer?.disconnect()
    }
  }, { threshold: 0.3 })
  observer.observe(el)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  if (frame !== undefined) cancelAnimationFrame(frame)
})
</script>

<template>
  <section class="py-24 md:py-32" data-section="features-feature-cli-map">
    <Motion
      :initial="false"
      :while-in-view="{ opacity: 1, y: 0 }"
      :transition="{ duration: 0.5 }"
      :in-view-options="{ once: true }"
      class="mb-10"
    >
      <div>
        <p v-if="$slots.headline" class="section-label">
          <slot name="headline" mdc-unwrap="p" />
        </p>
        <div class="relative mb-5">
          <h2 class="section-title max-w-2xl">
            <slot name="title" mdc-unwrap="p" /><span class="text-primary">.</span>
          </h2>
          <div aria-hidden="true" class="title-glow section-title max-w-2xl">
            <slot name="title" mdc-unwrap="p" /><span class="text-primary">.</span>
          </div>
        </div>
        <p v-if="$slots.description" class="max-w-lg text-sm leading-relaxed text-muted">
          <slot name="description" mdc-unwrap="p" />
        </p>
        <div class="mt-5 flex flex-wrap gap-2">
          <span
            v-for="pill in pills"
            :key="pill.label"
            class="inline-flex items-center gap-1.5 border border-muted bg-elevated/50 px-3 py-1 font-mono text-[11px] text-muted"
          >
            <UIcon :name="pill.icon" class="size-3" :class="pill.tone === 'amber' ? 'text-amber-500' : 'text-primary'" />
            {{ pill.label }}
          </span>
        </div>
        <NuxtLink v-if="props.link" :to="props.link" class="mt-4 inline-flex items-center gap-1.5 font-mono text-xs text-dimmed hover:text-primary transition-colors">
          {{ props.linkLabel || 'Learn more' }}
          <UIcon name="i-lucide-arrow-right" class="size-3" />
        </NuxtLink>
      </div>
    </Motion>

    <div class="grid gap-6 lg:grid-cols-2 *:min-w-0">
      <Motion
        :initial="false"
        :while-in-view="{ opacity: 1, y: 0 }"
        :transition="{ duration: 0.5, delay: 0.1 }"
        :in-view-options="{ once: true }"
      >
        <div ref="panelRef" class="h-full overflow-hidden border border-muted bg-default flex flex-col">
          <div class="flex items-center gap-2 border-b border-muted px-4 py-3">
            <div class="flex gap-1.5">
              <div class="size-3 rounded-full bg-accented" />
              <div class="size-3 rounded-full bg-accented" />
              <div class="size-3 rounded-full bg-accented" />
            </div>
            <span class="ml-3 font-mono text-xs text-dimmed">evlog map</span>
            <span class="ml-auto font-mono text-[11px] tabular-nums text-dimmed">29 entry points</span>
          </div>

          <div class="p-5 sm:p-6 flex-1 space-y-5">
            <div class="flex items-end gap-3">
              <div class="w-32 shrink-0">
                <p class="font-mono text-[10px] uppercase tracking-wide text-dimmed">
                  score
                </p>
                <p class="font-mono text-4xl font-medium tabular-nums text-highlighted leading-none">
                  {{ score }}<span class="text-lg text-dimmed">/100</span>
                </p>
                <p class="mt-1 font-mono text-[11px] text-primary">
                  {{ grade }}
                </p>
              </div>
              <div class="flex-1 flex h-14 items-end gap-px" aria-hidden="true">
                <div
                  v-for="(value, i) in skyline"
                  :key="i"
                  class="flex-1 h-full origin-bottom transition-transform ease-out"
                  :class="barTone(value)"
                  :style="{
                    transform: `scaleY(${started ? value / 100 : 0.04})`,
                    transitionDuration: prefersReducedMotion ? '0ms' : '500ms',
                    transitionDelay: prefersReducedMotion ? '0ms' : `${i * 22}ms`,
                  }"
                />
              </div>
            </div>

            <div class="space-y-2">
              <div
                v-for="(area, i) in coverage"
                :key="area.label"
                class="flex items-center gap-3 font-mono text-[11px]"
              >
                <span class="w-32 shrink-0 truncate text-muted">{{ area.label }}</span>
                <div class="relative h-1.5 flex-1 bg-elevated">
                  <div
                    class="absolute inset-0 origin-left transition-transform ease-out"
                    :class="barTone(area.score)"
                    :style="{
                      transform: `scaleX(${started ? area.score / 100 : 0})`,
                      transitionDuration: prefersReducedMotion ? '0ms' : '700ms',
                      transitionDelay: prefersReducedMotion ? '0ms' : `${900 + i * 140}ms`,
                    }"
                  />
                </div>
                <span class="w-6 shrink-0 tabular-nums text-right text-highlighted">{{ area.score }}</span>
                <span class="hidden sm:block w-40 shrink-0 truncate text-dimmed">{{ area.note }}</span>
              </div>
            </div>

            <div>
              <p class="font-mono text-[10px] uppercase tracking-wide text-dimmed">
                fix first
              </p>
              <div class="mt-2 space-y-2">
                <div
                  v-for="(gap, i) in gaps"
                  :key="gap.path"
                  class="border-l-2 border-l-red-500/40 pl-3 transition-all duration-300 ease-out"
                  :class="i < visibleGaps ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2'"
                >
                  <p class="font-mono text-[11px]">
                    <span class="text-violet-400">{{ gap.method }}</span>
                    <span class="ml-2 text-amber-400">{{ gap.path }}</span>
                    <span class="ml-1.5 text-primary">{{ gap.badge }}</span>
                    <span class="text-dimmed"> — {{ gap.why }}</span>
                  </p>
                  <p class="font-mono text-[10px] text-dimmed truncate">
                    {{ gap.file }}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div class="border-t border-muted/50 px-5 sm:px-6 py-3">
            <p class="font-mono text-[10px] text-dimmed">
              nothing runs · nothing is instrumented · no traffic needed
            </p>
          </div>
        </div>
      </Motion>

      <Motion
        :initial="false"
        :while-in-view="{ opacity: 1, y: 0 }"
        :transition="{ duration: 0.5, delay: 0.2 }"
        :in-view-options="{ once: true }"
      >
        <div class="h-full overflow-hidden border border-muted bg-default flex flex-col">
          <div class="flex items-center gap-2 border-b border-muted px-4 py-3">
            <div class="flex gap-1.5">
              <div class="size-3 rounded-full bg-accented" />
              <div class="size-3 rounded-full bg-accented" />
              <div class="size-3 rounded-full bg-accented" />
            </div>
            <span class="ml-3 flex items-center gap-1.5 font-mono text-xs text-dimmed">
              <UIcon name="i-lucide-bot" class="size-3 text-primary" />
              agent loop
            </span>
            <span
              class="ml-auto flex items-center gap-1.5 font-mono text-[11px] transition-colors duration-300"
              :class="raised ? 'text-emerald-500' : 'text-primary'"
            >
              <span class="relative flex size-1.5">
                <span v-if="!raised" class="absolute inline-flex size-full animate-ping bg-primary/40" />
                <span class="relative inline-flex size-1.5 transition-colors duration-300" :class="raised ? 'bg-emerald-500' : 'bg-primary'" />
              </span>
              {{ raised ? 'gate passing' : 'working' }}
            </span>
          </div>

          <div class="p-5 sm:p-6 flex-1 space-y-4">
            <div
              v-for="(step, i) in loop"
              :key="step.title"
              class="flex items-start gap-3 transition-all duration-300 ease-out"
              :class="i < visibleSteps ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'"
            >
              <div class="mt-0.5 flex size-6 shrink-0 items-center justify-center border border-primary/20 bg-primary/5">
                <UIcon :name="step.icon" class="size-3.5 text-primary" />
              </div>
              <div class="min-w-0">
                <p class="font-mono text-xs text-highlighted">
                  {{ step.title }}
                </p>
                <p class="mt-0.5 text-[11px] leading-relaxed text-dimmed">
                  {{ step.text }}
                </p>
              </div>
            </div>
          </div>

          <div class="border-t border-muted/50 px-5 sm:px-6 py-4">
            <div class="flex items-center justify-between gap-4">
              <div class="min-w-0">
                <p class="font-mono text-xs text-highlighted">
                  evlog map --min-score {{ GATE }}
                </p>
                <p class="mt-0.5 font-mono text-[10px] text-dimmed">
                  the score is the review comment nobody has to write
                </p>
              </div>
              <div class="flex shrink-0 items-baseline gap-2 font-mono tabular-nums">
                <span class="text-sm text-dimmed line-through">{{ FINAL_SCORE }}</span>
                <UIcon name="i-lucide-arrow-right" class="size-3 text-dimmed" />
                <span
                  class="text-xl font-medium transition-colors duration-500"
                  :class="raised ? 'text-emerald-500' : 'text-dimmed'"
                >
                  {{ RAISED_SCORE }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </Motion>
    </div>
  </section>
</template>
