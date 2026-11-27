<script setup lang="ts">
const fields = [
  { key: 'method', value: '"POST"' },
  { key: 'path', value: '"/api/checkout"' },
  { key: 'status', value: '502' },
  { key: 'error', value: '"read ECONNRESET api.stripe.com"' },
  { key: 'duration', value: '2310' },
]

const options = [
  { label: 'client', probability: 0.03 },
  { label: 'app', probability: 0.04 },
  { label: 'upstream', probability: 0.93 },
]

const answer = [
  { key: 'signals', depth: 0 },
  { key: 'fault', depth: 1 },
  { key: 'value', value: '"upstream"', depth: 2 },
  { key: 'confidence', value: '0.93', depth: 2 },
]

const WINNER = 'upstream'

const step = ref(0)

const { root, finished, still, playing, duration, replay } = useFigure({
  steps: [1, 2, 3, 4].map(n => ({ at: 300 + (n - 1) * 1000, run: () => {
    step.value = n
  } })),
  reset: () => {
    step.value = 0
  },
  settle: () => {
    step.value = 4
  },
})
</script>

<template>
  <DocsFigure
    ref="root"
    caption="An event matches the signal's when, the model reads it and gives a probability for each option, and the answer lands on the event as signals.fault."
    :finished
    :still
    :playing
    :duration
    @replay="replay"
  >
    <div class="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div class="min-w-0 border-b border-(--d-line) md:border-r md:border-b-0">
        <p class="px-5 pt-5 text-[13px] text-dimmed">
          The event
        </p>
        <div class="overflow-x-auto overflow-y-hidden px-5 pt-4 pb-5 font-mono text-[12px]/5">
          <p
            v-for="(field, i) in fields"
            :key="field.key"
            class="d-step whitespace-nowrap"
            :data-on="step >= 1"
            :style="{ transitionDelay: step >= 1 ? `${i * 60}ms` : undefined }"
          >
            <span class="text-muted">{{ field.key }}:</span>
            <span class="ml-[1ch] text-default">{{ field.value }}</span>
          </p>
          <p
            v-for="(line, i) in answer"
            :key="line.key"
            class="d-step whitespace-nowrap"
            :data-on="step >= 4"
            :style="{ paddingLeft: `${line.depth * 2}ch`, transitionDelay: step >= 4 ? `${i * 60}ms` : undefined }"
          >
            <span class="text-muted">{{ line.key }}:</span>
            <span v-if="line.value" class="ml-[1ch] text-highlighted">{{ line.value }}</span>
          </p>
        </div>
      </div>

      <div class="p-5">
        <p class="text-[13px] text-dimmed">
          The signal
        </p>
        <p class="d-step mt-4 font-mono text-[12px]/5" :data-on="step >= 2">
          <span class="text-muted">ask:</span>
          <span class="ml-[1ch] text-default">"Who is responsible for this failure?"</span>
        </p>

        <ul class="mt-4 flex flex-col font-mono text-[12px]/5">
          <li
            v-for="option in options"
            :key="option.label"
            class="d-step grid h-7 grid-cols-[8ch_minmax(0,1fr)_4ch] items-center gap-3"
            :data-on="step >= 2"
          >
            <span
              class="truncate transition-colors duration-300"
              :class="step >= 3 && option.label === WINNER ? 'text-highlighted' : 'text-muted'"
            >{{ option.label }}</span>
            <span class="h-px bg-(--d-line)">
              <span
                class="block h-px origin-left transition-transform duration-700 ease-(--d-ease-move)"
                :class="option.label === WINNER ? 'bg-(--d-signal)' : 'bg-(--d-line-strong)'"
                :style="{ transform: `scaleX(${step >= 3 ? option.probability : 0})` }"
              />
            </span>
            <span
              class="text-right tabular-nums transition-opacity duration-300"
              :class="[step >= 3 ? 'opacity-100' : 'opacity-0', option.label === WINNER ? 'text-highlighted' : 'text-dimmed']"
            >{{ option.probability.toFixed(2) }}</span>
          </li>
        </ul>
      </div>
    </div>
  </DocsFigure>
</template>
