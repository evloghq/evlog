<script setup lang="ts">
import type { VNode } from 'vue'
import { tv } from '@nuxt/ui/utils/tv'
import UCodeIcon from '@nuxt/ui/components/prose/CodeIcon.vue'
import theme from '#build/ui/prose/code-group'
import { frameworks, resolveFramework } from '~/utils/frameworks'
import type { Framework } from '~/utils/frameworks'

interface Tab {
  label: string
  path?: string
  framework?: Framework
  component: VNode
}

interface FrameworkTabsSlots {
  default?: () => VNode[]
}

const slots = defineSlots<FrameworkTabsSlots>()

const appConfig = useAppConfig()
const ui = computed(() => tv({ extend: theme, ...(appConfig.ui?.prose?.codeGroup || {}) })())

function flatten(node: VNode): VNode[] {
  if (typeof node.type === 'symbol') {
    return ((node.children as VNode[] | null) ?? []).flatMap(flatten)
  }
  return [node]
}

function collect(): Tab[] {
  return (slots.default?.() ?? []).flatMap(flatten).map((node, index) => {
    const label = String(node.props?.filename ?? node.props?.label ?? index)
    // The fence meta carries the file path: ```ts [Nuxt] server/plugins/evlog.ts
    const path = node.props?.meta || undefined
    return { label, path, framework: resolveFramework(label), component: node }
  })
}

const version = ref(0)
onBeforeUpdate(() => version.value++)

const items = computed(() => {
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- slots are not reactive; re-read them on every render
  version.value
  return collect()
})

const chosen = useFramework()
// A tab naming no framework ("Any frontend") can be viewed here without
// becoming the site-wide choice.
const local = ref<number>()
watch(chosen, () => {
  local.value = undefined
})

const active = computed(() => {
  const picked = local.value !== undefined ? items.value[local.value] : undefined
  return picked ?? items.value.find(t => t.framework?.id === chosen.value) ?? items.value[0]!
})
const activeIndex = computed(() => items.value.indexOf(active.value))

const missing = computed(() => {
  if (!chosen.value || active.value.framework?.id === chosen.value) return
  return frameworks.find(f => f.id === chosen.value)
})

const options = computed(() => items.value.map((tab, index) => ({
  label: tab.framework?.label ?? tab.label,
  icon: tab.framework?.icon,
  value: String(index),
})))

const selected = computed({
  get: () => String(activeIndex.value),
  set: (value: string) => {
    const index = Number(value)
    const framework = items.value[index]?.framework
    if (framework) {
      chosen.value = framework.id
      local.value = undefined
    } else {
      local.value = index
    }
  },
})
</script>

<template>
  <div :class="ui.root()" data-section="framework-tabs">
    <div :class="ui.list({ class: 'gap-1.5 overflow-visible px-4 py-2' })">
      <template v-if="active.path">
        <UCodeIcon :filename="active.path" class="size-4 shrink-0" />
        <span class="truncate text-sm/6 text-default">{{ active.path }}</span>
      </template>
      <span v-if="missing" class="truncate text-xs text-dimmed">
        No {{ missing.label }} example here
      </span>
      <USelectMenu
        v-model="selected"
        :items="options"
        value-key="value"
        :search-input="false"
        :icon="active.framework?.icon"
        color="neutral"
        variant="ghost"
        size="xs"
        aria-label="Framework"
        class="ml-auto -my-1 -mr-2"
        :content="{ align: 'end' }"
        :ui="{ base: 'text-xs/5 font-medium shrink-0 rounded-md text-default', content: 'min-w-52', leadingIcon: 'size-3.5 text-default', itemLeadingIcon: 'text-default', trailingIcon: 'size-3.5' }"
      />
    </div>

    <component :is="active.component" :key="activeIndex" hide-header tabindex="-1" />
  </div>
</template>
