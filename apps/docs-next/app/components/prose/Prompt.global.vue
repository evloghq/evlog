<script setup lang="ts">
// Used by the v2 pages. Each action sends a `prompt_used` analytics event: which integration prompt
// goes to which agent is the closest signal to which integration people adopt.
import { getSlotChildrenText } from '@nuxt/ui/utils'

type PromptAction = 'copy' | 'cursor' | 'windsurf' | 'claude'

interface PromptSlots {
  default?: () => unknown
}

const props = defineProps<{
  description?: string
  icon?: string
  actions?: PromptAction[]
}>()

const slots = defineSlots<PromptSlots>()

const openers = computed(() => ([
  { action: 'cursor', name: 'Cursor', icon: 'i-simple-icons-cursor' },
  { action: 'windsurf', name: 'Windsurf', icon: 'i-simple-icons-windsurf' },
  { action: 'claude', name: 'Claude', icon: 'i-simple-icons-claude' },
] as const).filter(opener => props.actions?.includes(opener.action)))

function getPromptText(): string {
  const children = slots.default?.()
  return children ? getSlotChildrenText(children).trim() : ''
}

function copyPrompt() {
  trackEvent('prompt_used', { action: 'copy' })
  return getPromptText()
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
  <div class="my-7 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-(--d-r-lg) border border-(--d-line) bg-(--d-raised) py-1.5 pr-1.5 pl-4">
    <p v-if="props.description" class="flex min-w-0 flex-1 items-center gap-2.5 py-1 text-[14px]/5 text-highlighted">
      <UIcon v-if="props.icon" :name="props.icon" class="size-4 shrink-0 text-dimmed" />
      {{ props.description }}
    </p>

    <div class="flex flex-wrap items-center gap-1">
      <button
        v-for="opener in openers"
        :key="opener.action"
        type="button"
        class="inline-flex h-7 items-center gap-1.5 rounded-(--d-r-md) px-2 text-[12.5px] text-dimmed transition-[color,background-color,transform] duration-150 hover:bg-(--d-raised-strong) hover:text-highlighted active:scale-[0.96]"
        @click="openIn(opener.action)"
      >
        <UIcon :name="opener.icon" class="size-3.5" />
        Open in {{ opener.name }}
      </button>
      <DocsCopyButton :source="copyPrompt" label="Copy prompt" />
    </div>
  </div>
</template>
