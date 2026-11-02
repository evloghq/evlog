<script setup lang="ts">
defineProps<{ id?: string }>()
</script>

<template>
  <DocsHeading :id :level="3">
    <slot />
  </DocsHeading>
</template>
