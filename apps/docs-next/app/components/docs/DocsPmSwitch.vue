<script setup lang="ts">
import { useResizeObserver } from '@vueuse/core'

const pm = usePackageManager()
const list = useTemplateRef<HTMLElement>('list')
const pill = reactive({ x: 0, w: 0, travels: false })

function measure() {
  const button = list.value?.querySelector<HTMLElement>(`[data-pm="${pm.value}"]`)
  if (!button) return
  pill.x = button.offsetLeft
  pill.w = button.offsetWidth
}

watch(pm, () => nextTick(measure))
useResizeObserver(list, measure)

onMounted(() => {
  measure()
  requestAnimationFrame(() => {
    pill.travels = true
  })
})
</script>

<template>
  <div ref="list" role="radiogroup" aria-label="Package manager" class="relative flex items-center">
    <span
      aria-hidden="true"
      class="absolute top-0 left-0 h-7 rounded-(--d-r-md) bg-(--d-raised-strong) ring-1 ring-(--d-line) ring-inset"
      :class="pill.travels ? 'transition-[transform,width] duration-[260ms] ease-(--d-ease)' : ''"
      :style="{ transform: `translateX(${pill.x}px)`, width: `${pill.w}px` }"
    />
    <button
      v-for="name in PACKAGE_MANAGERS"
      :key="name"
      type="button"
      role="radio"
      :aria-checked="pm === name"
      :data-pm="name"
      class="relative h-7 rounded-(--d-r-md) px-2.5 font-mono text-[12.5px] transition-colors duration-150"
      :class="pm === name ? 'text-highlighted' : 'text-dimmed hover:text-default'"
      @click="pm = name"
    >
      {{ name }}
    </button>
  </div>
</template>
