<script setup lang="ts">
import type { VNode } from 'vue'
import { tv } from '@nuxt/ui/utils/tv'
import UCodeIcon from '@nuxt/ui/components/prose/CodeIcon.vue'
import theme from '#build/ui/prose/code-group'
import { frameworks, resolveFramework } from '~/utils/frameworks'
import type { Framework } from '~/utils/frameworks'

interface Tab {
  key: string
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
    const framework = resolveFramework(label)
    return { key: framework?.id ?? `tab-${index}`, label, path, framework, component: node }
  })
}

const version = ref(0)
onBeforeUpdate(() => version.value++)

const items = computed(() => {
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- slots are not reactive; re-read them on every render
  version.value
  return collect()
})

// Every tab is rendered; which one shows is decided by CSS from
// `<html data-framework>`, stamped before first paint by the head script in
// `plugins/framework-choice.ts`. The pages are prerendered, so this is the only
// way the first paint can already be the reader's framework. Vue state below
// drives the menu only, and only after mount.
const STANDALONE = 'standalone'
const hide = (selector: string) => `${selector}{display:none}`
const css = [
  hide('html:not([data-framework]) .framework-tabs [data-tab]:not([data-first])'),
  ...frameworks.flatMap(({ id }) => {
    const own = `[data-tab="${id}"]`
    const group = `html[data-framework="${id}"] .framework-tabs`
    return [
      hide(`${group}:has(${own}) [data-tab]:not(${own})`),
      // A Standalone tab is `initLogger` config, shared by every integration.
      hide(`${group}:not(:has(${own})):has([data-tab="${STANDALONE}"]) [data-tab]:not([data-tab="${STANDALONE}"])`),
      hide(`${group}:not(:has(${own})):not(:has([data-tab="${STANDALONE}"])) [data-tab]:not([data-first])`),
      `${group}:not(:has(${own})):not(:has([data-tab="${STANDALONE}"])) [data-missing="${id}"]{display:inline}`,
    ]
  }),
].join('\n')
useHead({ style: [{ key: 'framework-tabs', innerHTML: css }] })

const chosen = useFramework()
const choice = useState<string | undefined>('framework-choice', () => undefined)
onMounted(() => {
  choice.value = document.documentElement.dataset.framework
})

// A tab naming no framework ("Any frontend") can be viewed here without
// becoming the site-wide choice. Inline styles only exist once it is picked,
// so the server and the first client render agree.
const local = ref<number>()
watch(choice, () => {
  local.value = undefined
})
function view(index: number, display: string) {
  if (local.value === undefined) return
  return { display: local.value === index ? display : 'none' }
}

const options = computed(() => items.value.map((tab, index) => ({
  label: tab.framework?.label ?? tab.label,
  icon: tab.framework?.icon,
  value: String(index),
})))

const selected = computed({
  get: () => {
    if (local.value !== undefined) return String(local.value)
    const index = items.value.findIndex(t => t.framework?.id === choice.value)
    if (index !== -1) return String(index)
    const standalone = choice.value ? items.value.findIndex(t => t.framework?.id === STANDALONE) : -1
    return String(standalone === -1 ? 0 : standalone)
  },
  set: (value: string) => {
    const index = Number(value)
    const framework = items.value[index]?.framework
    if (framework) {
      chosen.value = framework.id
      choice.value = framework.id
      document.documentElement.dataset.framework = framework.id
      local.value = undefined
    } else {
      local.value = index
    }
  },
})
</script>

<template>
  <div :class="ui.root({ class: 'framework-tabs [&>[data-tab]>*]:my-0! [&>[data-tab]>*]:static!' })" data-section="framework-tabs">
    <div :class="ui.list({ class: 'gap-1.5 overflow-visible px-4 py-2' })">
      <template v-for="(tab, index) in items" :key="tab.key">
        <span
          v-if="tab.path"
          :data-tab="tab.key"
          :data-first="index === 0 || undefined"
          :style="view(index, 'flex')"
          class="flex min-w-0 items-center gap-1.5"
        >
          <UCodeIcon :filename="tab.path" class="size-4 shrink-0" />
          <span class="truncate text-sm/6 text-default">{{ tab.path }}</span>
        </span>
      </template>
      <span
        v-for="framework in frameworks"
        :key="framework.id"
        :data-missing="framework.id"
        class="hidden truncate text-xs text-dimmed"
      >No {{ framework.label }} example here</span>
      <USelectMenu
        v-model="selected"
        :items="options"
        value-key="value"
        :search-input="false"
        color="neutral"
        variant="ghost"
        size="sm"
        aria-label="Framework"
        class="ml-auto -my-1 -mr-2"
        :content="{ align: 'end' }"
        :ui="{ base: 'text-sm/5 md:text-sm/5 font-medium shrink-0 rounded-md text-default', content: 'min-w-52', viewport: 'framework-picker-viewport', itemLeadingIcon: 'text-default' }"
      >
        <span
          v-for="(tab, index) in items"
          :key="tab.key"
          :data-tab="tab.key"
          :data-first="index === 0 || undefined"
          :style="view(index, 'inline-flex')"
          class="inline-flex items-center gap-1.5 truncate"
        >
          <UIcon v-if="tab.framework" :name="tab.framework.icon" class="size-4 shrink-0" />
          {{ tab.framework?.label ?? tab.label }}
        </span>
      </USelectMenu>
    </div>

    <div
      v-for="(tab, index) in items"
      :key="tab.key"
      :data-tab="tab.key"
      :data-first="index === 0 || undefined"
      :style="view(index, 'block')"
    >
      <component :is="tab.component" hide-header tabindex="-1" />
    </div>
  </div>
</template>

<style>
/* The menu renders in a portal, so this cannot be scoped. The fades follow the
   scroll position: none at the top edge until the list has scrolled, none at
   the bottom once it reaches the end. */
@property --fade-top {
  syntax: '<length>';
  inherits: false;
  initial-value: 0px;
}

@property --fade-bottom {
  syntax: '<length>';
  inherits: false;
  initial-value: 0px;
}

.framework-picker-viewport {
  mask-image: linear-gradient(to bottom, transparent, black var(--fade-top), black calc(100% - var(--fade-bottom)), transparent);
}

@supports (animation-timeline: scroll()) {
  .framework-picker-viewport {
    animation: framework-picker-fade linear both;
    animation-timeline: scroll(self);
  }

  @keyframes framework-picker-fade {
    0% { --fade-top: 0px; --fade-bottom: 20px; }
    10% { --fade-top: 20px; }
    90% { --fade-bottom: 20px; }
    100% { --fade-top: 20px; --fade-bottom: 0px; }
  }
}
</style>
