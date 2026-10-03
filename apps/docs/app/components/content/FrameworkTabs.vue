<script setup lang="ts">
import type { VNode } from 'vue'
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'
import { tv } from '@nuxt/ui/utils/tv'
import theme from '#build/ui/prose/code-group'
import { resolveFramework } from '~/utils/frameworks'

interface Tab {
  label: string
  framework?: string
  icon?: string
  color?: string
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
    const framework = resolveFramework(label)
    return { label, framework: framework?.id, icon: framework?.icon, color: framework?.color, component: node }
  })
}

const version = ref(0)
onBeforeUpdate(() => version.value++)

const items = computed(() => {
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- slots are not reactive; re-read them on every render
  version.value
  return collect()
})

const STORAGE_KEY = 'evlog-framework'
const model = ref('0')
// Shared across every FrameworkTabs on the page: picking Hono once selects it everywhere.
const selected = useState<string | undefined>('framework-tabs', () => undefined)

function select(framework: string | undefined) {
  if (!framework || framework === selected.value) return
  selected.value = framework
  localStorage.setItem(STORAGE_KEY, framework)
}

onMounted(() => {
  if (!selected.value) selected.value = localStorage.getItem(STORAGE_KEY) ?? undefined
  watch(selected, (framework) => {
    const index = items.value.findIndex(item => item.framework === framework)
    if (index !== -1) model.value = String(index)
  }, { immediate: true })
  watch(model, value => select(items.value[Number(value)]?.framework))
})
</script>

<template>
  <TabsRoot
    v-model="model"
    default-value="0"
    :unmount-on-hide="false"
    :class="ui.root()"
    data-section="framework-tabs"
  >
    <TabsList :class="ui.list({ class: 'flex-wrap overflow-visible' })">
      <TabsTrigger
        v-for="(item, index) of items"
        :key="index"
        :value="String(index)"
        :class="ui.trigger({ class: 'data-[state=active]:bg-elevated data-[state=active]:shadow-xs' })"
      >
        <UIcon
          v-if="item.icon"
          :name="item.icon"
          :class="ui.triggerIcon()"
          :style="item.color ? { color: item.color } : undefined"
        />
        <span :class="ui.triggerLabel()">{{ item.label }}</span>
      </TabsTrigger>
    </TabsList>

    <TabsContent
      v-for="(item, index) of items"
      :key="index"
      :value="String(index)"
      as-child
    >
      <component :is="item.component" hide-header tabindex="-1" />
    </TabsContent>
  </TabsRoot>
</template>
