<script setup lang="ts">
defineProps<{ id?: string }>()
</script>

<template>
  <DocsHeading :id :level="2">
    <slot />
  </DocsHeading>
</template>
