<script setup lang="ts">
interface Row {
  method: string
  path: string
  /** The audit action, for requests that called `log.audit()`. */
  audit?: string
  /** Survives the 10% draw. */
  drawn?: boolean
}

const rows: Row[] = [
  { method: 'POST', path: '/api/checkout' },
  { method: 'GET', path: '/api/users' },
  { method: 'POST', path: '/api/invoices/refund', audit: 'invoice.refund' },
  { method: 'GET', path: '/api/me', drawn: true },
  { method: 'POST', path: '/api/login', audit: 'user.login' },
  { method: 'PATCH', path: '/api/cart' },
  { method: 'DELETE', path: '/api/account', audit: 'account.delete' },
  { method: 'GET', path: '/api/health' },
]

const shown = ref(0)
const decided = ref(0)

const ROW = 380

const { root, finished, still, replay } = useFigure({
  steps: rows.flatMap((_, i) => [
    { at: 200 + i * ROW, run: () => {
      shown.value = i + 1
    } },
    { at: 200 + i * ROW + 240, run: () => {
      decided.value = i + 1
    } },
  ]),
  reset: () => {
    shown.value = 0
    decided.value = 0
  },
  settle: () => {
    shown.value = rows.length
    decided.value = rows.length
  },
})

function kept(row: Row) {
  return Boolean(row.audit || row.drawn)
}

const auditKept = computed(() => rows.slice(0, decided.value).filter(row => row.audit).length)
const othersKept = computed(() => rows.slice(0, decided.value).filter(row => !row.audit && row.drawn).length)
</script>

<template>
  <DocsFigure
    ref="root"
    caption="Eight requests sampled at 10%. The three that called log.audit() are kept every time; the others take their chance."
    :finished
    :still
    @replay="replay"
  >
    <ul class="flex flex-col px-5 pt-4 sm:px-6">
      <li
        v-for="(row, i) in rows"
        :key="row.path"
        class="d-step grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-(--d-line) py-2.5"
        :data-on="shown > i"
        :style="{ opacity: decided > i && !kept(row) ? 0.4 : undefined }"
      >
        <span class="flex min-w-0 items-baseline gap-2 font-mono text-[12.5px]">
          <span class="w-12 shrink-0 text-dimmed">{{ row.method }}</span>
          <span class="truncate text-default">{{ row.path }}</span>
          <span
            v-if="row.audit"
            class="hidden shrink-0 rounded-(--d-r-sm) px-1.5 text-[11.5px] text-(--d-signal-text) ring-1 ring-[color-mix(in_srgb,var(--d-signal)_40%,transparent)] ring-inset sm:inline"
          >audit {{ row.audit }}</span>
        </span>

        <span class="d-step inline-flex items-center gap-2 text-[13px]" :data-on="decided > i">
          <span class="size-[5px] rounded-full" :class="kept(row) ? 'bg-(--d-signal)' : 'bg-(--d-line-strong)'" />
          <span :class="kept(row) ? 'text-highlighted' : 'text-dimmed'">
            {{ row.audit ? 'Kept, audit' : row.drawn ? 'Kept by the draw' : 'Dropped' }}
          </span>
        </span>
      </li>
    </ul>

    <p class="flex flex-wrap gap-x-6 gap-y-1 px-5 pt-3.5 pb-4 text-[13px] text-dimmed tabular-nums sm:px-6">
      <span><span class="text-highlighted">{{ auditKept }} of 3</span> audit events kept</span>
      <span><span class="text-default">{{ othersKept }} of 5</span> others kept</span>
    </p>
  </DocsFigure>
</template>
