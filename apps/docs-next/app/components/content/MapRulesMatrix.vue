<script setup lang="ts">
type Status = 'pass' | 'fail' | 'na' | 'disabled'

interface Rule {
  /** Column in `evlog map --all`. */
  id: string
  /** Requirements only: what a failure costs. */
  weight?: number
  /** Status per step: the scan, the fix, the disable comment. */
  states: [Status, Status, Status]
}

const requirements: Rule[] = [
  { id: 'log', weight: 40, states: ['fail', 'pass', 'pass'] },
  { id: 'ctx', weight: 15, states: ['fail', 'pass', 'pass'] },
  { id: 'err', weight: 20, states: ['na', 'na', 'na'] },
  { id: 'audit', weight: 25, states: ['fail', 'fail', 'disabled'] },
  { id: 'catch', weight: 15, states: ['na', 'na', 'na'] },
  { id: 'fetch', weight: 20, states: ['na', 'na', 'na'] },
]

const opportunities: Rule[] = [
  { id: 'error-catalog', states: ['na', 'na', 'na'] },
  { id: 'audit-coverage', states: ['fail', 'fail', 'fail'] },
  { id: 'ai-logging', states: ['na', 'na', 'na'] },
  { id: 'auth-identity', states: ['na', 'na', 'na'] },
]

const steps = [
  { label: 'Three requirements fail', code: '100 − 40 − 15 − 25 = 20' },
  { label: 'useLogger and log.set added', code: '100 − 25 = 75' },
  { label: 'audit disabled by a comment', code: '// evlog-map-disable-next-line audit' },
]

const step = ref(-1)

const { root, finished, still, playing, duration, replay } = useFigure({
  steps: steps.map((_, i) => ({ at: 400 + i * 1500, run: () => {
    step.value = i
  } })),
  reset: () => {
    step.value = -1
  },
  settle: () => {
    step.value = steps.length - 1
  },
})

function status(rule: Rule): Status | undefined {
  return step.value < 0 ? undefined : rule.states[step.value]
}

const score = computed(() => step.value < 0 ? 100 : 100 - requirements.reduce((lost, rule) => status(rule) === 'fail' ? lost + rule.weight! : lost, 0))

const glyphs: Record<Status, { text: string, tone: string }> = {
  pass: { text: '✓', tone: 'text-(--d-out-ok)' },
  fail: { text: '✗', tone: 'text-(--d-out-error)' },
  na: { text: '·', tone: 'text-dimmed' },
  disabled: { text: '○', tone: 'text-muted' },
}
</script>

<template>
  <DocsFigure
    ref="root"
    caption="One handler through the ten rules. A failing requirement costs its weight, an opportunity never does, and a disabled check turns into n/a."
    :finished
    :still
    :playing
    :duration
    @replay="replay"
  >
    <div class="px-5 pt-5 sm:px-6">
      <p class="flex items-baseline justify-between gap-4 text-[13px] text-dimmed">
        <span>Requirements</span>
        <span>Cost their weight</span>
      </p>
      <ul class="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-(--d-r-md) border border-(--d-line) bg-(--d-line) sm:grid-cols-6">
        <li
          v-for="rule in requirements"
          :key="rule.id"
          class="flex h-[68px] flex-col items-center justify-center gap-1 bg-(--d-raised) font-mono text-[12px]/4"
        >
          <span class="d-stack text-[13px]">
            <span
              v-for="(glyph, name) in glyphs"
              :key="name"
              class="d-xfade"
              :class="glyph.tone"
              :data-on="status(rule) === name"
            >{{ glyph.text }}</span>
          </span>
          <span class="text-default">{{ rule.id }}</span>
          <span class="text-dimmed tabular-nums">{{ rule.weight }}</span>
        </li>
      </ul>

      <p class="mt-5 flex items-baseline justify-between gap-4 text-[13px] text-dimmed">
        <span>Opportunities</span>
        <span>Never move the score</span>
      </p>
      <ul class="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-(--d-r-md) border border-(--d-line) bg-(--d-line) sm:grid-cols-4">
        <li
          v-for="rule in opportunities"
          :key="rule.id"
          class="flex h-11 items-center gap-2.5 bg-(--d-raised) px-3 font-mono text-[12px]/4"
        >
          <span class="d-stack w-[1ch] shrink-0 text-[13px]">
            <span
              v-for="(glyph, name) in glyphs"
              :key="name"
              class="d-xfade"
              :class="glyph.tone"
              :data-on="status(rule) === name"
            >{{ glyph.text }}</span>
          </span>
          <span class="truncate text-default">{{ rule.id }}</span>
        </li>
      </ul>
    </div>

    <div class="mt-5 border-t border-(--d-line) px-5 py-4 sm:px-6">
      <div class="flex items-center justify-between gap-4">
        <div class="d-stack min-w-0 text-[13px] text-default">
          <span class="d-xfade truncate text-dimmed" :data-on="step < 0">Scanning server/api/checkout.post.ts</span>
          <span
            v-for="(s, i) in steps"
            :key="s.label"
            class="d-xfade truncate"
            :data-on="step === i"
          >{{ s.label }}</span>
        </div>
        <p class="flex shrink-0 items-baseline gap-1.5">
          <span class="w-[3ch] text-right font-mono text-[22px]/none text-highlighted tabular-nums">{{ step < 0 ? '–' : score }}</span>
          <span class="text-[13px] text-dimmed">/ 100</span>
        </p>
      </div>
      <div class="d-stack mt-1 font-mono text-[12px]/5 text-muted">
        <span class="d-xfade truncate" :data-on="step < 0">&nbsp;</span>
        <span
          v-for="(s, i) in steps"
          :key="s.code"
          class="d-xfade truncate"
          :data-on="step === i"
        >{{ s.code }}</span>
      </div>
    </div>
  </DocsFigure>
</template>
