<script setup lang="ts">
import NumberFlow from '@number-flow/vue'
import { watchDebounced } from '@vueuse/core'
import {
  estimateLogCost,
  EVLOG_EVENT_BYTES,
  LOG_COST_PROVIDERS,
  PINO_LINE_BYTES,
  PRICES_READ_ON,
  type LogCostProvider,
} from '../../utils/log-cost'

const REQUEST_STEPS = [1e5, 3e5, 1e6, 3e6, 1e7, 3e7, 1e8, 3e8, 1e9]

const provider = ref<LogCostProvider>(LOG_COST_PROVIDERS[0]!)
const perGb = ref(LOG_COST_PROVIDERS[0]!.perGb)
const perMillionIndexed = ref(LOG_COST_PROVIDERS[0]!.perMillionIndexed)
const requestStep = ref(4)
const linesPerRequest = ref(4)
const keepPercent = ref(100)
const sound = ref(true)

const requests = computed(() => REQUEST_STEPS[requestStep.value] ?? 1e7)
const estimate = computed(() => estimateLogCost({
  requestsPerMonth: requests.value,
  linesPerRequest: linesPerRequest.value,
  perGb: perGb.value,
  perMillionIndexed: perMillionIndexed.value,
  keepRatio: keepPercent.value / 100,
}))
/** The saved share of the current bill, floored so both segments stay visible. */
const savedWidth = computed(() => `${Math.min(97, Math.max(3, estimate.value.savedRatio * 100))}%`)

function selectProvider(next: LogCostProvider) {
  provider.value = next
  perGb.value = next.perGb
  perMillionIndexed.value = next.perMillionIndexed
  tick()
}

// One event per settled interaction burst: the computed saving is the number
// this whole page argues for, and sliders are invisible to autocapture.
watchDebounced(
  [provider, requests, linesPerRequest, keepPercent, perGb, perMillionIndexed],
  () => {
    trackEvent('calculator_used', {
      provider: provider.value.id,
      requests_per_month: requests.value,
      lines_per_request: linesPerRequest.value,
      keep_percent: keepPercent.value,
      saved_usd: Math.round(estimate.value.saved),
      saved_ratio: Math.round(estimate.value.savedRatio * 100) / 100,
    })
  },
  { debounce: 1500 },
)

let audio: AudioContext | undefined
function tick() {
  if (!sound.value || typeof window === 'undefined') return
  audio ||= new AudioContext()
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.frequency.value = 880
  gain.gain.setValueAtTime(0.04, audio.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.06)
  osc.connect(gain).connect(audio.destination)
  osc.start()
  osc.stop(audio.currentTime + 0.06)
}

const compact = { notation: 'compact' as const, maximumFractionDigits: 1 }
const percent = { style: 'percent' as const, maximumFractionDigits: 0 }
const money = computed(() => {
  const digits = estimate.value.before.cost < 100 ? 2 : 0
  return { style: 'currency' as const, currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }
})

const slider = { track: 'h-[3px] bg-(--d-line-strong)', range: 'bg-(--d-signal)', thumb: 'size-3 bg-(--ui-text-highlighted) ring-0 outline-(--d-signal)/40' }
const rate = { base: 'w-28 rounded-(--d-r-md) bg-(--d-raised-strong) font-mono text-[12.5px] tabular-nums ring-(--d-line)' }
</script>

<template>
  <DocsFigure
    caption="evlog's bill against a logger that writes one line per step, for the same requests. Every input is yours to change, including the provider's rates."
    still
  >
    <div class="px-5 pt-4 pb-5 sm:px-6">
      <div class="flex items-center gap-4">
        <p class="text-[13px] text-dimmed">
          Provider
        </p>
        <button
          type="button"
          class="-mr-1.5 ml-auto grid size-7 place-items-center rounded-(--d-r-md) text-dimmed transition-colors duration-150 hover:bg-(--d-raised-strong) hover:text-highlighted"
          :aria-pressed="sound"
          :aria-label="sound ? 'Mute interaction sound' : 'Unmute interaction sound'"
          @click="sound = !sound; tick()"
        >
          <UIcon :name="sound ? 'i-lucide-volume-2' : 'i-lucide-volume-off'" class="size-3.5" />
        </button>
      </div>

      <div class="mt-2 -ml-2 flex flex-wrap gap-1">
        <button
          v-for="p in LOG_COST_PROVIDERS"
          :key="p.id"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-(--d-r-md) px-2 py-1 text-[13.5px] transition-[color,background-color,transform] duration-150 active:scale-[0.97]"
          :class="provider.id === p.id ? 'bg-(--d-raised-strong) text-highlighted ring-1 ring-(--d-line) ring-inset' : 'text-dimmed hover:text-default'"
          :aria-pressed="provider.id === p.id"
          @click="selectProvider(p)"
        >
          <UIcon :name="p.icon" class="size-3.5" />
          {{ p.name }}
        </button>
      </div>

      <div class="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-3">
        <label class="block">
          <span class="flex items-baseline justify-between gap-3 text-[13px] text-dimmed">
            Requests a month
            <span class="w-[5ch] text-right font-mono text-[12.5px] text-highlighted tabular-nums">
              <NumberFlow :value="requests" :format="compact" />
            </span>
          </span>
          <USlider
            v-model="requestStep"
            :min="0"
            :max="REQUEST_STEPS.length - 1"
            :step="1"
            size="xs"
            class="mt-3"
            :ui="slider"
            @update:model-value="tick"
          />
        </label>

        <label class="block">
          <span class="flex items-baseline justify-between gap-3 text-[13px] text-dimmed">
            Lines per request today
            <span class="w-[5ch] text-right font-mono text-[12.5px] text-highlighted tabular-nums">{{ linesPerRequest }}</span>
          </span>
          <USlider
            v-model="linesPerRequest"
            :min="2"
            :max="10"
            :step="1"
            size="xs"
            class="mt-3"
            :ui="slider"
            @update:model-value="tick"
          />
        </label>

        <label class="block">
          <span class="flex items-baseline justify-between gap-3 text-[13px] text-dimmed">
            Kept after sampling
            <span class="w-[5ch] text-right font-mono text-[12.5px] text-highlighted tabular-nums">{{ keepPercent }}%</span>
          </span>
          <USlider
            v-model="keepPercent"
            :min="1"
            :max="100"
            :step="1"
            size="xs"
            class="mt-3"
            :ui="slider"
            @update:model-value="tick"
          />
        </label>
      </div>

      <div class="mt-5 flex flex-wrap gap-x-6 gap-y-3">
        <label class="flex items-center gap-2.5 text-[13px] text-dimmed">
          $ per GB
          <UInputNumber
            v-model="perGb"
            :min="0"
            :step="0.01"
            size="xs"
            orientation="vertical"
            :ui="rate"
          />
        </label>
        <label class="flex items-center gap-2.5 text-[13px] text-dimmed">
          $ per million indexed
          <UInputNumber
            v-model="perMillionIndexed"
            :min="0"
            :step="0.01"
            size="xs"
            orientation="vertical"
            :ui="rate"
          />
        </label>
      </div>
    </div>

    <div class="border-t border-(--d-line) px-5 pt-4 pb-5 sm:px-6">
      <p class="text-[13px] text-dimmed">
        Saved a month
      </p>
      <p class="mt-1 flex h-9 items-baseline gap-3 overflow-hidden whitespace-nowrap">
        <span class="font-mono text-[28px]/9 text-highlighted tabular-nums">
          <NumberFlow :value="estimate.saved" :format="money" />
        </span>
        <span class="ml-auto w-[9ch] shrink-0 text-right font-mono text-[13px] text-(--d-signal-text) tabular-nums">
          <NumberFlow :value="estimate.savedRatio" :format="percent" /> less
        </span>
      </p>
      <div class="mt-3 flex h-[3px] overflow-hidden rounded-full bg-(--d-line)">
        <div class="h-full bg-(--d-signal) transition-[width] duration-500 ease-(--d-ease)" :style="{ width: savedWidth }" />
      </div>

      <div class="mt-5 grid grid-cols-2 gap-x-6">
        <div v-for="side in (['before', 'after'] as const)" :key="side" class="min-w-0">
          <p class="truncate text-[13px] text-dimmed">
            {{ side === 'before' ? `${linesPerRequest} lines per request` : 'evlog, 1 event' }}
          </p>
          <p class="mt-1 truncate font-mono text-[18px]/7 tabular-nums" :class="side === 'after' ? 'text-highlighted' : 'text-muted'">
            <NumberFlow :value="estimate[side].cost" :format="money" />
          </p>
          <dl class="mt-2 font-mono text-[12.5px]/5 tabular-nums">
            <div class="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-3">
              <dt class="text-dimmed">
                events
              </dt>
              <dd class="truncate text-default">
                <NumberFlow :value="estimate[side].events" :format="compact" />
              </dd>
            </div>
            <div class="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-3">
              <dt class="text-dimmed">
                data
              </dt>
              <dd class="truncate text-default">
                <NumberFlow :value="estimate[side].gb" :format="compact" suffix=" GB" />
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>

    <div class="space-y-2 border-t border-(--d-line) px-5 pt-4 pb-5 text-[13px]/5 text-pretty text-dimmed sm:px-6">
      <p>
        Byte counts come from serializing the checkout request below through pino 10 and evlog:
        4 lines totalling 736 B against 1 event of 322 B, so {{ PINO_LINE_BYTES }} B per line and
        {{ EVLOG_EVENT_BYTES }} B per event. Your fields differ, so treat the shape as the method, not the answer.
      </p>
      <p class="d-stack">
        <span
          v-for="p in LOG_COST_PROVIDERS"
          :key="p.id"
          class="d-xfade"
          :data-on="provider.id === p.id"
          :aria-hidden="provider.id !== p.id"
        >
          List rates read on {{ PRICES_READ_ON }} ({{ p.name }}: {{ p.note }}). Vendors change pricing without notice,
          which is why every rate here is editable. Free tiers, committed-use discounts and retention add-ons are not
          modelled. Sampling is applied to both columns: it lowers each bill and leaves the ratio between them alone.
        </span>
      </p>
    </div>
  </DocsFigure>
</template>
