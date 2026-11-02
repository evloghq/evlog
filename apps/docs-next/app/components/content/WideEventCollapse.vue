<script setup lang="ts">
interface Line {
  ts: string
  msg: string
  meta: string
  /** The field the line becomes on the wide event. Empty for the lines that fill the header. */
  key?: string
  value?: string
}

const lines: Line[] = [
  { ts: '10:23:45.001', msg: 'request started', meta: '/api/checkout' },
  { ts: '10:23:45.012', msg: 'authenticated', meta: 'user=42', key: 'user', value: 'id=42 plan=pro' },
  { ts: '10:23:45.024', msg: 'cart loaded', meta: 'items=3', key: 'cart', value: 'items=3 total=9999' },
  { ts: '10:23:45.069', msg: 'charge created', meta: 'ch_3Pq', key: 'charge', value: 'id=ch_3Pq amount=9999' },
  { ts: '10:23:45.180', msg: 'order created', meta: 'ord_889', key: 'order', value: 'id=ord_889' },
  { ts: '10:23:45.234', msg: 'response sent', meta: '200' },
]

const fields = lines.filter(line => line.key)

const shown = ref(0)
const folded = ref(0)

function reset() {
  shown.value = 0
  folded.value = 0
}

function settle() {
  shown.value = lines.length
  folded.value = lines.length
}

const LINE = 200
const FOLD_AT = 200 + lines.length * LINE + 700
const FOLD = 380

const { root, finished, still, replay } = useFigure({
  steps: [
    ...lines.map((_, i) => ({ at: 200 + i * LINE, run: () => {
      shown.value = i + 1
    } })),
    ...lines.map((_, i) => ({ at: FOLD_AT + i * FOLD, run: () => {
      folded.value = i + 1
    } })),
  ],
  reset,
  settle,
})

const started = computed(() => folded.value >= 1)
const emitted = computed(() => folded.value >= lines.length)

function fieldShown(key: string) {
  return folded.value > lines.findIndex(line => line.key === key)
}
</script>

<template>
  <DocsFigure
    ref="root"
    caption="The same request as six log lines and as one wide event. Each line becomes a field; the event is written once, when the response is sent."
    :finished
    :still
    @replay="replay"
  >
    <div class="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div class="border-b border-(--d-line) p-5 md:border-r md:border-b-0">
        <p class="mb-4 text-[13px] text-dimmed">
          Six log lines
        </p>
        <ol class="flex flex-col gap-1.5 font-mono text-[12px]/5">
          <li
            v-for="(line, i) in lines"
            :key="line.ts"
            class="d-step flex min-w-0 gap-3"
            :data-on="shown > i"
            :style="{ opacity: folded > i ? 0.32 : undefined }"
          >
            <span class="shrink-0 text-dimmed tabular-nums">{{ line.ts.slice(6) }}</span>
            <span class="shrink-0 text-default">{{ line.msg }}</span>
            <span class="truncate text-dimmed">{{ line.meta }}</span>
          </li>
        </ol>
      </div>

      <div class="p-5">
        <p class="mb-4 flex items-center gap-2 text-[13px] text-dimmed">
          One wide event
          <span
            class="size-[5px] rounded-full bg-(--d-signal) transition-[opacity,transform] duration-300 ease-(--d-ease)"
            :class="emitted ? 'scale-100 opacity-100' : 'scale-50 opacity-0'"
          />
        </p>

        <div class="font-mono text-[12px]/5">
          <p class="d-step flex flex-wrap gap-x-2 text-highlighted" :data-on="started">
            <span class="text-dimmed">INFO</span>
            <span>POST /api/checkout</span>
            <span class="d-step text-(--d-signal-text)" :data-on="emitted">200 in 234ms</span>
          </p>
          <ul class="d-rail ml-[3px] [--rail-mid:12px]">
            <li
              v-for="field in fields"
              :key="field.key"
              class="d-step"
              :data-on="fieldShown(field.key!)"
            >
              <span class="block truncate py-0.5">
                <span class="text-muted">{{ field.key }}:</span>
                <span class="ml-[1ch] text-default">{{ field.value }}</span>
              </span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </DocsFigure>
</template>
