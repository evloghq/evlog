<script setup lang="ts">
interface Emitted {
  method: string
  path: string
  status: number
}

const emitted: Emitted[] = [
  { method: 'POST', path: '/api/checkout', status: 200 },
  { method: 'GET', path: '/api/cart', status: 200 },
  { method: 'POST', path: '/api/email', status: 500 },
]

const subscribers = [
  { name: 'subscribe()', verb: 'Called' },
  { name: 'events()', verb: 'Yielded' },
  { name: 'recent()', verb: 'Buffered' },
]

const BUFFER = 200

const shown = ref(0)
const reached = ref(0)

const ROW = 900

const { root, finished, still, playing, duration, replay } = useFigure({
  steps: emitted.flatMap((_, i) => [
    { at: 200 + i * ROW, run: () => {
      shown.value = i + 1
    } },
    ...subscribers.map((_, j) => ({ at: 200 + i * ROW + 260 + j * 120, run: () => {
      reached.value = i * subscribers.length + j + 1
    } })),
  ]),
  reset: () => {
    shown.value = 0
    reached.value = 0
  },
  settle: () => {
    shown.value = emitted.length
    reached.value = emitted.length * subscribers.length
  },
})

function delivered(i: number, j: number) {
  return reached.value > i * subscribers.length + j
}

const buffered = computed(() => Math.floor(reached.value / subscribers.length))
</script>

<template>
  <DocsFigure
    ref="root"
    caption="Each event the drain receives reaches every subscriber in the same process, without being serialized. recent() keeps the last ones for a subscriber that arrives later."
    :finished
    :still
    :playing
    :duration
    @replay="replay"
  >
    <div class="hidden grid-cols-[minmax(0,1fr)_repeat(3,6.5rem)] gap-4 px-5 pt-5 pb-3 text-[13px] text-dimmed sm:grid sm:px-6">
      <span>stream.drain(ctx)</span>
      <span v-for="sub in subscribers" :key="sub.name" class="font-mono text-[12px]">{{ sub.name }}</span>
    </div>

    <ul class="pt-1.5 sm:pt-0">
      <li
        v-for="(event, i) in emitted"
        :key="event.path"
        class="d-step grid grid-cols-3 gap-x-2 gap-y-1.5 border-b border-(--d-line) px-5 py-2.5 sm:grid-cols-[minmax(0,1fr)_repeat(3,6.5rem)] sm:gap-x-4 sm:px-6 sm:first:border-t"
        :data-on="shown > i"
      >
        <span class="col-span-3 truncate font-mono text-[12.5px]/5 sm:col-span-1">
          <span class="text-dimmed">{{ event.method }}</span>
          <span class="ml-2 text-default">{{ event.path }}</span>
          <span class="ml-2 tabular-nums" :class="event.status >= 500 ? 'text-(--d-out-error)' : 'text-(--d-out-ok)'">{{ event.status }}</span>
        </span>
        <span
          v-for="(sub, j) in subscribers"
          :key="sub.name"
          class="d-step inline-flex min-w-0 items-center gap-1.5 text-[13px]/5 sm:gap-2"
          :data-on="delivered(i, j)"
        >
          <span class="size-[5px] shrink-0 rounded-full bg-(--d-signal)" />
          <span class="truncate font-mono text-[12px] text-highlighted sm:hidden">{{ sub.name }}</span>
          <span class="hidden text-highlighted sm:inline">{{ sub.verb }}</span>
        </span>
      </li>
    </ul>

    <p class="px-5 pt-3.5 pb-4 text-[13px] sm:px-6 text-dimmed tabular-nums">
      <span class="text-highlighted">{{ buffered }} of {{ BUFFER }}</span> events in the recent() buffer
    </p>
  </DocsFigure>
</template>
