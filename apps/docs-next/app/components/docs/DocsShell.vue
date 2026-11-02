<script setup lang="ts">
const route = useRoute()
const content = useDocsContent()
const menuOpen = ref(false)
const toc = useState<{ id: string, text: string }[]>('docs-toc', () => [])

// The server renders the shell's columns alongside the page, before the page's setup has run, so the
// shell reads the page's sections itself; otherwise they would appear only after hydration.
if (import.meta.server) {
  const { data } = await useDocsPage()
  usePublishToc()(data.value)
}
const reading = useDocsReading()

function toTop() {
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' })
  history.replaceState(history.state, '', location.pathname)
}

watch(() => route.path, () => {
  menuOpen.value = false
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

    <!-- Main comes first in the DOM so the page publishes its sections before the sidebar renders on the server. -->
    <div class="mx-auto flex w-full max-w-[1440px]">
      <main class="min-w-0 flex-1 px-5 pt-8 pb-32 sm:px-8 lg:order-2 lg:pt-10 lg:pr-10 lg:pl-[clamp(2rem,4vw,4.5rem)]">
        <slot />
      </main>

      <!-- Present on every page, so the text column keeps one position from page to page. -->
      <aside
        aria-label="On this page"
        class="sticky top-0 order-3 hidden h-svh w-[15rem] shrink-0 flex-col pt-10 pr-8 xl:flex"
      >
        <template v-if="toc.length">
          <p class="flex h-7 items-center text-[12.5px] text-dimmed">
            On this page
          </p>
          <div class="d-scroll -mx-4 mt-3 min-h-0 flex-1 px-4 pb-10">
            <DocsToc />
            <a
              href="#"
              class="mt-5 ml-5 inline-flex text-[12.5px] text-dimmed transition-[opacity,color,transform] duration-300 ease-(--d-ease) hover:text-default"
              :class="reading ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-1 opacity-0'"
              :tabindex="reading ? 0 : -1"
              @click.prevent="toTop"
            >Back to top</a>
          </div>
        </template>
      </aside>

      <aside
        id="docs-menu"
        class="docs-menu fixed inset-x-0 top-14 bottom-0 z-30 flex flex-col bg-default px-5 lg:sticky lg:top-0 lg:order-1 lg:z-auto lg:h-svh lg:w-[17rem] lg:shrink-0 lg:pr-6 lg:pl-[clamp(1.25rem,3vw,3rem)]"
        :data-open="menuOpen"
      >
        <div class="shrink-0 pt-5 pb-3 lg:pt-10">
          <div class="mb-5 hidden h-7 items-center gap-2.5 lg:flex">
            <NuxtLink :to="prefixLink('/', content.routeBase)" aria-label="evlog home" class="rounded-(--d-r-sm)">
              <DocsLogo />
            </NuxtLink>
            <DocsVersionSelect />
          </div>
          <!-- -mx-2 lines the card up with the sidebar's highlight; each row's 7px + 1px border puts its glyph on the text column. -->
          <div class="d-card -mx-2 flex flex-col divide-y divide-(--d-line) overflow-hidden rounded-[10px] border border-(--d-line) bg-(--d-raised)">
            <DocsSearchButton />
            <DocsFrameworkSelect v-if="content.mode !== 'version'" />
          </div>
        </div>

        <div class="d-scroll -mx-4 min-h-0 flex-1 px-4 pt-4 pb-12">
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
