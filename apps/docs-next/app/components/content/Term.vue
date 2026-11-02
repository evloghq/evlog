<script setup lang="ts">
const props = defineProps<{
  /** Key in the glossary, e.g. `wide-event`. */
  of: GlossaryKey
}>()

const content = useDocsContent()
const entry = computed(() => glossary[props.of])
</script>

<template>
  <UPopover
    v-if="entry"
    mode="hover"
    :open-delay="250"
    :close-delay="100"
    :content="{ side: 'top', align: 'start', sideOffset: 8, collisionPadding: 16 }"
    :ui="{ content: 'w-72 rounded-[12px] border border-[#2a2a30] bg-[#111114] p-0 shadow-[0_12px_32px_-8px_rgb(0_0_0/0.6)] ring-0 origin-(--reka-popover-content-transform-origin)' }"
  >
    <NuxtLink
      :to="prefixLink(entry.to, content.routeBase)"
      class="cursor-help text-inherit underline decoration-[#4a4a52] decoration-dotted decoration-1 underline-offset-[5px] transition-[text-decoration-color] duration-150 hover:decoration-(--d-signal-text)"
    >
      <slot />
    </NuxtLink>

    <template #content>
      <div class="px-4 pt-3.5 pb-3 text-[13px]/[1.55]">
        <p class="text-[13.5px] text-[#f0f0f2]">
          {{ entry.term }}
        </p>
        <p class="mt-1 text-[#a3a3ad]">
          {{ entry.text }}
        </p>
      </div>
      <div class="flex items-center justify-between border-t border-[#1c1c20] px-4 py-2.5 text-[12.5px]">
        <code class="font-mono text-[12px] text-[#d4d4d9]">{{ entry.code }}</code>
        <span class="text-[#6b6b74]">Click to read more</span>
      </div>
    </template>
  </UPopover>
  <span v-else><slot /></span>
</template>
