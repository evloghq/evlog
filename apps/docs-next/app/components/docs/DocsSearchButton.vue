<script setup lang="ts">
const { open } = useContentSearch()
</script>

<!-- A row of the sidebar's control card in DocsShell: the card draws the frame. -->
<template>
  <button
    type="button"
    class="group/search flex h-9 w-full items-center gap-2.5 px-[7px] text-[13.5px] text-dimmed transition-colors duration-150 hover:bg-(--d-raised-strong) hover:text-muted"
    @click="open = true"
  >
    <span class="grid size-4 shrink-0 place-items-center">
      <svg viewBox="0 0 16 16" class="size-3.5 transition-transform duration-200 ease-(--d-ease) group-hover/search:-rotate-12" fill="none" aria-hidden="true">
        <circle cx="7" cy="7" r="4.75" stroke="currentColor" stroke-width="1.4" />
        <path d="m10.5 10.5 3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      </svg>
    </span>
    <span class="flex-1 text-left">Search</span>
    <kbd class="flex gap-0.5 font-sans text-[11px] text-dimmed">
      <span class="grid h-[18px] min-w-[18px] place-items-center rounded-[4px] bg-(--d-raised-strong) px-1 ring-1 ring-(--d-line) ring-inset">⌘</span>
      <span class="grid h-[18px] min-w-[18px] place-items-center rounded-[4px] bg-(--d-raised-strong) px-1 ring-1 ring-(--d-line) ring-inset">K</span>
    </kbd>
  </button>
</template>
