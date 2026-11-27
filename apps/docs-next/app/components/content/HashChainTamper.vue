<script setup lang="ts">
interface Row {
  action: string
  outcome: string
  /** The value someone writes over `outcome` in the store. */
  edited?: string
  prevHash: string
  hash: string
}

const rows: Row[] = [
  { action: 'invoice.refund', outcome: 'success', prevHash: 'null', hash: '3f2c8e1a' },
  { action: 'user.update', outcome: 'denied', edited: 'success', prevHash: '3f2c8e1a', hash: '9a1b4d7c' },
  { action: 'apiKey.revoke', outcome: 'success', prevHash: '9a1b4d7c', hash: 'c4e7f2b9' },
]

const EDITED = rows.findIndex(row => row.edited)

const shown = ref(0)
const edited = ref(false)
const checked = ref(0)

const ROW = 360
const EDIT_AT = 200 + rows.length * ROW + 500
const CHECK_AT = EDIT_AT + 1100
const CHECK = 600

const { root, finished, still, playing, duration, replay } = useFigure({
  steps: [
    ...rows.map((_, i) => ({ at: 200 + i * ROW, run: () => {
      shown.value = i + 1
    } })),
    { at: EDIT_AT, run: () => {
      edited.value = true
    } },
    ...rows.map((_, i) => ({ at: CHECK_AT + i * CHECK, run: () => {
      checked.value = i + 1
    } })),
  ],
  reset: () => {
    shown.value = 0
    edited.value = false
    checked.value = 0
  },
  settle: () => {
    shown.value = rows.length
    edited.value = true
    checked.value = rows.length
  },
})

function verdict(i: number) {
  if (i < EDITED) return 'Hash matches'
  if (i === EDITED) return 'Hash mismatch'
  return 'Chain broken'
}

const done = computed(() => checked.value >= rows.length)
</script>

<template>
  <DocsFigure
    ref="root"
    caption="A hash-chained audit trail. One outcome is rewritten in the store; verifying the chain finds that row, and every row after it fails with it."
    :finished
    :still
    :playing
    :duration
    @replay="replay"
  >
    <div class="overflow-x-auto overflow-y-hidden">
      <table class="w-full sm:min-w-[38rem] border-collapse text-left font-mono text-[12.5px]/5">
        <thead>
          <tr class="text-[13px] text-dimmed [&>th]:px-4 [&>th]:pt-5 sm:[&>th]:px-5 [&>th]:pb-3 [&>th]:font-sans [&>th]:font-normal">
            <th>Action</th>
            <th class="sm:w-[7rem]">
              Outcome
            </th>
            <th class="hidden w-[12.5rem] sm:table-cell">
              prevHash → hash
            </th>
            <th class="sm:w-[9.5rem]">
              Verify
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, i) in rows"
            :key="row.hash"
            class="d-step border-t border-(--d-line) [&>td]:px-4 [&>td]:py-2.5 sm:[&>td]:px-5"
            :data-on="shown > i"
          >
            <td class="whitespace-nowrap text-default">
              {{ row.action }}
              <span class="block text-[12px] text-dimmed sm:hidden">{{ row.hash }}</span>
            </td>
            <td class="whitespace-nowrap">
              <span class="d-stack">
                <span class="d-xfade text-default" :data-on="!(row.edited && edited)">{{ row.outcome }}</span>
                <span v-if="row.edited" class="d-xfade text-(--d-warn)" :data-on="edited">{{ row.edited }}</span>
              </span>
            </td>
            <td class="hidden whitespace-nowrap text-dimmed sm:table-cell">
              {{ row.prevHash }} → <span class="text-default">{{ row.hash }}</span>
            </td>
            <td class="font-sans text-[13px] whitespace-nowrap">
              <span class="d-step inline-flex items-center gap-2" :data-on="checked > i">
                <span class="size-[5px] rounded-full" :class="i < EDITED ? 'bg-(--d-signal)' : 'bg-(--d-warn)'" />
                <span :class="i < EDITED ? 'text-highlighted' : 'text-(--d-warn)'">{{ verdict(i) }}</span>
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="d-stack border-t border-(--d-line) px-4 pt-3.5 pb-4 text-[13px] text-dimmed sm:px-5">
      <p class="d-xfade" :data-on="!edited">
        Each hash covers the event and the hash before it.
      </p>
      <p class="d-xfade" :data-on="edited && !done">
        Row 2 edited in the store: <span class="text-(--d-warn)">denied</span> is now <span class="text-(--d-warn)">success</span>.
      </p>
      <p class="d-xfade" :data-on="done">
        <span class="text-highlighted">Tampering found at row 2</span>, rows 2 and 3 fail verification.
      </p>
    </div>
  </DocsFigure>
</template>
