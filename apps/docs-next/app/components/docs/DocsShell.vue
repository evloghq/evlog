<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'

const route = useRoute()
const content = useDocsContent()
const menuOpen = ref(false)

watch(() => route.path, () => {
  menuOpen.value = false
})

// Below `lg` the open menu covers the page, so the page behind it takes no focus and no scroll.
const narrow = useMediaQuery('(max-width: 1023px)')
const covering = computed(() => menuOpen.value && narrow.value)
const toggle = useTemplateRef<HTMLElement>('toggle')

function dismiss() {
  if (!covering.value) return
  menuOpen.value = false
  toggle.value?.focus()
}
</script>

<template>
  <div class="docs-shell min-h-svh bg-default text-default" :data-covered="covering || undefined" @keydown.esc="dismiss">
    <header
      class="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-(--d-line) px-5 lg:hidden"
      :class="covering ? 'bg-default' : 'bg-default/85 backdrop-blur-md'"
    >
      <div class="flex items-center gap-3">
        <NuxtLink :to="prefixLink('/', content.routeBase)" aria-label="evlog home" class="rounded-(--d-r-sm)">
          <DocsLogo />
        </NuxtLink>
        <DocsVersionSelect />
      </div>
      <button
        ref="toggle"
        type="button"
        class="rounded-(--d-r-md) px-2.5 py-1 text-[14px] text-muted transition-[color,background-color,transform] duration-150 hover:bg-(--d-raised-strong) hover:text-highlighted active:scale-[0.97]"
        :aria-expanded="menuOpen"
        aria-controls="docs-menu"
        @click="menuOpen = !menuOpen"
      >
        {{ menuOpen ? 'Close' : 'Menu' }}
      </button>
      <span aria-hidden="true" class="docs-progress" />
    </header>

    <div class="flex w-full">
      <main class="min-w-0 flex-1 overflow-x-clip lg:order-2" :inert="covering">
        <slot />
      </main>

      <aside
        id="docs-menu"
        class="docs-menu fixed inset-x-0 top-14 bottom-0 z-30 flex flex-col bg-default lg:sticky lg:top-0 lg:order-1 lg:z-auto lg:h-svh lg:w-[17rem] lg:shrink-0 lg:border-r lg:border-(--d-line)"
        :data-open="menuOpen"
      >
        <!-- As tall as the page's top bar, so one hairline runs across the whole window. -->
        <div class="hidden h-14 shrink-0 items-center justify-between border-b border-(--d-line) px-6 lg:flex">
          <NuxtLink :to="prefixLink('/', content.routeBase)" aria-label="evlog home" class="rounded-(--d-r-sm)">
            <DocsLogo />
          </NuxtLink>
          <DocsVersionSelect />
        </div>

        <div class="shrink-0 px-5 pt-4 lg:px-6">
          <!-- -mx-2.5 lines both controls up with the sidebar's highlight. -->
          <div class="d-controls -mx-2.5 flex flex-col gap-1">
            <DocsSearchButton />
            <DocsFrameworkSelect v-if="content.mode !== 'version'" />
          </div>
        </div>

        <div class="d-scroll min-h-0 flex-1 px-5 pt-5 pb-6 lg:px-6">
          <DocsSidebar />
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
@media (max-width: 1023px) {
  .docs-menu {
    transition: opacity 200ms var(--d-ease), transform 200ms var(--d-ease), visibility 0s linear 200ms;
  }

  .docs-menu[data-open='false'] {
    visibility: hidden;
    opacity: 0;
    transform: translateY(-6px);
  }

  .docs-menu[data-open='true'] {
    transition-delay: 0s;
  }
}

:global(html:has(.docs-shell[data-covered])) {
  overflow: hidden;
}

@media (prefers-reduced-motion: reduce) {
  .docs-menu {
    transform: none !important;
  }
}
</style>
