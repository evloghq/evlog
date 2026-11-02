<script setup lang="ts">
interface Field {
  key: string
  raw: string
  masked?: string
  /** The built-in that matched: a value pattern, or `secrets` for a key ending in password, secret or token. */
  rule?: string
}

const fields: Field[] = [
  { key: 'user.id', raw: '42' },
  { key: 'user.email', raw: 'alice@example.com', masked: 'a***@***.com', rule: 'email' },
  { key: 'user.phone', raw: '+33 6 12 34 56 78', masked: '+33 ****5678', rule: 'phone' },
  { key: 'user.ip', raw: '192.168.1.42', masked: '***.***.***.42', rule: 'ipv4' },
  { key: 'payment.card', raw: '4111111111111111', masked: '****1111', rule: 'creditCard' },
  { key: 'headers.authorization', raw: 'Bearer sk_live_abc123def', masked: 'Bearer ***', rule: 'bearer' },
  { key: 'account.password', raw: 'hunter2-correct-horse', masked: '[REDACTED]', rule: 'secrets' },
  { key: 'cart.total', raw: '9999' },
]

const ROW_HEIGHT = 36
const ROW = 300

const scanned = ref(0)

const { root, finished, still, replay } = useFigure({
  steps: fields.map((_, i) => ({ at: 300 + i * ROW, run: () => {
    scanned.value = i + 1
  } })),
  reset: () => {
    scanned.value = 0
  },
  settle: () => {
    scanned.value = fields.length
  },
})

const scanning = computed(() => scanned.value > 0 && scanned.value < fields.length)
</script>

<template>
  <DocsFigure
    ref="root"
    caption="The event as a drain receives it in production. Values keep enough shape to debug; a key that names a secret loses its value entirely."
    :finished
    :still
    @replay="replay"
  >
    <div class="relative overflow-x-auto px-5 py-4 sm:px-6">
      <span
        aria-hidden="true"
        class="pointer-events-none absolute inset-x-3 top-4 h-px rounded-full bg-(--d-signal) shadow-[0_0_12px_1px_color-mix(in_srgb,var(--d-signal)_70%,transparent)] transition-[transform,opacity] ease-(--d-ease-move)"
        :style="{
          transform: `translateY(${scanned * ROW_HEIGHT}px)`,
          opacity: scanning ? 1 : 0,
          transitionDuration: `${ROW}ms, 240ms`,
        }"
      />

      <dl class="min-w-[30rem] font-mono text-[12.5px]">
        <div
          v-for="(field, i) in fields"
          :key="field.key"
          class="grid grid-cols-[11rem_minmax(0,1fr)_5.5rem] items-center gap-4"
          :style="{ height: `${ROW_HEIGHT}px` }"
        >
          <dt class="truncate text-dimmed">
            {{ field.key }}
          </dt>
          <dd class="d-stack min-w-0">
            <span class="d-xfade truncate text-default" :data-on="!(field.masked && scanned > i)">{{ field.raw }}</span>
            <span v-if="field.masked" class="d-xfade truncate text-highlighted" :data-on="scanned > i">{{ field.masked }}</span>
          </dd>
          <dd
            class="text-right font-sans text-[12.5px] transition-opacity duration-300"
            :class="[scanned > i ? 'opacity-100' : 'opacity-0', field.rule ? 'text-(--d-signal-text)' : 'text-dimmed']"
          >
            {{ field.rule ?? 'unchanged' }}
          </dd>
        </div>
      </dl>
    </div>
  </DocsFigure>
</template>
