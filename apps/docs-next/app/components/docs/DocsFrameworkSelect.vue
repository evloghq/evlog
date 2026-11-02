<script setup lang="ts">
import type { Framework, FrameworkKind } from '~/utils/frameworks'
import { frameworks } from '~/utils/frameworks'

const route = useRoute()
const content = useDocsContent()
const { choice, choose } = useFrameworkChoice()
// Until mount, the before-paint `data-fw-*` CSS picks what shows; after it, changes animate.
const mounted = ref(false)
onMounted(() => {
  mounted.value = true
})

const kinds: FrameworkKind[] = ['Full-stack', 'Backend', 'Runtime']
const items = kinds.map(kind => [
  { type: 'label' as const, label: kind },
  ...frameworks.filter(f => f.kind === kind).map(f => ({ label: f.label, value: f.id, framework: f })),
])

const idle = ['nuxt', 'next', 'hono', 'sveltekit', 'express', 'astro']
  .map(id => frameworks.find(f => f.id === id)!)

const chosen = computed(() => frameworks.find(f => f.id === choice.value))

const selected = computed({
  get: () => choice.value,
  set: (id: string | undefined) => {
    if (!id) return
    // Reading another framework's integration page means the reader wants the new one's.
    const onPage = Object.values(frameworkPages).some(page => prefixLink(page, content.value.routeBase) === route.path)
    choose(id)
    const next = frameworkPages[id]
    if (onPage && next) navigateTo(prefixLink(next, content.value.routeBase))
  },
})

const frameworkOf = (item: unknown) => (item as { framework: Framework }).framework
</script>

<!-- A row of the sidebar's control card in DocsShell: the card draws the frame. -->
<template>
  <USelectMenu
    v-model="selected"
    :items
    value-key="value"
    :search-input="{ placeholder: 'Find a framework', variant: 'none', icon: 'i-lucide-search' }"
    color="neutral"
    variant="none"
    aria-label="Your framework"
    class="w-full"
    :content="{ align: 'start', sideOffset: 6 }"
    :ui="{
      base: 'group/fw flex h-9 w-full items-center gap-2.5 rounded-none px-[7px] text-left text-[13.5px] transition-colors duration-150 hover:bg-(--d-raised-strong) data-[state=open]:bg-(--d-raised-strong)',
      trailing: 'hidden',
      content: 'w-[max(var(--reka-combobox-trigger-width),17rem)] max-h-[min(28rem,var(--reka-combobox-content-available-height,28rem))] rounded-[10px] bg-(--ui-bg) ring-(--d-line-strong)',
      input: 'border-b border-(--d-line) [&_input]:h-10 [&_input]:text-[13px] [&_[data-slot=leadingIcon]]:size-3.5',
      group: 'p-1',
      label: 'px-2 pt-2 pb-1 text-[12px] font-normal text-dimmed',
      item: 'h-8 items-center gap-2.5 rounded-[6px] px-2 text-[13px] text-muted before:inset-0 before:rounded-[6px] data-highlighted:not-data-disabled:before:bg-(--d-raised-strong)',
      itemTrailingIcon: 'size-3.5 text-highlighted',
      empty: 'py-6 text-[13px] text-dimmed',
    }"
  >
    <span class="grid size-4 shrink-0 place-items-center">
      <span v-if="!mounted" class="d-stack place-items-center">
        <UIcon v-for="f in frameworks" :key="f.id" :name="f.icon" :data-fw-only="f.id" class="size-3.5 text-highlighted" />
        <span data-fw-none class="fw-cycle relative size-3.5">
          <UIcon v-for="(f, i) in idle" :key="f.id" :name="f.icon" class="size-3.5 text-highlighted" :style="{ animationDelay: `${i * 2}s` }" />
        </span>
      </span>
      <span v-else class="d-stack place-items-center">
        <Transition name="d-swap">
          <UIcon v-if="chosen" :key="chosen.id" :name="chosen.icon" class="size-3.5 text-highlighted" />
          <span v-else class="fw-cycle relative size-3.5">
            <UIcon v-for="(f, i) in idle" :key="f.id" :name="f.icon" class="size-3.5 text-highlighted" :style="{ animationDelay: `${i * 2}s` }" />
          </span>
        </Transition>
      </span>
    </span>

    <span class="flex-1 text-dimmed transition-colors duration-150 group-hover/fw:text-muted">Framework</span>

    <span v-if="!mounted" class="truncate text-highlighted">
      <span v-for="f in frameworks" :key="f.id" :data-fw-only="f.id">{{ f.label }}</span>
      <span data-fw-none class="text-muted">Choose</span>
    </span>
    <span v-else class="d-stack min-w-0 justify-items-end">
      <Transition name="d-swap">
        <span v-if="chosen" :key="chosen.id" class="truncate text-highlighted">{{ chosen.label }}</span>
        <span v-else class="truncate text-muted">Choose</span>
      </Transition>
    </span>

    <svg viewBox="0 0 10 10" class="-ml-1 size-2.5 shrink-0 text-dimmed transition-colors duration-150 group-hover/fw:text-muted" fill="none" aria-hidden="true">
      <path d="M3 3.75 5 1.75 7 3.75M3 6.25 5 8.25 7 6.25" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>

    <template #item-leading="{ item }">
      <UIcon :name="frameworkOf(item).icon" class="size-3.5 shrink-0 text-highlighted" />
    </template>

    <template #item-label="{ item }">
      <span class="truncate transition-colors duration-150 group-data-highlighted:text-highlighted" :class="{ 'text-highlighted': frameworkOf(item).id === choice }">{{ frameworkOf(item).label }}</span>
    </template>

    <template #item-trailing="{ item }">
      <code class="hidden font-mono text-[11.5px] text-dimmed group-data-highlighted:inline">{{ frameworkOf(item).entry }}</code>
    </template>

    <template #content-bottom>
      <p class="border-t border-(--d-line) px-3 py-2.5 text-[12px]/[1.5] text-dimmed">
        Code tabs, file names and the integrations list follow this choice.
      </p>
    </template>
  </USelectMenu>
</template>
