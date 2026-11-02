<script setup lang="ts">
const { versions, current, items } = useDocsVersions()
</script>

<template>
  <UDropdownMenu
    v-if="versions.length > 1"
    :items
    :content="{ align: 'start', sideOffset: 6 }"
    :ui="{ content: 'min-w-32 bg-default ring-white/10', item: 'text-[13px]' }"
  >
    <button
      type="button"
      aria-label="Switch documentation version"
      class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[12px] text-dimmed transition-colors hover:bg-white/5 hover:text-highlighted"
    >
      {{ current?.label ?? 'versions' }}
      <UIcon name="i-lucide-chevrons-up-down" class="size-3" />
    </button>
  </UDropdownMenu>
</template>
