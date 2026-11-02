<script setup lang="ts">
interface Segment {
  from: number
  to: number
  label: string
  tone: 'neutral' | 'warn' | 'signal' | 'wait'
}

interface Lane {
  name: string
  segments: Segment[]
}

const SPAN = 800

const lanes: Lane[] = [
  { name: 'Request', segments: [{ from: 0, to: 234, label: '402 in 234ms', tone: 'neutral' }] },
  {
    name: 'Axiom',
    segments: [
      { from: 240, to: 330, label: '503', tone: 'warn' },
      { from: 330, to: 530, label: 'waits 200ms', tone: 'wait' },
      { from: 530, to: 610, label: '200, delivered', tone: 'signal' },
    ],
  },
]

const ticks = [0, 200, 400, 600]

// Figure time runs slower than real time so the retry can be followed.
const SCALE = 3
const FRAME = 32

const t = ref(0)

const { root, finished, still, replay } = useFigure({
  steps: Array.from({ length: Math.ceil((SPAN * SCALE) / FRAME) + 1 }, (_, i) => ({
    at: 200 + i * FRAME,
    run: () => {
      t.value = Math.min(SPAN, (i * FRAME) / SCALE)
    },
  })),
  reset: () => {
    t.value = 0
  },
  settle: () => {
    t.value = SPAN
  },
})

function pct(ms: number) {
  return `${(ms / SPAN) * 100}%`
}

function progress(segment: Segment) {
  return Math.max(0, Math.min(1, (t.value - segment.from) / (segment.to - segment.from)))
}

const TONES = {
  neutral: 'bg-(--ui-text-dimmed)',
  warn: 'bg-(--d-warn)',
  signal: 'bg-(--d-signal)',
  wait: '',
}

const responded = computed(() => t.value >= 234)
</script>

<template>
  <DocsFigure
    ref="root"
    caption="One request and its drain on the same clock. The response leaves at 234ms. The drain sends after it, gets a 503, waits 200ms and delivers on the second attempt."
    :finished
    :still
    @replay="replay"
  >
    <div class="overflow-x-auto px-5 pt-5 pb-5 sm:px-6">
      <div class="min-w-[32rem] pl-20">
        <div class="relative h-5">
          <span
            class="d-step absolute top-0 -translate-x-1/2 text-[12px] whitespace-nowrap text-dimmed"
            :data-on="responded"
            :style="{ left: pct(234) }"
          >Response sent</span>
        </div>

        <div class="relative">
          <div class="pointer-events-none absolute inset-0" aria-hidden="true">
            <span
              v-for="tick in ticks"
              :key="tick"
              class="absolute inset-y-0 w-px bg-(--d-line)"
              :style="{ left: pct(tick) }"
            />
            <span
              class="absolute inset-y-0 w-px border-l border-dashed border-(--ui-text-dimmed) transition-opacity duration-300"
              :class="responded ? 'opacity-60' : 'opacity-0'"
              :style="{ left: pct(234) }"
            />
            <span
              class="absolute inset-y-0 w-px bg-(--d-signal-text) transition-opacity duration-300"
              :class="t > 0 && t < 610 ? 'opacity-80' : 'opacity-0'"
              :style="{ left: pct(Math.min(t, 610)) }"
            />
          </div>

          <div v-for="lane in lanes" :key="lane.name" class="relative h-14">
            <span class="absolute top-[13px] -left-20 text-[13px] text-dimmed">{{ lane.name }}</span>

            <template v-for="segment in lane.segments" :key="segment.label">
              <span
                v-if="segment.tone === 'wait'"
                class="absolute top-[21px] h-px origin-left border-t border-dashed border-(--ui-text-dimmed)"
                :style="{ left: pct(segment.from), width: pct(segment.to - segment.from), transform: `scaleX(${progress(segment)})` }"
              />
              <span
                v-else
                class="absolute top-[16px] h-[11px] origin-left rounded-[4px]"
                :class="TONES[segment.tone]"
                :style="{ left: pct(segment.from), width: pct(segment.to - segment.from), transform: `scaleX(${progress(segment)})` }"
              />
              <span
                class="d-step absolute top-[32px] text-[12.5px] whitespace-nowrap"
                :class="[
                  segment.tone === 'signal' ? 'text-highlighted' : segment.tone === 'warn' ? 'text-(--d-warn)' : 'text-dimmed',
                  segment.tone === 'wait' ? '-translate-x-1/2' : '',
                ]"
                :data-on="progress(segment) >= 1"
                :style="{ left: pct(segment.tone === 'wait' ? (segment.from + segment.to) / 2 : segment.from) }"
              >
                {{ segment.label }}
              </span>
            </template>
          </div>
        </div>

        <div class="relative mt-2.5 h-5 text-[12px] text-dimmed tabular-nums">
          <span
            v-for="tick in ticks"
            :key="tick"
            class="absolute -translate-x-1/2 first:translate-x-0"
            :style="{ left: pct(tick) }"
          >
            {{ tick === 0 ? '0' : `${tick}ms` }}
          </span>
        </div>
      </div>
    </div>
  </DocsFigure>
</template>
