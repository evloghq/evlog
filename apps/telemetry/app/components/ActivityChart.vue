<script setup lang="ts">
import type { ActivityPlotPoint } from './ActivityTooltip.vue'

const props = defineProps<{
  timeline: ActivityPoint[]
  granularity: TimelineGranularity
  /** Runs per bucket one window earlier, aligned index-for-index with `timeline`. */
  previousRuns: number[]
}>()

/**
 * The successful mass is the accent, not green: it's the bulk of every bar,
 * and a full-saturation green across that much area shouts. Failures keep a
 * hue of their own, muted enough to read as serious rather than alarming.
 */
const SERIES: { key: 'success' | 'errors', name: string, color: string }[] = [
  { key: 'success', name: 'Success', color: 'var(--chart-success)' },
  { key: 'errors', name: 'Error', color: 'var(--chart-error)' },
]

const barCategories: Record<string, BulletLegendItemInterface> = Object.fromEntries(
  SERIES.map(s => [s.key, { name: s.name, color: s.color }]),
)

/** Same y-scale as the bars — it's the same unit, and a second scale would make the comparison a lie. */
const lineCategories: Record<string, BulletLegendItemInterface> = {
  previous: { name: 'Previous', color: 'var(--chart-neutral)' },
}

const data = computed<ActivityPlotPoint[]>(() => props.timeline.map((point, index) => ({
  label: formatBucket(point.bucket, props.granularity),
  success: point.success,
  errors: point.errors,
  previous: props.previousRuns[index] ?? 0,
})))

/**
 * A window with no prior data would plot a flat line along zero, which reads
 * as "there were no runs" rather than "we have nothing to compare against".
 * Drop the series entirely in that case.
 */
const hasPrevious = computed(() => props.previousRuns.some(count => count > 0))

const empty = computed(() => props.timeline.every(point => point.success + point.errors === 0))

/** Bars plot at numeric array indices and label ticks with those same indices
 * unless given an explicit formatter. Map the tick back to its bucket. */
function xFormatter(tick: number) {
  return data.value[Math.round(tick)]?.label ?? ''
}

const xNumTicks = computed(() => bucketTickCount(data.value.length))

/** What this chart plots, in order — its half of the shared-cursor contract. */
const labels = computed(() => data.value.map(point => point.label))
</script>

<template>
  <PanelCard
    :title="granularity === 'hour' ? 'Hourly activity' : 'Daily activity'"
    :subtitle="hasPrevious ? 'Runs by outcome, with the previous period behind' : 'Runs by outcome'"
    flush
  >
    <EmptyState
      v-if="empty"
      message="No runs in this range."
      hint="Widen the time range, or clear a filter."
    />

    <ChartFrame v-else legend :labels :height="216">
      <DualChart
        v-if="hasPrevious"
        :data
        :height="216"
        :bar-categories
        :line-categories
        :bar-y-axis="['success', 'errors']"
        :line-y-axis="['previous']"
        :stacked="true"
        :radius="3"
        :bar-padding="0.45"
        :line-width="1.5"
        :y-grid-line="true"
        :y-num-ticks="4"
        :x-formatter
        :x-num-ticks
        :legend-position="LegendPosition.TopRight"
      >
        <template #tooltip="{ values }">
          <ActivityTooltip :values="unwrapTooltipDatum(values)" :series="SERIES" :has-previous />
        </template>
      </DualChart>

      <BarChart
        v-else
        :data
        :height="216"
        :categories="barCategories"
        :y-axis="['success', 'errors']"
        :stacked="true"
        :radius="3"
        :bar-padding="0.45"
        :y-grid-line="true"
        :y-num-ticks="4"
        :x-formatter
        :x-num-ticks
        :legend-position="LegendPosition.TopRight"
      >
        <template #tooltip="{ values }">
          <ActivityTooltip :values :series="SERIES" :has-previous />
        </template>
      </BarChart>
    </ChartFrame>
  </PanelCard>
</template>
