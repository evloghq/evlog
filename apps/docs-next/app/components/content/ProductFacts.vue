<script setup lang="ts">
const props = defineProps<{
  /** Entry point the reader imports from, e.g. `evlog/axiom`. */
  entry?: string
  /** npm package, when it is not the entry point itself. */
  package?: string
  /** `stable`, `beta` or `early`: how much the API can still move. */
  status?: 'stable' | 'beta' | 'early'
  /** The CLI command, for products that are a command rather than an import. */
  command?: string
}>()

const STATUS = {
  stable: { label: 'Stable', title: 'The API follows semver', dot: 'bg-(--d-signal)' },
  beta: { label: 'Beta', title: 'The API can still change in a minor release', dot: 'bg-(--d-warn)' },
  early: { label: 'Early', title: 'Expect changes between releases', dot: 'bg-(--ui-text-dimmed)' },
} as const

const status = computed(() => props.status ? STATUS[props.status] : undefined)
const facts = computed(() => [
  props.command ? { label: 'Run', value: props.command } : undefined,
  props.entry ? { label: 'Import from', value: props.entry } : undefined,
  props.package && props.package !== props.entry ? { label: 'Package', value: props.package } : undefined,
].filter(Boolean) as { label: string, value: string }[])
</script>

<template>
  <div data-section="product-facts" class="not-prose mb-10 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
    <span v-if="status" class="inline-flex items-center gap-2 text-default" :title="status.title">
      <span class="size-[6px] rounded-full" :class="status.dot" />
      {{ status.label }}
    </span>
    <span v-for="fact in facts" :key="fact.label" class="inline-flex items-baseline gap-2">
      <span class="text-dimmed">{{ fact.label }}</span>
      <code class="font-mono text-[12.5px] text-highlighted">{{ fact.value }}</code>
    </span>
  </div>
</template>
