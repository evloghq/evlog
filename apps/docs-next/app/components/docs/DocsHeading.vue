<script setup lang="ts">
import { useClipboard } from '@vueuse/core'

const props = defineProps<{ id?: string, level: 2 | 3 | 4 }>()

const classes = {
  2: 'mt-16 mb-4 text-[21px]/[1.3] font-medium tracking-[-0.015em]',
  3: 'mt-11 mb-3 text-[16.5px]/[1.4] font-medium tracking-[-0.01em]',
  4: 'mt-8 mb-2 text-[15px]/6 font-medium',
}

const { copy, copied } = useClipboard({ copiedDuring: 1400 })

function copyLink() {
  copy(`${location.origin}${location.pathname}#${props.id}`)
}
</script>

<template>
  <component
    :is="`h${props.level}`"
    :id="props.id"
    class="group/h text-highlighted text-balance [&_code]:text-[0.88em]"
    :class="classes[props.level]"
  >
    <a v-if="props.id" :href="`#${props.id}`" class="relative" @click="copyLink">
      <slot />
      <span
        aria-hidden="true"
        class="absolute top-1/2 -left-4 size-[5px] -translate-y-1/2 rounded-full transition-[opacity,background-color] duration-200"
        :class="copied ? 'bg-(--d-signal) opacity-100' : 'bg-(--d-line-strong) opacity-0 group-hover/h:opacity-100'"
      />
      <span
        class="d-xfade pointer-events-none absolute top-1/2 left-full ml-3 -translate-y-1/2 text-[12.5px] font-normal tracking-normal whitespace-nowrap text-dimmed"
        :data-on="copied"
        role="status"
      >Link copied</span>
    </a>
    <slot v-else />
  </component>
</template>
