<script setup lang="ts">
import { frameworks, routeFile } from '~/utils/frameworks'

const props = defineProps<{ name: string }>()

// `route:POST /api/checkout` names the file that route lives in for the reader's framework. Every
// framework's path is rendered; the global `data-fw-*` CSS leaves one visible before first paint.
const route = computed(() => {
  const match = props.name.match(/^route:(\w+)\s+(\S+)$/)
  if (!match) return undefined
  const [, method, path] = match as [string, string, string]
  return {
    label: `${method.toUpperCase()} ${path}`,
    files: frameworks.map(f => ({ id: f.id, file: routeFile(f.id, method, path) })),
  }
})
</script>

<template>
  <span v-if="route">
    <span v-for="{ id, file } in route.files" :key="id" :data-fw-only="id">{{ file }}</span>
    <span data-fw-none>{{ route.label }}</span>
  </span>
  <span v-else>{{ name }}</span>
</template>
