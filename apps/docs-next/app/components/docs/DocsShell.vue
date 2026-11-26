<script setup lang="ts">
const route = useRoute()
const content = useDocsContent()
const menuOpen = ref(false)
// Set by the first navigation, so a page fades in when the reader moves and never on first load.
const navigated = useState('docs-navigated', () => false)

watch(() => route.path, () => {
  menuOpen.value = false
  navigated.value = true
})
</script>

<template>
  <div class="docs-shell min-h-svh bg-default text-default">
    <header class="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-(--d-line) bg-default/85 px-5 backdrop-blur-md lg:hidden">
      <div class="flex items-center gap-2">
        <NuxtLink :to="prefixLink('/', content.routeBase)" aria-label="evlog home">
          <DocsLogo />
        </NuxtLink>
        <DocsVersionSelect />
      </div>
      <button
        type="button"
        class="rounded-(--d-r-md) px-2.5 py-1 text-[14px] text-muted transition-[color,background-color,transform] duration-150 hover:bg-(--d-raised-strong) hover:text-highlighted active:scale-[0.97]"
        :aria-expanded="menuOpen"
        aria-controls="docs-menu"
        @click="menuOpen = !menuOpen"
      >
        {{ menuOpen ? 'Close' : 'Menu' }}
      </button>
    </header>

    <div class="flex w-full">
      <main class="min-w-0 flex-1 overflow-x-clip lg:order-2">
        <slot />
      </main>

      <aside
        id="docs-menu"
        class="docs-menu fixed inset-x-0 top-14 bottom-0 z-30 flex flex-col bg-default lg:sticky lg:top-0 lg:order-1 lg:z-auto lg:h-svh lg:w-[17rem] lg:shrink-0 lg:border-r lg:border-(--d-line)"
        :data-open="menuOpen"
      >
        <!-- As tall as the page's top bar, so one hairline runs across the whole window. -->
        <div class="hidden h-14 shrink-0 items-center gap-2 border-b border-(--d-line) px-6 lg:flex">
          <NuxtLink :to="prefixLink('/', content.routeBase)" aria-label="evlog home" class="rounded-(--d-r-sm)">
            <DocsLogo />
          </NuxtLink>
          <DocsVersionSelect />
        </div>

        <div class="shrink-0 px-5 pt-4 lg:px-6">
          <!-- -mx-2.5 lines the card up with the sidebar's highlight. -->
          <div class="d-card -mx-2.5 flex flex-col divide-y divide-(--d-line) overflow-hidden rounded-[8px] border border-(--d-line) bg-(--d-raised)">
            <DocsSearchButton />
            <DocsFrameworkSelect v-if="content.mode !== 'version'" />
          </div>
        </div>

        <div class="d-scroll min-h-0 flex-1 px-5 pt-5 pb-12 lg:px-6">
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

@media (prefers-reduced-motion: reduce) {
  .docs-menu {
    transform: none !important;
  }
}
</style>
