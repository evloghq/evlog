<script setup lang="ts">
interface Rule {
  id: string
  weight: number
  /** The fix that satisfies it, or `null` when the rule does not apply to this handler. */
  step: number | null
}

const rules: Rule[] = [
  { id: 'wide-event', weight: 40, step: 1 },
  { id: 'context', weight: 15, step: 2 },
  { id: 'audit', weight: 25, step: 3 },
  { id: 'structured-errors', weight: 20, step: null },
  { id: 'error-handling', weight: 15, step: null },
  { id: 'page-error-handling', weight: 20, step: null },
]

interface Line {
  /** The fix that adds the line. 0 is code that was already there. */
  step: number
  text: string
}

const lines: Line[] = [
  { step: 0, text: 'export default defineEventHandler(async (event) => {' },
  { step: 1, text: '  const log = useLogger(event)' },
  { step: 2, text: '  log.set({ provider, flow: \'oauth\' })' },
  { step: 0, text: '  const session = await auth.handler(event)' },
  { step: 3, text: '  log.audit({' },
  { step: 3, text: '    action: \'auth.login\',' },
  { step: 3, text: '    actor: { type: \'user\', id: session.user.id },' },
  { step: 3, text: '  })' },
  { step: 0, text: '  return session' },
  { step: 0, text: '})' },
]

const step = ref(0)

const { root, finished, still, playing, duration, replay } = useFigure({
  steps: [1, 2, 3].map(n => ({ at: 500 + (n - 1) * 1100, run: () => {
    step.value = n
  } })),
  reset: () => {
    step.value = 0
  },
  settle: () => {
    step.value = 3
  },
})

function passes(rule: Rule) {
  return rule.step !== null && step.value >= rule.step
}

const score = computed(() => 100 - rules.reduce((lost, rule) => rule.step !== null && !passes(rule) ? lost + rule.weight : lost, 0))
</script>

<template>
  <DocsFigure
    ref="root"
    caption="The auth handler from the playground, one fix at a time. Each fix gives back exactly the weight of the rule it satisfies, and a rule that does not apply costs nothing."
    :finished
    :still
    :playing
    :duration
    @replay="replay"
  >
    <div class="grid md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div class="min-w-0 border-b border-(--d-line) md:border-r md:border-b-0">
        <p class="px-5 pt-5 text-[13px] text-dimmed">
          server/api/auth/[...all].ts
        </p>
        <pre class="overflow-x-auto overflow-y-hidden px-5 pt-4 pb-5 font-mono text-[12px]/5"><span
          v-for="(line, i) in lines"
          :key="i"
          class="d-step block whitespace-pre"
          :class="line.step ? 'text-highlighted' : 'text-muted'"
          :data-on="step >= line.step"
        >{{ line.text }}</span></pre>
      </div>

      <div class="p-5">
        <p class="flex items-baseline gap-1.5">
          <span class="w-[3ch] text-right font-mono text-[22px]/none text-highlighted tabular-nums">{{ score }}</span>
          <span class="text-[13px] text-dimmed">/ 100</span>
        </p>
        <div class="mt-3 h-px bg-(--d-line)">
          <div
            class="h-px origin-left bg-(--d-signal) transition-transform duration-700 ease-(--d-ease-move)"
            :style="{ transform: `scaleX(${score / 100})` }"
          />
        </div>

        <ul class="mt-4 flex flex-col font-mono text-[12px]/5">
          <li
            v-for="rule in rules"
            :key="rule.id"
            class="grid h-7 grid-cols-[1ch_minmax(0,1fr)_4ch] items-center gap-2.5"
          >
            <span class="d-stack">
              <span class="d-xfade text-(--d-out-error)" :data-on="rule.step !== null && !passes(rule)">✗</span>
              <span class="d-xfade text-(--d-out-ok)" :data-on="passes(rule)">✓</span>
              <span class="d-xfade text-dimmed" :data-on="rule.step === null">·</span>
            </span>
            <span class="truncate" :class="rule.step === null ? 'text-dimmed' : 'text-default'">{{ rule.id }}</span>
            <span class="d-stack text-right tabular-nums">
              <span class="d-xfade text-muted" :data-on="rule.step !== null && !passes(rule)">−{{ rule.weight }}</span>
              <span class="d-xfade text-dimmed" :data-on="passes(rule)">0</span>
              <span class="d-xfade text-dimmed" :data-on="rule.step === null">n/a</span>
            </span>
          </li>
        </ul>
      </div>
    </div>
  </DocsFigure>
</template>
