<script setup lang="ts">
interface Stage {
  name: string
  /** What the stage did to the checkout request. */
  outcome: string
}

const stages: Stage[] = [
  { name: 'Route filter', outcome: '/api/checkout included' },
  { name: 'Create logger', outcome: 'requestId, timer' },
  { name: 'Accumulate', outcome: 'log.set() ×3' },
  { name: 'Tail sampling', outcome: 'no keep rule matched' },
  { name: 'Head sampling', outcome: 'info kept at 100%' },
  { name: 'Build', outcome: 'level, duration' },
  { name: 'Redact', outcome: 'user.email masked' },
  { name: 'Enrich', outcome: 'userAgent, geo' },
  { name: 'Drain', outcome: 'sent to Axiom' },
]

const STAGE = { create: 1, accumulate: 2, build: 5, redact: 6, enrich: 7, drain: 8 }

const sets = [
  { key: 'user', value: 'id=usr_123' },
  { key: 'cart', value: 'items=3 total=9999' },
  { key: 'payment', value: 'method=card status=ok' },
]

const enriched = [
  { key: 'userAgent', value: 'browser=Chrome os=macOS' },
  { key: 'geo', value: 'country=FR region=IDF' },
]

const reached = ref(0)
const setCount = ref(0)

const STEP = 560
const SET = 380

const times = stages.map((_, i) => 200 + i * STEP + (i > STAGE.accumulate ? (sets.length - 1) * SET : 0))

const { root, finished, still, playing, duration, replay } = useFigure({
  steps: [
    ...times.map((at, i) => ({ at, run: () => {
      reached.value = i + 1
    } })),
    ...sets.map((_, i) => ({ at: times[STAGE.accumulate]! + i * SET, run: () => {
      setCount.value = i + 1
    } })),
  ],
  reset: () => {
    reached.value = 0
    setCount.value = 0
  },
  settle: () => {
    reached.value = stages.length
    setCount.value = sets.length
  },
})

function past(stage: number) {
  return reached.value > stage
}
</script>

<template>
  <DocsFigure
    ref="root"
    caption="One checkout request through every stage, in order. The handler's log.set() calls fill the event; redaction runs before the enrichers, and the drain receives what the console prints."
    :finished
    :still
    :playing
    :duration
    @replay="replay"
  >
    <div class="grid grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div class="border-b border-(--d-line) p-5 md:border-r md:border-b-0">
        <p class="mb-4 text-[13px] text-dimmed">
          Stages
        </p>
        <ol class="flex flex-col">
          <li
            v-for="(stage, i) in stages"
            :key="stage.name"
            class="grid h-7 grid-cols-[1.25rem_7.5rem_minmax(0,1fr)] items-center"
          >
            <span
              class="size-[5px] rounded-full transition-colors duration-300"
              :class="reached === i + 1 ? 'bg-(--d-signal)' : past(i) ? 'bg-(--ui-text-muted)' : 'bg-(--d-line-strong)'"
            />
            <span
              class="truncate text-[13px] transition-colors duration-300"
              :class="past(i) ? 'text-highlighted' : 'text-dimmed'"
            >{{ stage.name }}</span>
            <span class="d-step truncate font-mono text-[12px] text-muted" :data-on="past(i)">{{ stage.outcome }}</span>
          </li>
        </ol>
      </div>

      <div class="p-5">
        <p class="mb-4 flex items-center gap-2 text-[13px] text-dimmed">
          The event
          <span
            class="size-[5px] rounded-full bg-(--d-signal) transition-[opacity,transform] duration-300 ease-(--d-ease)"
            :class="past(STAGE.drain) ? 'scale-100 opacity-100' : 'scale-50 opacity-0'"
          />
        </p>

        <div class="overflow-x-auto overflow-y-hidden font-mono text-[12px]/5">
          <p class="d-step flex gap-2 whitespace-nowrap text-highlighted" :data-on="past(STAGE.create)">
            <span class="d-step text-dimmed" :data-on="past(STAGE.build)">INFO</span>
            <span>POST /api/checkout</span>
            <span class="d-step text-(--d-signal-text)" :data-on="past(STAGE.build)">200 in 234ms</span>
          </p>
          <ul class="d-rail ml-[3px] [--rail-mid:12px]">
            <li class="d-step" :data-on="past(STAGE.create)">
              <span class="block truncate py-0.5">
                <span class="text-muted">requestId:</span>
                <span class="ml-[1ch] text-default">4a8ff3a8</span>
              </span>
            </li>
            <li
              v-for="(field, i) in sets"
              :key="field.key"
              class="d-step"
              :data-on="setCount > i"
            >
              <span class="flex min-w-0 py-0.5">
                <span class="shrink-0 text-muted">{{ field.key }}:</span>
                <span v-if="field.key === 'user'" class="ml-[1ch] d-stack min-w-0">
                  <span class="d-xfade truncate text-default" :data-on="!past(STAGE.redact)">{{ field.value }} email=ada@acme.com</span>
                  <span class="d-xfade truncate text-default" :data-on="past(STAGE.redact)">{{ field.value }} email=a***@acme.com</span>
                </span>
                <span v-else class="ml-[1ch] truncate text-default">{{ field.value }}</span>
              </span>
            </li>
            <li
              v-for="field in enriched"
              :key="field.key"
              class="d-step"
              :data-on="past(STAGE.enrich)"
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
