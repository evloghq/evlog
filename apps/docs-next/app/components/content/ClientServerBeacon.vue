<script setup lang="ts">
interface ClientEvent {
  level: 'info' | 'warn' | 'error'
  action: string
  meta: string
}

const events: ClientEvent[] = [
  { level: 'info', action: 'page_view', meta: 'path=/products' },
  { level: 'info', action: 'add_to_cart', meta: 'items=3' },
  { level: 'warn', action: 'image_slow', meta: 'ms=4200' },
  { level: 'error', action: 'checkout_failed', meta: 'status=500' },
]

const LEVELS = { info: 'text-dimmed', warn: 'text-(--d-out-warn)', error: 'text-(--d-out-error)' }

const logged = ref(0)
const posted = ref(0)

const STEP = 600

const { root, finished, still, playing, duration, replay } = useFigure({
  steps: events.flatMap((_, i) => [
    { at: 300 + i * STEP, run: () => {
      logged.value = i + 1
    } },
    { at: 300 + i * STEP + 300, run: () => {
      posted.value = i + 1
    } },
  ]),
  reset: () => {
    logged.value = 0
    posted.value = 0
  },
  settle: () => {
    logged.value = events.length
    posted.value = events.length
  },
})
</script>

<template>
  <DocsFigure
    ref="root"
    caption="Four log calls in the browser with the transport on. Each event is posted on its own to the ingest route, with fetch and keepalive, and nothing is batched."
    :finished
    :still
    :playing
    :duration
    @replay="replay"
  >
    <div class="grid grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div class="border-b border-(--d-line) p-5 md:border-r md:border-b-0">
        <p class="mb-4 text-[13px] text-dimmed">
          Browser
        </p>
        <ul class="flex flex-col font-mono text-[12px]/5">
          <li
            v-for="(event, i) in events"
            :key="event.action"
            class="d-step flex h-7 min-w-0 items-center gap-2"
            :data-on="logged > i"
          >
            <span class="w-[5ch] shrink-0" :class="LEVELS[event.level]">{{ event.level }}</span>
            <span class="shrink-0 text-default">{{ event.action }}</span>
            <span class="truncate text-dimmed">{{ event.meta }}</span>
          </li>
        </ul>
      </div>

      <div class="p-5">
        <p class="mb-4 text-[13px] text-dimmed">
          Server
        </p>
        <ul class="flex flex-col font-mono text-[12px]/5">
          <li
            v-for="(event, i) in events"
            :key="event.action"
            class="d-step flex h-7 min-w-0 items-center gap-2"
            :data-on="posted > i"
          >
            <span
              class="size-[5px] shrink-0 rounded-full transition-colors duration-300"
              :class="posted === i + 1 ? 'bg-(--d-signal)' : 'bg-(--d-line-strong)'"
            />
            <span class="shrink-0 text-dimmed">POST</span>
            <span class="truncate text-default">/api/_evlog/ingest</span>
            <span class="ml-auto shrink-0 text-muted">{{ event.action }}</span>
          </li>
        </ul>
      </div>
    </div>

    <p class="flex flex-wrap gap-x-6 gap-y-1 border-t border-(--d-line) px-5 pt-3.5 pb-4 text-[13px] text-dimmed tabular-nums">
      <span><span class="text-highlighted">{{ posted }} of {{ events.length }}</span> requests sent</span>
      <span>fetch with keepalive: true</span>
    </p>
  </DocsFigure>
</template>
