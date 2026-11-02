<script setup lang="ts">
interface Request {
  method: string
  path: string
  status: number
  duration: number
  /** The `keep` condition the request meets, if any. */
  rule?: 'status' | 'duration' | 'path'
  /** Survives the 10% info draw. */
  drawn?: boolean
}

const requests: Request[] = [
  { method: 'POST', path: '/api/users', status: 200, duration: 45 },
  { method: 'POST', path: '/api/users', status: 500, duration: 45, rule: 'status' },
  { method: 'GET', path: '/api/products', status: 200, duration: 2300, rule: 'duration' },
  { method: 'POST', path: '/api/payments/charge', status: 200, duration: 120, rule: 'path' },
  { method: 'POST', path: '/api/checkout', status: 200, duration: 120, drawn: true },
  { method: 'GET', path: '/api/health', status: 200, duration: 12 },
]

const RULES = {
  status: 'status ≥ 400',
  duration: 'duration ≥ 1000',
  path: '/api/payments/**',
} as const

const shown = ref(0)
const decided = ref(0)

const ROW = 560

const { root, finished, still, replay } = useFigure({
  steps: requests.flatMap((_, i) => [
    { at: 200 + i * ROW, run: () => {
      shown.value = i + 1
    } },
    { at: 200 + i * ROW + 300, run: () => {
      decided.value = i + 1
    } },
  ]),
  reset: () => {
    shown.value = 0
    decided.value = 0
  },
  settle: () => {
    shown.value = requests.length
    decided.value = requests.length
  },
})

function verdict(row: Request) {
  if (row.rule) return `Kept, ${RULES[row.rule]}`
  if (row.drawn) return 'Kept by the 10% draw'
  return 'Dropped'
}

function lit(row: Request, i: number, rule: Request['rule']) {
  return decided.value > i && row.rule === rule
}
</script>

<template>
  <DocsFigure
    ref="root"
    caption="keep is checked once the request is done. A request that meets a condition is kept whatever its level's rate; the others go through head sampling."
    :finished
    :still
    @replay="replay"
  >
    <div class="overflow-x-auto">
      <table class="w-full min-w-[34rem] border-collapse text-left font-mono text-[12.5px]/5">
        <thead>
          <tr class="text-[12.5px] text-dimmed [&>th]:px-5 [&>th]:pt-5 [&>th]:pb-3 [&>th]:font-sans [&>th]:font-normal">
            <th>Request</th>
            <th class="text-right">
              Status
            </th>
            <th class="text-right">
              Duration
            </th>
            <th>Decision</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, i) in requests"
            :key="i"
            class="d-step border-t border-(--d-line) [&>td]:px-5 [&>td]:py-2.5"
            :data-on="shown > i"
            :style="{ opacity: decided > i && !row.rule && !row.drawn ? 0.45 : undefined }"
          >
            <td class="whitespace-nowrap">
              <span class="text-dimmed">{{ row.method }}</span>
              <span class="ml-2 transition-colors duration-300" :class="lit(row, i, 'path') ? 'text-(--d-signal-text)' : 'text-default'">{{ row.path }}</span>
            </td>
            <td class="text-right tabular-nums transition-colors duration-300" :class="lit(row, i, 'status') ? 'text-(--d-signal-text)' : 'text-default'">
              {{ row.status }}
            </td>
            <td class="text-right tabular-nums transition-colors duration-300" :class="lit(row, i, 'duration') ? 'text-(--d-signal-text)' : 'text-default'">
              {{ row.duration }}ms
            </td>
            <td class="font-sans text-[13px] whitespace-nowrap">
              <span class="d-step inline-flex items-center gap-2" :data-on="decided > i">
                <span
                  class="size-[5px] rounded-full"
                  :class="row.rule || row.drawn ? 'bg-(--d-signal)' : 'bg-(--d-line-strong)'"
                />
                <span :class="row.rule || row.drawn ? 'text-highlighted' : 'text-dimmed'">{{ verdict(row) }}</span>
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </DocsFigure>
</template>
