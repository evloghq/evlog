<script setup lang="ts">
defineProps<{
  tip: string
}>()
</script>

<template>
  <span class="inline-flex items-center gap-1.5 align-middle">
    <slot />
    <UPopover
      mode="hover"
      :open-delay="120"
      :close-delay="80"
      :content="{ side: 'top', align: 'start', sideOffset: 6 }"
      arrow
      :ui="{ content: 'max-w-xs' }"
    >
      <button
        type="button"
        class="inline-flex items-center text-muted hover:text-default focus:text-default focus:outline-none cursor-help leading-none"
        aria-label="What does this mean?"
      >
        <UIcon name="i-lucide-info" class="size-3.5" />
      </button>

      <template #content>
        <p class="px-3 py-2 text-xs leading-relaxed text-toned">
          {{ tip }}
        </p>
      </template>
    </UPopover>
  </span>
</template>
