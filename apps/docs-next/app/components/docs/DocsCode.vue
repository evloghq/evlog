<script setup lang="ts">
const slots = useSlots()
</script>

<template>
  <code
    class="rounded-(--d-r-sm) bg-(--d-raised-strong) px-[5px] py-px font-mono text-[0.86em] text-highlighted"
    :data-phrase="isPhrase(nodeText(slots.default?.())) || undefined"
  >
    <slot />
  </code>
</template>
