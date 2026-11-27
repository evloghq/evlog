<script setup lang="ts">
const slots = useSlots()
</script>

<template>
  <td
    class="py-3 pr-3 sm:pr-5 align-top text-muted first:text-highlighted last:pr-0 [&_a]:whitespace-nowrap [&_code]:text-[12.5px] [&_code]:whitespace-nowrap first:[&_code]:bg-transparent first:[&_code]:px-0 first:[&_code]:ring-0"
    :class="{ 'first:whitespace-nowrap': isRowName(nodeText(slots.default?.())) }"
  >
    <slot />
  </td>
</template>
