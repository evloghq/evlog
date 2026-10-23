<template>
  <p>{{ status }}</p>
</template>

<script setup lang="ts">
import { parseError } from 'evlog/nitro'

const status = parseError(new Error('x')).status
</script>
