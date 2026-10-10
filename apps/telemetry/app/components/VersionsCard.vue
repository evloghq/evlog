<script setup lang="ts">
import type { BreakdownBarItem } from './BreakdownBars.vue'

const props = defineProps<{
  nodeVersions: VersionCount[]
  toolVersions: VersionCount[]
  os: OsCount[]
}>()

const MAX_ROWS = 4

const nodeItems = computed<BreakdownBarItem[]>(() => props.nodeVersions.slice(0, MAX_ROWS).map(v => ({
  key: v.version,
  label: `Node ${v.version}`,
  icon: 'i-simple-icons-nodedotjs',
  count: v.count,
})))

const toolItems = computed<BreakdownBarItem[]>(() => props.toolVersions.slice(0, MAX_ROWS).map(v => ({
  key: v.version,
  label: `v${v.version.replace(/^v/, '')}`,
  icon: 'i-nucleo-box',
  count: v.count,
})))

const osItems = computed<BreakdownBarItem[]>(() => props.os.slice(0, MAX_ROWS).map(o => ({
  key: o.os ?? '__unknown__',
  label: osLabel(o.os),
  icon: osIcon(o.os),
  count: o.count,
})))

const sections = computed(() => [
  { title: 'Runtime', items: nodeItems.value },
  { title: 'Tool version', items: toolItems.value },
  { title: 'Platform', items: osItems.value },
])

const empty = computed(() => sections.value.every(s => s.items.length === 0))
</script>

<template>
  <PanelCard title="Versions & platforms" subtitle="What your tools run on" flush>
    <EmptyState
      v-if="empty"
      message="No runs in this range."
      hint="Widen the time range, or clear a filter."
    />

    <!-- Bottom spacing comes from PanelCard's flush body, not from here. -->
    <div v-else class="flex flex-col gap-3">
      <div v-for="section in sections" :key="section.title" class="flex flex-col gap-1">
        <p class="px-4 text-[11px] text-dimmed">
          {{ section.title }}
        </p>
        <BreakdownBars v-if="section.items.length > 0" :items="section.items" />
      </div>
    </div>
  </PanelCard>
</template>
