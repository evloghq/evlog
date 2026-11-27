<script setup lang="ts">
const fields = [
  { key: 'message', value: 'Payment failed' },
  { key: 'status', value: '402' },
  { key: 'code', value: 'PAYMENT_DECLINED' },
  { key: 'why', value: 'Card declined by issuer' },
  { key: 'fix', value: 'Try a different payment method' },
]

interface Branch {
  /** The case label; empty for `default`. */
  test: string
  call: string
  args: string
}

const branches: Branch[] = [
  { test: '\'PAYMENT_DECLINED\'', call: 'showRetryWithDifferentCard', args: '()' },
  { test: '\'CART_EXPIRED\'', call: 'rebuildCart', args: '()' },
  { test: '', call: 'toast.add', args: '({ title: error.message })' },
]

const parsed = ref(0)
const switched = ref(false)
const matched = ref(false)

const FIELD = 160
const SWITCH_AT = 200 + fields.length * FIELD + 400

const { root, finished, still, playing, duration, replay } = useFigure({
  steps: [
    ...fields.map((_, i) => ({ at: 200 + i * FIELD, run: () => {
      parsed.value = i + 1
    } })),
    { at: SWITCH_AT, run: () => {
      switched.value = true
    } },
    { at: SWITCH_AT + 700, run: () => {
      matched.value = true
    } },
  ],
  reset: () => {
    parsed.value = 0
    switched.value = false
    matched.value = false
  },
  settle: () => {
    parsed.value = fields.length
    switched.value = true
    matched.value = true
  },
})

function branchOpacity(i: number) {
  if (matched.value) return i === 0 ? 1 : 0.4
  return switched.value ? 1 : 0.5
}
</script>

<template>
  <DocsFigure
    ref="root"
    caption="parseError() returns the fields the server threw. The client switches on code, which stays the same when the message is reworded, and runs the matching branch."
    :finished
    :still
    :playing
    :duration
    @replay="replay"
  >
    <div class="grid grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div class="border-b border-(--d-line) p-5 md:border-r md:border-b-0">
        <p class="mb-4 text-[13px] text-dimmed">
          parseError(err)
        </p>
        <ul class="flex flex-col font-mono text-[12px]/5">
          <li
            v-for="(field, i) in fields"
            :key="field.key"
            class="d-step flex h-7 min-w-0 items-center"
            :data-on="parsed > i"
          >
            <span class="w-[9ch] shrink-0 text-muted">{{ field.key }}:</span>
            <span
              class="truncate transition-colors duration-300"
              :class="field.key === 'code' && switched ? 'text-(--d-signal-text)' : 'text-default'"
            >{{ field.value }}</span>
          </li>
        </ul>
      </div>

      <div class="p-5">
        <p class="mb-4 text-[13px] text-dimmed">
          useCheckout.ts
        </p>
        <div class="overflow-x-auto overflow-y-hidden font-mono text-[12px]/7 whitespace-nowrap text-default">
          <div class="w-max min-w-full">
            <div class="transition-opacity duration-300" :style="{ opacity: switched ? 1 : 0.5 }">
              <span class="text-[#ff518d]">switch</span> (error.<span class="transition-colors duration-300" :class="switched ? 'text-(--d-signal-text)' : ''">code</span>) {
            </div>
            <div
              v-for="(branch, i) in branches"
              :key="branch.call"
              class="rounded-(--d-r-sm) transition-[background-color,opacity] duration-300"
              :class="matched && i === 0 ? 'bg-(--d-raised-strong)' : ''"
              :style="{ opacity: branchOpacity(i) }"
            >
              <div class="pl-[2ch]">
                <template v-if="branch.test">
                  <span class="text-[#ff518d]">case</span> <span class="text-[#00ca52]">{{ branch.test }}</span>:
                </template>
                <template v-else>
                  <span class="text-[#ff518d]">default</span>:
                </template>
              </div>
              <div class="pl-[4ch]">
                <span class="text-[#ff518d]">return</span> <span class="text-[#c472fb]">{{ branch.call }}</span>{{ branch.args }}
              </div>
            </div>
            <div class="transition-opacity duration-300" :style="{ opacity: switched ? 1 : 0.5 }">
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  </DocsFigure>
</template>
