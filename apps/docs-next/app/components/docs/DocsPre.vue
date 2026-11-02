<script setup lang="ts">
import type { VNode } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  code?: string
  language?: string
  filename?: string
  meta?: string
  highlights?: number[]
  hideHeader?: boolean
  class?: string | string[] | Record<string, boolean>
}>()

const slots = defineSlots<{ default?:() => VNode[] }>()

// Inside a tab group the group draws the frame and the tabs carry the filename.
const grouped = inject(DOCS_CODE_GROUP, false)

// Before Vue normalizes them, a slot's children can be raw strings as well as vnodes.
function textOf(nodes: (VNode | string)[] | undefined): string {
  return (nodes ?? []).map((node) => {
    if (typeof node === 'string') return node
    if (typeof node.children === 'string') return node.children
    if (Array.isArray(node.children)) return textOf(node.children as VNode[])
    return ''
  }).join('')
}

// A block of `pnpm add` / `pnpm dlx` lines is shown in the reader's package manager.
const pm = usePackageManager()
const commands = computed(() => {
  if (grouped || !['bash', 'sh', 'shell'].includes(props.language ?? '')) return undefined
  const lines = textOf(slots.default?.()).trim().split('\n')
  const parsed = lines.map(line => toPackageManager(line.trim(), pm.value))
  return parsed.every(Boolean) ? parsed as CommandLine[] : undefined
})

const base = useTemplateRef('base')
const source = () => props.code ?? base.value?.textContent ?? ''

const header = computed(() => !grouped && !props.hideHeader && (Boolean(props.filename) || Boolean(commands.value)))
</script>

<template>
  <div
    class="group/pre relative"
    :class="grouped ? '' : 'my-7 overflow-hidden rounded-(--d-r-lg) border border-(--d-line) bg-(--d-raised)'"
  >
    <div v-if="header" class="flex h-10 items-center justify-between gap-3 border-b border-(--d-line) pr-1.5" :class="commands ? 'pl-1.5' : 'pl-4'">
      <DocsPmSwitch v-if="commands" />
      <DocsFilename v-else :name="props.filename!" class="min-w-0 truncate font-mono text-[12.5px] text-muted" />
      <DocsCopyButton :source />
    </div>

    <pre
      ref="base"
      class="overflow-x-auto px-4 py-4 font-mono text-[13px]/[1.75] text-default [&_.line]:block [&_.line.highlight]:-mx-4 [&_.line.highlight]:bg-(--d-raised-strong) [&_.line.highlight]:px-4"
      :class="props.class"
      v-bind="$attrs"
    ><code v-if="commands"><span v-for="(line, i) in commands" :key="i" class="line"><span style="color: #c472fb; --shiki-dark: #c472fb">{{ line.bin }}</span> <template v-if="line.verb"><span style="color: #ff518d; --shiki-dark: #ff518d">{{ line.verb }}</span> </template>{{ line.rest }}</span></code><slot v-else /></pre>

    <div
      v-if="!header && !grouped"
      class="absolute top-2 right-2 rounded-(--d-r-md) bg-(--d-raised) opacity-0 transition-opacity duration-150 group-hover/pre:opacity-100 focus-within:opacity-100"
    >
      <DocsCopyButton :source />
    </div>
  </div>
</template>
