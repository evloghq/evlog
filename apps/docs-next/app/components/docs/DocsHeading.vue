<script setup lang="ts">
import { Fragment, Text } from 'vue'
import type { VNode } from 'vue'
import { useClipboard } from '@vueuse/core'

type Child = VNode | string

const props = defineProps<{ id?: string, level: 2 | 3 | 4 }>()
const slots = defineSlots<{ default?:() => Child[] }>()

const classes = {
  2: 'mt-14 mb-4 text-[22px]/[1.3] font-semibold tracking-[-0.018em]',
  3: 'mt-10 mb-3 text-[17px]/[1.4] font-semibold tracking-[-0.01em]',
  4: 'mt-8 mb-2 text-[15px]/6 font-semibold',
}

// A slot forwarded by DocsH2 arrives wrapped in a fragment.
function flatten(nodes: Child[]): Child[] {
  return nodes.flatMap(node => (typeof node !== 'string' && node.type === Fragment && Array.isArray(node.children)
    ? flatten(node.children as Child[])
    : [node]))
}

const version = ref(0)
onBeforeUpdate(() => version.value++)

// `## 1. Install the package` is a step: its number is set apart from the title.
const parts = computed(() => {
  // Slots are not reactive; read them again on every render.
  void version.value
  const nodes = flatten(slots.default?.() ?? [])
  const [first, ...rest] = nodes
  const lead = typeof first === 'string' ? first : first?.type === Text ? String(first.children) : undefined
  const numbered = props.level === 2 ? lead?.match(/^(\d+)\.\s+/) : undefined
  return {
    step: numbered?.[1],
    body: numbered ? [lead!.slice(numbered[0].length), ...rest] : nodes,
  }
})

const body = (given: { nodes: Child[] }) => given.nodes
body.props = ['nodes']

const reading = useDocsReading()
const active = computed(() => Boolean(props.id) && reading.value === props.id)

const { copy, copied } = useClipboard({ copiedDuring: 1400 })

function copyLink() {
  copy(`${location.origin}${location.pathname}#${props.id}`)
}
</script>

<template>
  <component
    :is="`h${props.level}`"
    :id="props.id"
    class="group/h scroll-mt-24 text-highlighted text-balance [&_code]:text-[0.88em]"
    :class="[classes[props.level], parts.step ? 'flex items-baseline gap-3' : '']"
  >
    <span
      v-if="parts.step"
      class="grid size-6 shrink-0 translate-y-[-1px] place-items-center rounded-full font-mono text-[12px] font-medium tracking-normal ring-1 ring-inset transition-[background-color,color,box-shadow] duration-300 ease-(--d-ease)"
      :class="active ? 'bg-(--ui-text-highlighted) text-(--ui-bg) ring-(--ui-text-highlighted)' : 'bg-(--d-raised-strong) text-muted ring-(--d-line-strong)'"
    >{{ parts.step }}</span>
    <a v-if="props.id" :href="`#${props.id}`" class="relative" @click="copyLink">
      <span
        v-if="!parts.step"
        aria-hidden="true"
        class="absolute top-0 -left-[0.95em] hidden font-normal text-dimmed opacity-0 transition-[opacity,transform] duration-200 ease-(--d-ease) group-hover/h:translate-x-0 group-hover/h:opacity-100 sm:inline"
        :class="copied ? 'translate-x-0 text-highlighted opacity-100' : 'translate-x-1'"
      >#</span>
      <component :is="body" :nodes="parts.body" />
      <span
        class="d-xfade pointer-events-none absolute top-1/2 left-full ml-3 -translate-y-1/2 text-[12.5px] font-normal tracking-normal whitespace-nowrap text-dimmed"
        :data-on="copied"
        role="status"
      >Link copied</span>
    </a>
    <component :is="body" v-else :nodes="parts.body" />
  </component>
</template>
