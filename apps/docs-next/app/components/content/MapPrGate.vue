<script setup lang="ts">
type RunState = 'queued' | 'running' | 'done'

interface Run {
  pr: string
  title: string
  score: number
}

const THRESHOLD = 80

const runs: Run[] = [
  { pr: '#128', title: 'checkout: retry declined cards', score: 76 },
  { pr: '#129', title: 'instrument the three dark handlers', score: 86 },
]

const state = ref<RunState[]>(runs.map(() => 'queued'))

function setRun(i: number, s: RunState) {
  state.value = state.value.map((prev, j) => j === i ? s : prev)
}

const { root, finished, still, playing, duration, replay } = useFigure({
  steps: runs.flatMap((_, i) => [
    { at: 300 + i * 2200, run: () => setRun(i, 'running') },
    { at: 1300 + i * 2200, run: () => setRun(i, 'done') },
  ]),
  reset: () => {
    state.value = runs.map(() => 'queued')
  },
  settle: () => {
    state.value = runs.map(() => 'done')
  },
})

const latest = computed(() => {
  const i = state.value.findLastIndex(s => s === 'done')
  return i < 0 ? undefined : runs[i]
})

function passes(run: Run) {
  return run.score >= THRESHOLD
}
</script>

<template>
  <DocsFigure
    ref="root"
    caption="The same gated job on two pull requests. The first lands the score at 76 and fails the build; the next one instruments three handlers and passes at 86."
    :finished
    :still
    :playing
    :duration
    @replay="replay"
  >
    <div class="px-5 pt-5 sm:px-6">
      <p class="flex items-baseline justify-between gap-4 text-[13px] text-dimmed">
        <span>Project score</span>
        <span class="font-mono text-[12px]">--min-score {{ THRESHOLD }}</span>
      </p>
      <div class="relative mt-5 h-6 overflow-hidden">
        <div class="absolute inset-x-0 top-3 h-px bg-(--d-line-strong)" />
        <div
          class="absolute top-3 left-0 h-px w-full origin-left bg-(--d-signal) transition-transform duration-700 ease-(--d-ease-move)"
          :style="{ transform: `scaleX(${(latest?.score ?? 0) / 100})` }"
        />
        <div class="absolute top-1 h-5 w-px bg-(--d-line-strong)" :style="{ left: `${THRESHOLD}%` }" />
        <div
          class="absolute inset-x-0 top-0 transition-[transform,opacity] duration-700 ease-(--d-ease-move)"
          :class="latest ? 'opacity-100' : 'opacity-0'"
          :style="{ transform: `translateX(${latest?.score ?? 0}%)` }"
        >
          <span class="block size-[7px] -translate-x-1/2 translate-y-[9px] rounded-full bg-(--d-signal)" />
        </div>
      </div>
    </div>

    <ul class="mt-3 flex flex-col px-5 sm:px-6">
      <li
        v-for="(run, i) in runs"
        :key="run.pr"
        class="grid h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t border-(--d-line)"
      >
        <span class="flex min-w-0 items-baseline gap-2.5 font-mono text-[12.5px]">
          <span class="shrink-0 text-highlighted tabular-nums">{{ run.pr }}</span>
          <span class="truncate text-muted">{{ run.title }}</span>
        </span>
        <span class="d-stack w-[6.5rem] justify-items-end text-[13px]">
          <span class="d-xfade text-dimmed" :data-on="state[i] === 'queued'">Queued</span>
          <span class="d-xfade text-muted" :data-on="state[i] === 'running'">Running</span>
          <span class="d-xfade inline-flex items-center gap-2" :data-on="state[i] === 'done'">
            <span class="size-[5px] rounded-full" :class="passes(run) ? 'bg-(--d-signal)' : 'bg-(--d-out-error)'" />
            <span class="text-highlighted">{{ passes(run) ? 'Passed' : 'Failed' }}, {{ run.score }}</span>
          </span>
        </span>
      </li>
    </ul>

    <div class="overflow-x-auto overflow-y-hidden border-t border-(--d-line) px-5 py-4 sm:px-6">
      <div class="d-stack font-mono text-[12px]/5 whitespace-nowrap">
        <span class="d-xfade text-dimmed" :data-on="!latest">waiting for evlog map --min-score {{ THRESHOLD }}</span>
        <span
          v-for="run in runs"
          :key="run.pr"
          class="d-xfade"
          :data-on="latest === run"
        >
          <span class="font-medium" :class="passes(run) ? 'text-(--d-out-ok)' : 'text-(--d-out-error)'">GATE</span>
          <span class="ml-[1ch] text-default">score {{ run.score }} {{ passes(run) ? 'meets' : 'is below' }} --min-score {{ THRESHOLD }} — exit code {{ passes(run) ? 0 : 1 }}</span>
        </span>
      </div>
    </div>
  </DocsFigure>
</template>
