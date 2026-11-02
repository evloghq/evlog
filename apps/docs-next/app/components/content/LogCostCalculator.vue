<script setup lang="ts">
import NumberFlow from '@number-flow/vue'
import { Motion } from 'motion-v'
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
</script>

<template>
  <Motion
    :initial="false"
    :while-in-view="{ opacity: 1, y: 0 }"
    :transition="{ duration: 0.4 }"
    :in-view-options="{ once: true }"
    class="not-prose my-8"
    data-section="log-cost-calculator"
  >
    <div class="overflow-hidden rounded-lg border border-muted bg-default">
      <div class="flex items-center gap-2 border-b border-muted px-4 py-2">
        <span class="font-mono text-[10px] uppercase tracking-widest text-dimmed">Monthly log bill</span>
        <button
          type="button"
          class="ml-auto text-dimmed transition-colors hover:text-default"
          :aria-pressed="sound"
          :aria-label="sound ? 'Mute interaction sound' : 'Unmute interaction sound'"
          @click="sound = !sound; tick()"
        >
          <UIcon :name="sound ? 'i-lucide-volume-2' : 'i-lucide-volume-off'" class="size-3.5" />
        </button>
      </div>

      <div class="space-y-3 border-b border-muted px-4 py-3">
        <div class="flex flex-wrap gap-1">
          <UButton
            v-for="p in LOG_COST_PROVIDERS"
            :key="p.id"
            :icon="p.icon"
            :label="p.name"
            size="xs"
            :color="provider.id === p.id ? 'primary' : 'neutral'"
            :variant="provider.id === p.id ? 'subtle' : 'ghost'"
            :ui="{ label: 'font-mono text-[10px]' }"
            @click="selectProvider(p)"
          />
        </div>

        <div class="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          <div>
            <p class="flex items-baseline justify-between font-mono text-[9px] uppercase tracking-widest text-dimmed">
              Requests / month
              <span class="text-[11px] normal-case tracking-normal text-highlighted tabular-nums">
                <NumberFlow :value="requests" :format="compact" />
              </span>
            </p>
            <USlider
              v-model="requestStep"
              :min="0"
              :max="REQUEST_STEPS.length - 1"
              :step="1"
              size="xs"
              class="mt-2"
              :ui="{ track: 'bg-elevated' }"
              @update:model-value="tick"
            />
          </div>

          <div>
            <p class="flex items-baseline justify-between font-mono text-[9px] uppercase tracking-widest text-dimmed">
              Log lines per request, today
              <span class="text-[11px] normal-case tracking-normal text-highlighted tabular-nums">{{ linesPerRequest }}</span>
            </p>
            <USlider
              v-model="linesPerRequest"
              :min="2"
              :max="10"
              :step="1"
              size="xs"
              class="mt-2"
              :ui="{ track: 'bg-elevated' }"
              @update:model-value="tick"
            />
          </div>
        </div>

        <div>
          <p class="flex items-baseline justify-between font-mono text-[9px] uppercase tracking-widest text-dimmed">
            Sampling, kept on both sides
            <span class="text-[11px] normal-case tracking-normal text-highlighted tabular-nums">{{ keepPercent }}%</span>
          </p>
          <USlider
            v-model="keepPercent"
            :min="1"
            :max="100"
            :step="1"
            size="xs"
            class="mt-2"
            :ui="{ track: 'bg-elevated' }"
            @update:model-value="tick"
          />
        </div>

        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div class="flex items-center gap-1.5">
            <span class="font-mono text-[9px] uppercase tracking-widest text-dimmed">$ / GB</span>
            <UInputNumber
              v-model="perGb"
              :min="0"
              :step="0.01"
              size="xs"
              orientation="vertical"
              :ui="{ base: 'w-20 font-mono text-[11px] tabular-nums' }"
            />
          </div>
          <div class="flex items-center gap-1.5">
            <span class="font-mono text-[9px] uppercase tracking-widest text-dimmed">$ / M indexed</span>
            <UInputNumber
              v-model="perMillionIndexed"
              :min="0"
              :step="0.01"
              size="xs"
              orientation="vertical"
              :ui="{ base: 'w-20 font-mono text-[11px] tabular-nums' }"
            />
          </div>
        </div>
      </div>

      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-muted bg-emerald-500/6 px-4 py-2.5">
        <span class="font-mono text-[9px] uppercase tracking-widest text-emerald-500/70">You save</span>
        <span class="font-mono text-[26px] leading-none text-emerald-400 tabular-nums">
          <NumberFlow :value="estimate.saved" :format="money" />
        </span>
        <span class="font-mono text-[10px] text-muted">
          a month, <span class="text-emerald-400"><NumberFlow :value="estimate.savedRatio" :format="percent" /> less</span>
          than {{ linesPerRequest }} lines per request
        </span>
        <div class="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-elevated">
          <div class="h-full bg-emerald-500/80 transition-[width] duration-500 ease-out" :style="{ width: savedWidth }" />
          <div class="h-full flex-1 bg-primary" />
        </div>
      </div>

      <div class="grid grid-cols-2 divide-x divide-muted border-b border-muted">
        <div class="space-y-2 px-4 py-3">
          <p class="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-widest text-dimmed">
            <UIcon name="i-lucide-layers" class="size-3" />
            {{ linesPerRequest }} lines / request
          </p>
          <p class="font-mono text-[20px] leading-none text-muted tabular-nums">
            <NumberFlow :value="estimate.before.cost" :format="money" />
          </p>
          <dl class="space-y-0.5 font-mono text-[10px] tabular-nums">
            <div class="flex justify-between">
              <dt class="text-dimmed">
                Events
              </dt>
              <dd class="text-muted">
                <NumberFlow :value="estimate.before.events" :format="compact" />
              </dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-dimmed">
                Data
              </dt>
              <dd class="text-muted">
                <NumberFlow :value="estimate.before.gb" :format="compact" suffix=" GB" />
              </dd>
            </div>
          </dl>
        </div>

        <div class="space-y-2 bg-primary/5 px-4 py-3">
          <p class="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-widest text-primary">
            <UIcon name="i-lucide-zap" class="size-3" />
            evlog, 1 event
          </p>
          <p class="font-mono text-[20px] leading-none text-highlighted tabular-nums">
            <NumberFlow :value="estimate.after.cost" :format="money" />
          </p>
          <dl class="space-y-0.5 font-mono text-[10px] tabular-nums">
            <div class="flex justify-between">
              <dt class="text-dimmed">
                Events
              </dt>
              <dd class="text-highlighted">
                <NumberFlow :value="estimate.after.events" :format="compact" />
              </dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-dimmed">
                Data
              </dt>
              <dd class="text-highlighted">
                <NumberFlow :value="estimate.after.gb" :format="compact" suffix=" GB" />
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <div class="bg-elevated/30 px-4 py-2.5 font-mono text-[9px] leading-relaxed text-dimmed">
        <p>
          Byte counts measured by serializing the checkout request above through pino 10 and evlog:
          4 lines totalling 736 B against 1 event of 322 B, so {{ PINO_LINE_BYTES }} B per line and
          {{ EVLOG_EVENT_BYTES }} B per event. Your fields differ, so treat the shape as the method, not the answer.
        </p>
        <p class="mt-1">
          List rates read on {{ PRICES_READ_ON }} ({{ provider.name }}: {{ provider.note }}). Vendors change
          pricing without notice, which is why every rate here is editable. Free tiers, committed-use discounts
          and retention add-ons are not modelled. Sampling is applied to both columns, because any logger can
          drop events: it lowers each bill and leaves the ratio between them alone.
        </p>
      </div>
    </div>
  </Motion>
</template>
