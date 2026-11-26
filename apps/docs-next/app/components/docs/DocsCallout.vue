<script setup lang="ts">
const props = defineProps<{ color?: string, icon?: string, to?: string }>()

const warns = computed(() => props.color === 'warning' || props.color === 'error')
const mark = computed(() => props.icon ?? (warns.value ? 'i-lucide-triangle-alert' : 'i-lucide-info'))
</script>

<!-- Outlined and unfilled, so it never reads as code. Only the mark carries the warning colour. -->
<template>
  <aside class="my-7 flex gap-3 rounded-(--d-r-lg) border border-(--d-line) py-3 pr-4 pl-3.5 text-[14px]/[1.65]">
    <UIcon :name="mark" class="mt-[3.5px] size-4 shrink-0" :class="warns ? 'text-(--d-warn)' : 'text-dimmed'" />
    <div class="min-w-0 [&_p]:my-2 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0" :class="warns ? 'text-default' : 'text-muted'">
      <slot />
    </div>
  </aside>
</template>
