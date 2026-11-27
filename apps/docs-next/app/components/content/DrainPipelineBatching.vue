<script setup lang="ts">
interface Send {
  batch: string
  attempt: number
  status: number
  outcome: string
}

const BUFFER = 8
const BATCH = 4

const sends: Send[] = [
  { batch: '#1–4', attempt: 1, status: 200, outcome: 'Delivered' },
  { batch: '#5–8', attempt: 1, status: 503, outcome: 'Retry in 1s' },
  { batch: '#5–8', attempt: 2, status: 503, outcome: 'Retry in 2s' },
  { batch: '#5–8', attempt: 3, status: 200, outcome: 'Delivered' },
]

const buffer = ref<number[]>([])
const taking = ref(0)
const dropping = ref(false)
const dropped = ref<number[]>([])
const sent = ref(0)
const answered = ref(0)

const delivered = computed(() => sends.slice(0, answered.value).filter(send => send.status === 200).length * BATCH)

function arrive(id: number) {
  return () => {
    buffer.value = [...buffer.value, id]
  }
}

function seal() {
  taking.value = BATCH
}

function take() {
  buffer.value = buffer.value.slice(BATCH)
  taking.value = 0
  sent.value++
}

function overflow(id: number) {
  return [
    { at: 0, run: () => {
      dropping.value = true
    } },
    { at: 260, run: () => {
      dropping.value = false
      dropped.value = [...dropped.value, buffer.value[0]!]
      buffer.value = [...buffer.value.slice(1), id]
    } },
  ]
}

function answer() {
  answered.value++
}

const ARRIVE = 180

const steps = [
  ...[1, 2, 3, 4].map((id, i) => ({ at: 200 + i * ARRIVE, run: arrive(id) })),
  { at: 960, run: seal },
  { at: 1260, run: take },
  { at: 1660, run: answer },
  ...[5, 6, 7, 8].map((id, i) => ({ at: 1900 + i * ARRIVE, run: arrive(id) })),
  { at: 2660, run: seal },
  { at: 2960, run: take },
  { at: 3360, run: answer },
  ...[9, 10, 11, 12, 13, 14, 15, 16].map((id, i) => ({ at: 3100 + i * ARRIVE, run: arrive(id) })),
  { at: 3900, run: () => {
    sent.value++
  } },
  { at: 4300, run: answer },
  ...overflow(17).map(step => ({ at: 4700 + step.at, run: step.run })),
  ...overflow(18).map(step => ({ at: 5200 + step.at, run: step.run })),
  { at: 5800, run: () => {
    sent.value++
  } },
  { at: 6200, run: answer },
]

const { root, finished, still, playing, duration, replay } = useFigure({
  steps,
  reset: () => {
    buffer.value = []
    taking.value = 0
    dropping.value = false
    dropped.value = []
    sent.value = 0
    answered.value = 0
  },
  settle: () => {
    buffer.value = [11, 12, 13, 14, 15, 16, 17, 18]
    taking.value = 0
    dropping.value = false
    dropped.value = [9, 10]
    sent.value = sends.length
    answered.value = sends.length
  },
})

function slotClass(i: number) {
  if (i >= buffer.value.length) return 'text-transparent ring-(--d-line)'
  if (i < taking.value) return 'bg-(--d-raised-strong) text-highlighted ring-(--d-signal)'
  if (i === 0 && dropping.value) return 'bg-(--d-raised-strong) text-(--d-warn) ring-(--d-warn)'
  return 'bg-(--d-raised-strong) text-default ring-(--d-line-strong)'
}
</script>

<template>
  <DocsFigure
    ref="root"
    caption="Batches of 4, a buffer of 8. The second batch fails twice and is retried with backoff. Events keep arriving meanwhile, and once the buffer is full the oldest are dropped to make room."
    :finished
    :still
    :playing
    :duration
    @replay="replay"
  >
    <div class="px-5 pt-4 pb-4 sm:px-6">
      <p class="mb-3 flex items-baseline gap-4 text-[13px] text-dimmed">
        Buffer
        <span class="ml-auto tabular-nums">{{ buffer.length }} of {{ BUFFER }}</span>
      </p>

      <ol class="grid grid-cols-8 gap-1.5 font-mono text-[12px] tabular-nums">
        <li
          v-for="(_, i) in BUFFER"
          :key="i"
          class="grid h-8 place-items-center rounded-(--d-r-sm) ring-1 transition-[background-color,color,box-shadow] duration-200 ring-inset"
          :class="slotClass(i)"
        >
          {{ buffer[i] ? `#${buffer[i]}` : '·' }}
        </li>
      </ol>

      <div class="d-stack mt-3 text-[13px]/5">
        <span class="d-xfade truncate text-dimmed" :data-on="dropped.length === 0">A full buffer drops its oldest event</span>
        <span class="d-xfade truncate text-(--d-warn)" :data-on="dropped.length > 0">Buffer full, dropped {{ dropped.map(id => `#${id}`).join(', ') }}</span>
      </div>
    </div>

    <div class="border-t border-(--d-line) px-5 pt-4 pb-2 sm:px-6">
      <p class="mb-1.5 text-[13px] text-dimmed">
        Sent to the drain
      </p>

      <div class="overflow-x-auto overflow-y-hidden">
        <ul class="min-w-[18rem]">
          <li
            v-for="(send, i) in sends"
            :key="i"
            class="d-step grid h-8 grid-cols-[3.5rem_4.5rem_2rem_minmax(0,1fr)] items-center gap-3 border-b border-(--d-line) last:border-b-0"
            :data-on="sent > i"
          >
            <span class="font-mono text-[12px] text-default">{{ send.batch }}</span>
            <span class="text-[13px] text-dimmed">Attempt {{ send.attempt }}</span>
            <span
              class="d-step font-mono text-[12px] tabular-nums"
              :class="send.status === 200 ? 'text-(--d-out-ok)' : 'text-(--d-out-error)'"
              :data-on="answered > i"
            >{{ send.status }}</span>
            <span
              class="d-step truncate text-[13px]"
              :class="send.status === 200 ? 'text-highlighted' : 'text-dimmed'"
              :data-on="answered > i"
            >{{ send.outcome }}</span>
          </li>
        </ul>
      </div>
    </div>

    <p class="flex flex-wrap gap-x-6 gap-y-1 border-t border-(--d-line) px-5 pt-3.5 pb-4 text-[13px] text-dimmed tabular-nums sm:px-6">
      <span><span class="text-highlighted">{{ delivered }}</span> delivered</span>
      <span><span :class="dropped.length ? 'text-(--d-warn)' : 'text-default'">{{ dropped.length }}</span> dropped</span>
    </p>
  </DocsFigure>
</template>
