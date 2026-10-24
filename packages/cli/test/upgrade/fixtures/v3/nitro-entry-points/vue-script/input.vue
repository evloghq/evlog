<template>
  <p>{{ status }}</p>
</template>

<script setup lang="ts">
import { parseError } from 'evlog/nitro/v3'

const status = parseError(new Error('x')).status
</script>
