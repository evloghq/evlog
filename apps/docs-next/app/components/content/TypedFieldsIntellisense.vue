<script setup lang="ts">
interface Call {
  key: string
  /** The value after the key, already split into code tokens. */
  value: { text: string, tone?: 'string' | 'number' }[]
  ok: boolean
}

const calls: Call[] = [
  { key: 'user', value: [{ text: '{ id: ' }, { text: '\'123\'', tone: 'string' }, { text: ', plan: ' }, { text: '\'pro\'', tone: 'string' }, { text: ' }' }], ok: true },
  { key: 'cart', value: [{ text: '{ items: ' }, { text: '3', tone: 'number' }, { text: ', total: ' }, { text: '9999', tone: 'number' }, { text: ' }' }], ok: true },
  { key: 'account', value: [{ text: '\'123\'', tone: 'string' }], ok: false },
]

const TONES = { string: 'text-[#00ca52]', number: 'text-(--d-out-key)' }

const typed = ref(0)
const checked = ref(0)

const CALL = 700

const { root, finished, still, playing, duration, replay } = useFigure({
  steps: calls.flatMap((_, i) => [
    { at: 300 + i * CALL, run: () => {
      typed.value = i + 1
    } },
    { at: 300 + i * CALL + 350, run: () => {
      checked.value = i + 1
    } },
  ]),
  reset: () => {
    typed.value = 0
    checked.value = 0
  },
  settle: () => {
    typed.value = calls.length
    checked.value = calls.length
  },
})

const failed = computed(() => checked.value >= calls.length)
</script>

<template>
  <DocsFigure
    ref="root"
    caption="A logger typed with CheckoutFields. The fields of the interface type-check; a key it does not declare fails at compile time, before the event exists."
    :finished
    :still
    :playing
    :duration
    @replay="replay"
  >
    <div class="overflow-x-auto overflow-y-hidden px-5 pt-5 pb-4 sm:px-6">
      <div class="min-w-[30rem] font-mono text-[12.5px]/6 whitespace-nowrap text-default">
        <div><span class="text-[#ff518d]">interface</span> <span class="text-[#c472fb]">CheckoutFields</span> {</div>
        <div class="pl-[2ch]">
          user<span class="text-[#c472fb]">: { id: string; plan: string }</span>
        </div>
        <div class="pl-[2ch]">
          cart<span class="text-[#c472fb]">: { items: number; total: number }</span>
        </div>
        <div class="pl-[2ch]">
          action<span class="text-[#c472fb]">: string</span>
        </div>
        <div>}</div>
        <div class="mt-6">
          <span class="text-[#ff518d]">const</span> log = <span class="text-[#c472fb]">useLogger</span>&lt;<span class="text-[#c472fb]">CheckoutFields</span>&gt;(event)
        </div>
        <div
          v-for="(call, i) in calls"
          :key="call.key"
          class="d-step grid grid-cols-[minmax(0,1fr)_auto] items-center gap-6"
          :data-on="typed > i"
        >
          <span>log.<span class="text-[#c472fb]">set</span>({ <span
            class="decoration-(--d-out-error) decoration-wavy underline-offset-4 transition-[text-decoration-color] duration-300"
            :class="!call.ok ? 'underline' : ''"
            :style="{ textDecorationColor: !call.ok && checked > i ? undefined : 'transparent' }"
          >{{ call.key }}</span>: <span v-for="(token, j) in call.value" :key="j" :class="token.tone ? TONES[token.tone] : ''">{{ token.text }}</span> })</span>
          <span
            class="d-step inline-flex items-center gap-2 font-sans text-[13px]"
            :data-on="checked > i"
          >
            <span class="size-[5px] rounded-full" :class="call.ok ? 'bg-(--d-line-strong)' : 'bg-(--d-out-error)'" />
            <span :class="call.ok ? 'text-dimmed' : 'text-highlighted'">{{ call.ok ? 'Type-checks' : 'Error' }}</span>
          </span>
        </div>
      </div>
    </div>

    <p
      class="d-step border-t border-(--d-line) px-5 pt-3.5 pb-4 font-mono text-[12px]/5 text-muted sm:px-6"
      :data-on="failed"
    >
      <span class="text-(--d-out-error)">TS2353</span> Object literal may only specify known properties, and <span class="text-default">'account'</span> does not exist in type <span class="text-default">CheckoutFields</span>.
    </p>
  </DocsFigure>
</template>
