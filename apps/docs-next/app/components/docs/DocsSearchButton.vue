<script setup lang="ts">
const { open } = useContentSearch()
</script>

<template>
  <button
    type="button"
    class="flex h-9 w-full items-center gap-2.5 rounded-(--d-r-md) border border-(--d-line) px-[9px] text-[13.5px] text-dimmed hover:text-muted"
    @click="open = true"
  >
    <svg viewBox="0 0 16 16" class="size-3.5 shrink-0" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.75" stroke="currentColor" stroke-width="1.4" />
      <path d="m10.5 10.5 3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
    </svg>
    <span class="flex-1 text-left">Search</span>
    <kbd class="flex gap-0.5 font-sans text-[11px] text-dimmed">
      <span class="grid h-[18px] min-w-[18px] place-items-center rounded-(--d-r-sm) px-1 ring-1 ring-(--d-line) ring-inset">⌘</span>
      <span class="grid h-[18px] min-w-[18px] place-items-center rounded-(--d-r-sm) px-1 ring-1 ring-(--d-line) ring-inset">K</span>
    </kbd>
  </button>
</template>
