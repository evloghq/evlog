<script setup lang="ts">
const { versions, current, items } = useDocsVersions()

type VersionItem = (typeof items.value)[number]
const versionOf = (item: unknown) => item as VersionItem
</script>

<template>
  <UDropdownMenu
    v-if="versions.length > 1"
    :items
    :content="{ align: 'end', sideOffset: 6 }"
    :ui="{
      content: 'min-w-36 rounded-(--d-r-lg) bg-(--ui-bg) ring-(--d-line-strong)',
      group: 'p-1',
      item: 'h-8 items-center rounded-(--d-r-md) px-2 font-mono text-[12.5px] text-muted before:rounded-(--d-r-md) data-highlighted:not-data-disabled:before:bg-(--d-raised-strong)',
    }"
  >
    <button
      type="button"
      aria-label="Switch documentation version"
      class="group/version inline-flex h-6 items-center gap-1.5 rounded-(--d-r-md) border border-(--d-line) pr-1.5 pl-2 font-mono text-[12px]/none text-muted transition-colors duration-150 hover:border-(--d-line-strong) hover:text-highlighted data-[state=open]:border-(--d-line-strong) data-[state=open]:text-highlighted"
    >
      {{ current?.label ?? 'versions' }}
      <span v-if="current?.badge" class="text-dimmed">{{ current.badge }}</span>
      <svg viewBox="0 0 10 10" class="size-2.5 shrink-0 text-dimmed group-hover/version:text-muted" fill="none" aria-hidden="true">
        <path d="M3 3.75 5 1.75 7 3.75M3 6.25 5 8.25 7 6.25" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <template #item-label="{ item }">
      <span :class="versionOf(item).current ? 'text-highlighted' : ''">{{ versionOf(item).label }}</span>
      <span v-if="versionOf(item).badge" class="ml-1.5 text-dimmed">{{ versionOf(item).badge }}</span>
    </template>

    <template #item-trailing="{ item }">
      <UIcon v-if="versionOf(item).current" name="i-lucide-check" class="size-3.5 text-highlighted" />
    </template>
  </UDropdownMenu>
</template>
