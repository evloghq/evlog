<script setup lang="ts">
import type { VNode } from 'vue'
import { useResizeObserver } from '@vueuse/core'

const slots = defineSlots<{ default?:() => VNode[] }>()

provide(DOCS_CODE_GROUP, true)

function flatten(node: VNode): VNode[] {
  if (typeof node.type === 'symbol') return ((node.children as VNode[] | null) ?? []).flatMap(flatten)
  return [node]
}

const version = ref(0)
onBeforeUpdate(() => version.value++)

const tabs = computed(() => {
  // Slots are not reactive; read them again on every render.
  void version.value
  return (slots.default?.() ?? []).flatMap(flatten).map((node, index) => ({
    label: String(node.props?.filename ?? node.props?.label ?? index + 1),
    node,
  }))
})

const active = ref(0)
// Panels only animate once the reader has switched tabs; the first paint stays still.
const switched = ref(false)
watch(active, () => {
  switched.value = true
})
const list = useTemplateRef<HTMLElement>('list')
const panel = useTemplateRef<HTMLElement>('panel')
const indicator = reactive({ x: 0, w: 0, travels: false })
const height = ref<number>()

function measure() {
  const button = list.value?.querySelectorAll<HTMLElement>('[role="tab"]')[active.value]
  if (!button) return
  indicator.x = button.offsetLeft
  indicator.w = button.offsetWidth
}

watch(active, () => nextTick(measure))
useResizeObserver(list, measure)
useResizeObserver(panel, ([entry]) => {
  height.value = entry?.target.getBoundingClientRect().height
})

onMounted(() => {
  measure()
  requestAnimationFrame(() => {
    indicator.travels = true
  })
})

function select(index: number) {
  active.value = index
}

function onKey(event: KeyboardEvent) {
  const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
  if (!step) return
  event.preventDefault()
  active.value = (active.value + step + tabs.value.length) % tabs.value.length
  list.value?.querySelectorAll<HTMLElement>('[role="tab"]')[active.value]?.focus()
}

const source = () => {
  const node = tabs.value[active.value]?.node
  return String(node?.props?.code ?? panel.value?.querySelector('pre')?.textContent ?? '')
}
</script>

<template>
  <div class="my-7 overflow-hidden rounded-(--d-r-lg) border border-(--d-line) bg-(--d-raised)">
    <div class="flex h-10 items-center justify-between gap-2 border-b border-(--d-line) pr-1.5 pl-1.5">
      <div
        ref="list"
        role="tablist"
        class="relative flex min-w-0 items-center overflow-x-auto [scrollbar-width:none]"
        @keydown="onKey"
      >
        <span
          aria-hidden="true"
          class="absolute top-0 left-0 h-7 rounded-(--d-r-md) bg-(--d-raised-strong) ring-1 ring-(--d-line) ring-inset"
          :class="indicator.travels ? 'transition-[transform,width] duration-[280ms] ease-(--d-ease)' : ''"
          :style="{ transform: `translateX(${indicator.x}px)`, width: `${indicator.w}px` }"
        />
        <button
          v-for="(tab, index) in tabs"
          :key="tab.label"
          type="button"
          role="tab"
          :aria-selected="active === index"
          :tabindex="active === index ? 0 : -1"
          class="relative h-7 shrink-0 rounded-(--d-r-md) px-2.5 font-mono text-[12.5px] whitespace-nowrap transition-colors duration-150"
          :class="active === index ? 'text-highlighted' : 'text-dimmed hover:text-default'"
          @click="select(index)"
        >
          <DocsFilename :name="tab.label" />
        </button>
      </div>
      <DocsCopyButton :source />
    </div>

    <div
      class="overflow-hidden transition-[height] duration-[280ms] ease-(--d-ease)"
      :style="{ height: height ? `${height}px` : undefined }"
    >
      <div ref="panel" role="tabpanel">
        <div :key="active" :class="switched ? 'd-tab-in' : ''">
          <component :is="tabs[active]?.node" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.d-tab-in {
  animation: d-tab-in 220ms var(--d-ease) both;
}

@keyframes d-tab-in {
  from {
    opacity: 0;
    filter: blur(2px);
  }
}
</style>
