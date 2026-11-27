<script setup lang="ts">
interface Frame {
  type: 'hello' | 'replay' | 'event' | 'ping'
  data: Record<string, string | number>
}

const frames: Frame[] = [
  { type: 'hello', data: { evlogVersion: '3.0.0', bufferSize: 500, heartbeatMs: 15000 } },
  { type: 'replay', data: { method: 'POST', path: '/api/login', status: 200 } },
  { type: 'replay', data: { method: 'GET', path: '/api/me', status: 200 } },
  { type: 'event', data: { method: 'POST', path: '/api/checkout', status: 200 } },
  { type: 'ping', data: { t: 1778323200123 } },
  { type: 'event', data: { method: 'POST', path: '/api/email', status: 500 } },
]

const LABELS = {
  hello: 'Connected',
  replay: 'From the buffer',
  event: 'Live',
  ping: 'Heartbeat',
}

const shown = ref(0)

const { root, finished, still, playing, duration, replay } = useFigure({
  steps: frames.map((_, i) => ({ at: 300 + i * 520, run: () => {
    shown.value = i + 1
  } })),
  reset: () => {
    shown.value = 0
  },
  settle: () => {
    shown.value = frames.length
  },
})

function value(v: string | number) {
  return typeof v === 'string' ? `"${v}"` : String(v)
}
</script>

<template>
  <DocsFigure
    ref="root"
    caption="A client connects with ?since= and reads the stream. hello comes first, then the buffered events as replay, then live events, with a ping between them to keep the connection open."
    :finished
    :still
    :playing
    :duration
    @replay="replay"
  >
    <p class="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-(--d-line) px-5 py-3.5 font-mono text-[12px] sm:px-6">
      <span class="text-default">GET /?since=2026-05-09T10:00:00Z</span>
      <span class="d-step ml-auto shrink-0 text-dimmed" :data-on="shown > 0"><span class="text-(--d-out-ok)">200</span> text/event-stream</span>
    </p>

    <div class="px-5 py-3 sm:px-6">
      <ol>
        <li
          v-for="(frame, i) in frames"
          :key="i"
          class="d-step grid gap-x-4 py-1.5 sm:grid-cols-[7.5rem_minmax(0,1fr)]"
          :data-on="shown > i"
        >
          <span class="text-[13px]/5 text-dimmed">{{ LABELS[frame.type] }}</span>
          <span class="font-mono text-[12px]/5 min-w-0 whitespace-nowrap text-default">
            <span v-if="frame.type === 'ping'" class="block truncate"><span class="text-muted">event:</span> ping</span>
            <span class="block truncate">
              <span class="text-muted">data:</span> <span class="text-dimmed">{</span><span class="text-muted">"evlog":</span>"1"<span class="text-dimmed">,</span><span class="text-muted">"type":</span><span :class="frame.type === 'event' ? 'text-highlighted' : ''">"{{ frame.type }}"</span><span class="text-dimmed">,</span><span class="text-muted">"data":</span><span class="text-dimmed">{</span><template v-for="(v, k, j) in frame.data" :key="k"><span v-if="j" class="text-dimmed">,</span><span class="text-muted">"{{ k }}":</span><span :class="k === 'status' && Number(v) >= 500 ? 'text-(--d-out-error)' : ''">{{ value(v) }}</span></template><span class="text-dimmed">&#125;&#125;</span>
            </span>
          </span>
        </li>
      </ol>
    </div>
  </DocsFigure>
</template>
