<script setup lang="ts">
defineProps<{ id?: string }>()
</script>

<template>
  <DocsHeading :id :level="4">
    <slot />
  </DocsHeading>
</template>
