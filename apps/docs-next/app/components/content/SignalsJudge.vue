<script setup lang="ts">
interface Row {
  method: string
  path: string
  status: number
  /** Kept by head sampling: `info` at 0% keeps errors only. */
  sampled: boolean
  signal: string
  value: string
  confidence: number
  /** The signal's `keep` matched and promoted the event. */
  promoted?: boolean
}

const rows: Row[] = [
  { method: 'POST', path: '/api/checkout', status: 200, sampled: false, signal: 'silent-failure', value: 'yes', confidence: 0.93, promoted: true },
  { method: 'POST', path: '/api/checkout', status: 502, sampled: true, signal: 'fault', value: 'upstream', confidence: 0.93 },
  { method: 'GET', path: '/api/orders', status: 500, sampled: true, signal: 'fault', value: 'app', confidence: 0.91 },
  { method: 'POST', path: '/webhooks/stripe', status: 200, sampled: false, signal: 'webhook-ignored', value: 'yes', confidence: 0.95, promoted: true },
  { method: 'POST', path: '/api/agent/turn', status: 200, sampled: false, signal: 'turn-looping', value: 'yes', confidence: 0.94, promoted: true },
  { method: 'GET', path: '/api/products', status: 200, sampled: false, signal: 'silent-failure', value: 'no', confidence: 0.97 },
]

const shown = ref(0)
const judged = ref(0)

const ROW = 520

const { root, finished, still, playing, duration, replay } = useFigure({
  steps: rows.flatMap((_, i) => [
    { at: 200 + i * ROW, run: () => {
      shown.value = i + 1
    } },
    { at: 200 + i * ROW + 280, run: () => {
      judged.value = i + 1
    } },
  ]),
  reset: () => {
    shown.value = 0
    judged.value = 0
  },
  settle: () => {
    shown.value = rows.length
    judged.value = rows.length
  },
})

function kept(row: Row) {
  return row.sampled || Boolean(row.promoted)
}

const sampledKept = computed(() => rows.slice(0, judged.value).filter(row => row.sampled).length)
const promotedKept = computed(() => rows.slice(0, judged.value).filter(row => row.promoted).length)
</script>

<template>
  <DocsFigure
    ref="root"
    caption="Six requests under a rule that keeps 0% of info. Sampling keeps the two errors; a signal with keep brings back three of the 200s it would have dropped."
    :finished
    :still
    :playing
    :duration
    @replay="replay"
  >
    <div class="overflow-x-auto overflow-y-hidden">
      <table class="w-full min-w-[40rem] border-collapse text-left font-mono text-[12.5px]/5">
        <thead>
          <tr class="text-[12.5px] text-dimmed [&>th]:px-3.5 [&>th]:pt-5 [&>th:first-child]:pl-5 [&>th:last-child]:pr-5 [&>th]:pb-3 [&>th]:font-sans [&>th]:font-normal">
            <th>Request</th>
            <th class="text-right">
              Status
            </th>
            <th>Sampling</th>
            <th>Signal</th>
            <th>Outcome</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, i) in rows"
            :key="i"
            class="d-step border-t border-(--d-line) [&>td]:px-3.5 [&>td]:py-2.5 [&>td:first-child]:pl-5 [&>td:last-child]:pr-5"
            :data-on="shown > i"
            :style="{ opacity: judged > i && !kept(row) ? 0.45 : undefined }"
          >
            <td class="whitespace-nowrap">
              <span class="text-dimmed">{{ row.method }}</span>
              <span class="ml-2 text-default">{{ row.path }}</span>
            </td>
            <td class="text-right text-default tabular-nums">
              {{ row.status }}
            </td>
            <td class="font-sans text-[13px] whitespace-nowrap text-dimmed">
              {{ row.sampled ? 'Kept' : 'Dropped' }}
            </td>
            <td class="whitespace-nowrap">
              <span class="d-step" :data-on="judged > i">
                <span class="text-muted">{{ row.signal }}:</span>
                <span class="ml-[1ch]" :class="row.promoted ? 'text-highlighted' : 'text-default'">{{ row.value }}</span>
                <span class="ml-[1ch] text-dimmed tabular-nums">{{ row.confidence.toFixed(2) }}</span>
              </span>
            </td>
            <td class="font-sans text-[13px] whitespace-nowrap">
              <span class="d-step inline-flex items-center gap-2" :data-on="judged > i">
                <span class="size-[5px] rounded-full" :class="row.promoted ? 'bg-(--d-signal)' : kept(row) ? 'bg-(--d-line-strong)' : 'bg-transparent ring-1 ring-(--d-line-strong) ring-inset'" />
                <span :class="row.promoted ? 'text-highlighted' : kept(row) ? 'text-default' : 'text-dimmed'">
                  {{ row.promoted ? 'Brought back' : kept(row) ? 'Kept' : 'Dropped' }}
                </span>
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="flex flex-wrap gap-x-6 gap-y-1 border-t border-(--d-line) px-5 pt-3.5 pb-4 text-[13px] text-dimmed tabular-nums">
      <span><span class="text-default">{{ sampledKept }} of 6</span> kept by sampling</span>
      <span><span class="text-highlighted">{{ promotedKept }} of 4</span> dropped 200s brought back</span>
      <span><span class="text-default">{{ judged }}</span> model calls</span>
    </p>
  </DocsFigure>
</template>
