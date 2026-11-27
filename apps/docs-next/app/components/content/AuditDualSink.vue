<script setup lang="ts">
interface Row {
  method: string
  path: string
  /** The audit action, for requests that called `log.audit()`. */
  audit?: string
  /** The chain hash the signed drain writes for an audit event. */
  hash?: string
}

const rows: Row[] = [
  { method: 'POST', path: '/api/checkout' },
  { method: 'POST', path: '/api/refund', audit: 'invoice.refund', hash: '3f2c8e1a' },
  { method: 'GET', path: '/api/me' },
  { method: 'DELETE', path: '/api/account', audit: 'user.delete', hash: '9a1b4d7c' },
  { method: 'PATCH', path: '/api/cart' },
]

const shown = ref(0)
const written = ref(0)
const sorted = ref(0)

const ROW = 520

const { root, finished, still, playing, duration, replay } = useFigure({
  steps: rows.flatMap((_, i) => [
    { at: 200 + i * ROW, run: () => {
      shown.value = i + 1
    } },
    { at: 200 + i * ROW + 200, run: () => {
      written.value = i + 1
    } },
    { at: 200 + i * ROW + 360, run: () => {
      sorted.value = i + 1
    } },
  ]),
  reset: () => {
    shown.value = 0
    written.value = 0
    sorted.value = 0
  },
  settle: () => {
    shown.value = rows.length
    written.value = rows.length
    sorted.value = rows.length
  },
})

const mainCount = computed(() => written.value)
const auditCount = computed(() => rows.slice(0, sorted.value).filter(row => row.audit).length)
</script>

<template>
  <DocsFigure
    ref="root"
    caption="Five requests, two drains. The main drain receives every event; auditOnly() forwards only the two with an audit field to the signed drain, which chains each to the one before."
    :finished
    :still
    :playing
    :duration
    @replay="replay"
  >
    <div class="overflow-x-auto overflow-y-hidden">
      <table class="w-full sm:min-w-[36rem] border-collapse text-left font-mono text-[12.5px]/5">
        <thead>
          <tr class="align-bottom font-sans text-[13px] text-dimmed [&>th]:px-4 [&>th]:pt-5 [&>th]:pb-3 [&>th]:font-normal sm:[&>th]:px-5">
            <th>Event</th>
            <th class="sm:w-[10rem]">
              Main drain
              <span class="hidden font-mono text-[12px] text-muted sm:block">createAxiomDrain()</span>
            </th>
            <th class="sm:w-[13rem]">
              Audit drain
              <span class="hidden font-mono text-[12px] text-muted sm:block">auditOnly(signed(fs))</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, i) in rows"
            :key="row.path"
            class="d-step border-t border-(--d-line) [&>td]:px-4 [&>td]:py-2.5 sm:[&>td]:px-5"
            :data-on="shown > i"
          >
            <td class="whitespace-nowrap">
              <span class="hidden w-14 text-dimmed sm:inline-block">{{ row.method }}</span>
              <span class="text-default">{{ row.path }}</span>
              <span
                v-if="row.audit"
                class="ml-2 hidden rounded-(--d-r-sm) px-1.5 text-[11.5px] text-(--d-signal-text) ring-1 ring-[color-mix(in_srgb,var(--d-signal)_40%,transparent)] ring-inset sm:inline"
              >audit</span>
            </td>
            <td class="font-sans text-[13px] whitespace-nowrap">
              <span class="d-step inline-flex items-center gap-2" :data-on="written > i">
                <span class="size-[5px] rounded-full bg-(--ui-text-dimmed)" />
                <span class="text-default">Written</span>
              </span>
            </td>
            <td class="whitespace-nowrap">
              <span class="d-step inline-flex items-center gap-2" :data-on="sorted > i">
                <span class="size-[5px] rounded-full" :class="row.audit ? 'bg-(--d-signal)' : 'bg-(--d-line-strong)'" />
                <span v-if="row.hash" class="font-sans text-[13px] text-highlighted">Signed</span>
                <span v-if="row.hash" class="hidden text-dimmed sm:inline">{{ row.hash }}</span>
                <span v-else class="font-sans text-[13px] text-dimmed">Skipped</span>
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="flex flex-wrap gap-x-6 gap-y-1 border-t border-(--d-line) px-4 pt-3.5 pb-4 text-[13px] text-dimmed tabular-nums sm:px-5">
      <span><span class="text-default">{{ mainCount }} of 5</span> in the main drain</span>
      <span><span class="text-highlighted">{{ auditCount }} of 5</span> in the audit drain, chained</span>
    </p>
  </DocsFigure>
</template>
