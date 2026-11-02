<script setup lang="ts">
// Local override of @nuxt/ui's ProsePrompt: identical rendering, plus a
// `prompt_used` analytics event on each action. Which integration prompt gets
// copied into which agent is the closest signal to "which integration do
// people adopt", and the upstream component emits nothing.
import { useClipboard } from '@vueuse/core'
import { useLocale } from '@nuxt/ui/composables/useLocale'
import { getSlotChildrenText } from '@nuxt/ui/utils'
import { tv } from '@nuxt/ui/utils/tv'
import theme from '#build/ui/prose/prompt'

type PromptAction = 'copy' | 'cursor' | 'windsurf' | 'claude'

interface PromptSlots {
  default?: () => unknown
}

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  description?: string
  icon?: string
  actions?: PromptAction[]
  class?: unknown
  ui?: Partial<Record<'root' | 'icon' | 'content' | 'description' | 'actions', string>>
}>()

const slots = defineSlots<PromptSlots>()

const { t } = useLocale()
const { copy, copied } = useClipboard()
const appConfig = useAppConfig()

const classes = computed(() => tv({ extend: theme, ...(appConfig.ui?.prose?.prompt || {}) })())
const actions = computed<PromptAction[]>(() => [...new Set<PromptAction>(['copy', ...(props.actions ?? [])])])

function getPromptText(): string {
  const children = slots.default?.()
  return children ? getSlotChildrenText(children).trim() : ''
}

function copyPrompt() {
  copy(getPromptText())
  trackEvent('prompt_used', { action: 'copy' })
}

function openIn(action: Exclude<PromptAction, 'copy'>) {
  const text = encodeURIComponent(getPromptText())
  const urls: Record<typeof action, string> = {
    cursor: `cursor://anysphere.cursor-deeplink/prompt?text=${text}`,
    windsurf: `windsurf://cascade/newChat?prompt=${text}`,
    claude: `claude://code/new?q=${text}`,
  }
  trackEvent('prompt_used', { action })
  window.open(urls[action], '_self')
}
</script>

<template>
  <div :class="classes.root({ class: [props.ui?.root, props.class] })" v-bind="$attrs">
    <UIcon v-if="props.icon" :name="props.icon" :class="classes.icon({ class: props.ui?.icon })" />

    <div :class="classes.content({ class: props.ui?.content })">
      <p v-if="props.description" :class="classes.description({ class: props.ui?.description })">
        {{ props.description }}
      </p>
    </div>

    <div :class="classes.actions({ class: props.ui?.actions })">
      <UButton
        v-if="actions.includes('copy')"
        :icon="copied ? appConfig.ui.icons.copyCheck : appConfig.ui.icons.copy"
        size="sm"
        :label="t('prose.prompt.copy')"
        @click="copyPrompt"
      />

      <UButton
        v-if="actions.includes('cursor')"
        icon="i-simple-icons-cursor"
        color="neutral"
        variant="outline"
        size="sm"
        :label="t('prose.prompt.openIn', { name: 'Cursor' })"
        @click="openIn('cursor')"
      />

      <UButton
        v-if="actions.includes('windsurf')"
        icon="i-simple-icons-windsurf"
        color="neutral"
        variant="outline"
        size="sm"
        :label="t('prose.prompt.openIn', { name: 'Windsurf' })"
        @click="openIn('windsurf')"
      />

      <UButton
        v-if="actions.includes('claude')"
        icon="i-simple-icons-claude"
        color="neutral"
        variant="outline"
        size="sm"
        :label="t('prose.prompt.openIn', { name: 'Claude' })"
        @click="openIn('claude')"
      />
    </div>
  </div>
</template>
