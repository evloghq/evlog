<script setup lang="ts">
// Local override of @nuxt/ui's ProsePre: identical rendering, plus a
// `code_copied` analytics event so copied snippets show which pages and
// languages people actually lift code from, and framework labels resolved
// through the same registry as FrameworkTabs.
import { useClipboard } from '@vueuse/core'
import { useLocale } from '@nuxt/ui/composables/useLocale'
import { tv } from '@nuxt/ui/utils/tv'
import UCodeIcon from '@nuxt/ui/components/prose/CodeIcon.vue'
import theme from '#build/ui/prose/pre'
import { resolveFramework } from '~/utils/frameworks'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  icon?: string
  code?: string
  language?: string
  filename?: string
  highlights?: number[]
  hideHeader?: boolean
  meta?: string
  copy?: boolean | Record<string, unknown>
  class?: unknown
  ui?: Partial<Record<'root' | 'header' | 'filename' | 'icon' | 'copy' | 'base', string>>
}>()

interface PreSlots {
  default?: () => unknown
}

defineSlots<PreSlots>()

const { t } = useLocale()
const { copy: copyToClipboard, copied } = useClipboard()
const appConfig = useAppConfig()
const baseRef = useTemplateRef('baseRef')

const classes = computed(() => tv({ extend: theme, ...(appConfig.ui?.prose?.pre || {}) })())
const copyButton = computed(() => props.copy ?? true)
const framework = computed(() => props.filename ? resolveFramework(props.filename) : undefined)

function copyCode() {
  const code = props.code ?? baseRef.value?.textContent ?? ''
  copyToClipboard(code)
  trackEvent('code_copied', { language: props.language, filename: props.filename })
}
</script>

<template>
  <div :class="classes.root({ class: [props.ui?.root], filename: !!props.filename })">
    <div v-if="props.filename && !props.hideHeader" :class="classes.header({ class: props.ui?.header })">
      <UCodeIcon :icon="props.icon ?? framework?.icon" :filename="props.filename" :class="classes.icon({ class: props.ui?.icon })" />

      <span :class="classes.filename({ class: props.ui?.filename })">{{ props.filename }}</span>
    </div>

    <UButton
      v-if="copyButton"
      :icon="copied ? appConfig.ui.icons.copyCheck : appConfig.ui.icons.copy"
      color="neutral"
      variant="outline"
      size="sm"
      :aria-label="t('prose.pre.copy')"
      v-bind="typeof copyButton === 'object' ? copyButton : {}"
      :class="classes.copy({ class: props.ui?.copy })"
      @click="copyCode"
    />

    <pre ref="baseRef" :class="classes.base({ class: [props.ui?.base, props.class] })" v-bind="$attrs"><slot /></pre>
  </div>
</template>
