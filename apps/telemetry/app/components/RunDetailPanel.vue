<script setup lang="ts">
const props = defineProps<{
  run: RunDetail | null
  loading: boolean
}>()

const flagEntries = computed(() => props.run ? Object.entries(props.run.flags) : [])

/**
 * Custom fields bucketed by the command that reports them, keys sorted.
 *
 * One `map` run reports nearly forty counters, and as a single unordered wrap
 * of chips it is something you scan rather than read — `mapFailAudit` and
 * `mapSuppressedAudit` end up rows apart. Grouping plus an alphabetical sort
 * puts each rule's pair next to itself.
 */
const customGroups = computed(() => {
  if (!props.run) return []

  const entries = Object.entries(props.run.custom)
    .map(([key, value]) => ({ key, value, count: 0 }))
    .sort((a, b) => a.key.localeCompare(b.key))

  return groupFieldStats(entries)
})

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })
}

function formatFieldValue(value: boolean | number | string) {
  return typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value)
}
</script>

<template>
  <div v-if="loading" class="flex justify-center py-16">
    <UIcon name="i-nucleo-loader" class="size-4 animate-spin text-dimmed" />
  </div>

  <div v-else-if="!run" class="py-16 text-center text-[13px] text-muted">
    Run not found.
  </div>

  <div v-else class="flex flex-col">
    <!-- The headline plane: outcome, duration and command, on a raised surface
         so the two facts you came for sit visibly above the reference data. -->
    <div class="divider-y px-5 py-4">
      <div class="surface-raised flex flex-wrap items-center gap-3 rounded-[--radius-lg] bg-elevated px-3 py-2.5">
        <span
          class="inline-flex items-center gap-1.5 rounded-[--radius-sm] px-1.5 py-0.5 text-[11px] font-medium"
          :class="run.outcome === 'success' ? 'bg-success/10 text-success' : 'bg-error/10 text-error'"
        >
          <span class="size-1.5 rounded-full" :class="run.outcome === 'success' ? 'bg-success' : 'bg-error'" />
          {{ run.outcome }}
        </span>
        <span v-if="run.errorCode" class="font-mono text-[11px] text-error">{{ run.errorCode }}</span>

        <span aria-hidden="true" class="h-4 w-px bg-accented" />

        <span class="text-[15px] font-medium text-highlighted tabular-nums">{{ formatDuration(run.durationMs) }}</span>

        <span class="ml-auto max-w-[55%] truncate font-mono text-[11px] text-dimmed">{{ run.command }}</span>
      </div>
    </div>

    <RunDetailSection title="Overview">
      <dl class="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <RunDetailField label="Tool">
          {{ run.tool }} <span class="text-dimmed">@{{ run.version }}</span>
        </RunDetailField>
        <RunDetailField label="Environment">
          {{ run.environment }}
        </RunDetailField>
        <RunDetailField label="Machine" mono>
          {{ run.machineId ?? '—' }}
        </RunDetailField>
      </dl>

      <div class="mt-3 flex flex-col gap-1 text-[11px] text-dimmed">
        <span>Occurred {{ formatDateTime(run.timestamp) }}</span>
        <span>Received {{ formatDateTime(run.receivedAt) }}</span>
      </div>
    </RunDetailSection>

    <RunDetailSection title="Environment">
      <dl class="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <RunDetailField label="Node" mono>
          {{ run.env.node }}
        </RunDetailField>
        <RunDetailField label="CI">
          {{ run.env.ci ? 'yes' : 'no' }}
        </RunDetailField>
        <RunDetailField label="Provider">
          {{ run.env.provider ?? '—' }}
        </RunDetailField>
        <RunDetailField label="TTY">
          {{ run.env.tty ? 'yes' : 'no' }}
        </RunDetailField>
        <RunDetailField label="Agent">
          {{ run.env.agent ?? '—' }}
        </RunDetailField>
        <RunDetailField label="OS">
          <span class="flex items-center gap-1.5">
            <UIcon v-if="run.env.os" :name="osIcon(run.env.os)" class="size-3 text-dimmed" />
            {{ run.env.os ? osLabel(run.env.os) : '—' }}
          </span>
        </RunDetailField>
        <RunDetailField label="Arch" mono>
          {{ run.env.arch ?? '—' }}
        </RunDetailField>
      </dl>
    </RunDetailSection>

    <RunDetailSection title="Flags">
      <p v-if="flagEntries.length === 0" class="text-[13px] text-dimmed">
        None passed.
      </p>
      <!--
        The command line is one mono run rather than key/value chips: this is the thing the user
        typed, and splitting `--min-score` from `90` turns a command back into a config object.
      -->
      <div v-else class="flex flex-wrap gap-1.5">
        <span
          v-for="[key, value] in flagEntries"
          :key
          class="surface-raised inline-flex items-center rounded-[--radius-sm] bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-toned"
          :class="isValueSet(value) ? 'text-dimmed' : ''"
          :title="isValueSet(value) ? 'A value was passed. Its content is not collected.' : undefined"
        >{{ flagLabel(key, value) }}</span>
      </div>
    </RunDetailSection>

    <RunDetailSection title="Custom fields">
      <p v-if="customGroups.length === 0" class="text-[13px] text-dimmed">
        None reported.
      </p>
      <div v-else class="flex flex-col gap-3">
        <div v-for="section in customGroups" :key="section.group" class="flex flex-col gap-1.5">
          <span class="font-mono text-[10px] uppercase tracking-wide text-dimmed">
            {{ section.group }} <span class="tabular-nums">{{ section.fields.length }}</span>
          </span>
          <div class="flex flex-wrap gap-1.5">
            <KeyValueChip
              v-for="field in section.fields"
              :key="field.key"
              :label="field.key"
              :value="formatFieldValue(field.value)"
            />
          </div>
        </div>
      </div>
    </RunDetailSection>

    <RunDetailSection title="Idempotency key" :divided="false">
      <code class="block break-all rounded-[--radius-sm] bg-elevated/60 px-2 py-1.5 font-mono text-[11px] text-dimmed">{{ run.idempotencyKey }}</code>
    </RunDetailSection>
  </div>
</template>
