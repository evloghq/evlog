<script setup lang="ts">
interface Level {
  name: string
  rate: number
}

const COUNT = 40

const levels: Level[] = [
  { name: 'info', rate: 10 },
  { name: 'warn', rate: 50 },
  { name: 'debug', rate: 0 },
  { name: 'error', rate: 100 },
]

// A fixed draw per level, so the figure keeps exactly `rate`% and looks the same on every visit.
function draw(seed: number, rate: number) {
  const target = Math.round((rate / 100) * COUNT)
  const order = Array.from({ length: COUNT }, (_, i) => i)
    .map(i => ({ i, r: Math.abs(Math.sin((i + 1) * 12.9898 + seed * 78.233) * 43758.5453) % 1 }))
    .sort((a, b) => a.r - b.r)
  const kept = new Set(order.slice(0, target).map(({ i }) => i))
  return Array.from({ length: COUNT }, (_, i) => kept.has(i))
}

const draws = levels.map((level, i) => draw(i + 3, level.rate))

const evaluated = ref(0)

const CELL = 28

const { root, finished, still, replay } = useFigure({
  steps: Array.from({ length: COUNT }, (_, i) => ({ at: 200 + i * CELL, run: () => {
    evaluated.value = i + 1
  } })),
  reset: () => {
    evaluated.value = 0
  },
  settle: () => {
    evaluated.value = COUNT
  },
})

function kept(row: number) {
  return draws[row]!.slice(0, evaluated.value).filter(Boolean).length
}

function cellClass(row: number, i: number) {
  if (i >= evaluated.value) return 'bg-transparent ring-(--d-line)'
  return draws[row]![i] ? 'bg-(--d-signal) ring-transparent' : 'bg-(--d-raised-strong) ring-transparent'
}
</script>

<template>
  <DocsFigure
    ref="root"
    caption="Forty events per level, sampled with the rates above. Blue cells are kept. error is not listed in rates, so every error is kept."
    :finished
    :still
    @replay="replay"
  >
    <div class="flex flex-col gap-5 p-5 sm:p-6">
      <div
        v-for="(level, row) in levels"
        :key="level.name"
        class="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-4 gap-y-2 sm:grid-cols-[5rem_minmax(0,1fr)_6.5rem]"
      >
        <div class="font-mono text-[12.5px]">
          <span class="text-highlighted">{{ level.name }}</span>
          <span class="ml-2 text-dimmed tabular-nums">{{ level.rate }}%</span>
        </div>

        <div class="grid grid-cols-[repeat(20,minmax(0,1fr))] gap-[3px] sm:grid-cols-[repeat(40,minmax(0,1fr))]">
          <span
            v-for="i in COUNT"
            :key="i"
            class="aspect-square max-w-2.5 rounded-[2px] ring-1 transition-[background-color,box-shadow] duration-200 ring-inset"
            :class="cellClass(row, i - 1)"
          />
        </div>

        <p class="col-start-2 text-[12.5px] text-dimmed tabular-nums sm:col-start-3 sm:text-right">
          <span class="text-default">{{ kept(row) }}</span> of {{ COUNT }} kept
        </p>
      </div>
    </div>
  </DocsFigure>
</template>
