<script setup lang="ts">
const props = defineProps<{ href?: string, target?: string }>()
const external = computed(() => /^https?:\/\//.test(props.href ?? ''))

const { target: page, preview, load } = usePagePreview(() => props.href)
const hovered = ref(false)

function onOpen(value: boolean) {
  hovered.value = value
  if (value) load()
}

const linkClass = 'text-highlighted underline decoration-(--d-line-strong) decoration-1 underline-offset-[5px] transition-[text-decoration-color] duration-150 hover:decoration-(--d-signal-text)'
</script>

<template>
  <UPopover
    v-if="page"
    mode="hover"
    :open="hovered && Boolean(preview)"
    :open-delay="350"
    :close-delay="80"
    :content="{ side: 'bottom', align: 'start', sideOffset: 8, collisionPadding: 16 }"
    :ui="{ content: 'w-80 rounded-[12px] border border-[#2a2a30] bg-[#111114] p-0 shadow-[0_16px_40px_-12px_rgb(0_0_0/0.7)] ring-0 origin-(--reka-popover-content-transform-origin)' }"
    @update:open="onOpen"
  >
    <NuxtLink :to="props.href" :class="linkClass">
      <slot />
    </NuxtLink>

    <template #content>
      <div v-if="preview" class="px-4 pt-3.5 pb-3.5">
        <p class="text-[14px] text-[#f0f0f2]">
          {{ preview.title }}
        </p>
        <p v-if="preview.description" class="mt-1 line-clamp-3 text-[13px]/[1.55] text-[#a3a3ad]">
          {{ preview.description }}
        </p>
        <ul v-if="preview.sections.length" class="mt-3 flex flex-col gap-1 border-t border-[#1c1c20] pt-3 text-[12.5px] text-[#6b6b74]">
          <li v-for="section in preview.sections.slice(0, 4)" :key="section" class="truncate">
            {{ section }}
          </li>
          <li v-if="preview.sections.length > 4" class="text-[#4a4a52]">
            {{ preview.sections.length - 4 }} more {{ preview.sections.length - 4 === 1 ? 'section' : 'sections' }}
          </li>
        </ul>
      </div>
    </template>
  </UPopover>

  <NuxtLink
    v-else
    :to="props.href"
    :target="props.target ?? (external ? '_blank' : undefined)"
    :class="linkClass"
  >
    <slot />
  </NuxtLink>
</template>
