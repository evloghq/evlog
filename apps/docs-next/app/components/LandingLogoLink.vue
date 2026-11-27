<script setup lang="ts">
defineProps<{
  name: string
  href: string
  icon: string
  wordmarkClass: string
}>()
</script>

<template>
  <a
    :href
    target="_blank"
    rel="noopener noreferrer"
    class="landing-logo-item flex w-full min-w-0 items-center justify-center"
    :aria-label="name"
  >
    <UIcon
      :name="icon"
      :class="wordmarkClass"
      aria-hidden="true"
    />
  </a>
</template>

<style scoped>
.landing-logo-item {
  color: color-mix(in srgb, var(--ui-text-muted) 55%, transparent);
  transition: color 0.25s ease, transform 0.25s ease;
}

.landing-logo-item:hover {
  color: var(--ui-text-muted);
  transform: translateY(-1px);
}

.landing-logo-item:focus-visible {
  color: var(--ui-text-muted);
  outline: 2px solid color-mix(in srgb, var(--ui-color-primary-500) 60%, transparent);
  outline-offset: 4px;
  border-radius: 2px;
}
</style>
