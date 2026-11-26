<script setup lang="ts">
const { view, choose } = useEventView()

const options = [
  { id: 'pretty', label: 'Terminal' },
  { id: 'json', label: 'JSON' },
] as const
</script>

<template>
  <div role="group" aria-label="Show the event as" class="flex items-center">
    <button
      v-for="option in options"
      :key="option.id"
      type="button"
      class="rounded-(--d-r-sm) px-1.5 py-0.5 text-[12.5px] transition-colors duration-150"
      :class="view === option.id ? 'text-highlighted' : 'text-dimmed hover:text-default'"
      :aria-pressed="view === option.id"
      @click="choose(option.id)"
    >
      {{ option.label }}
    </button>
  </div>
</template>
