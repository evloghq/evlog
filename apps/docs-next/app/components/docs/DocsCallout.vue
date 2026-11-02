<script setup lang="ts">
const props = defineProps<{ color?: string, icon?: string, to?: string }>()

const warns = computed(() => props.color === 'warning' || props.color === 'error')
</script>

<template>
  <aside
    class="my-7 rounded-(--d-r-lg) border px-5 py-4 text-[14px]/[1.65] [&_p]:my-2 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
    :class="warns ? 'border-[#3a2b19] bg-[#15110c] text-default' : 'border-(--d-line) bg-(--d-raised) text-muted'"
  >
    <slot />
  </aside>
</template>
