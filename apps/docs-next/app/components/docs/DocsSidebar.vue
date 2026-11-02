<script setup lang="ts">
import type { SidebarBlock, SidebarItem } from '~/composables/useDocsSidebar'

const route = useRoute()
const content = useDocsContent()
const blocks = useDocsSidebar()
const tocs = useState<Record<string, { id: string, text: string }[]>>('docs-tocs', () => ({}))

const nav = useTemplateRef<HTMLElement>('nav')

// A cookie, so the server renders folded groups folded and nothing moves on load.
const folded = useCookie<string[]>('docs-folded', { default: () => [], maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })

// Folding animates only while the reader folds a group; navigation changes the sidebar instantly.
const folding = ref(false)
let foldTimer: ReturnType<typeof setTimeout> | undefined

function isCurrent(item: SidebarItem) {
  return route.path === item.path
}

function isWithin(item: SidebarItem) {
  return route.path === item.path || route.path.startsWith(`${item.path}/`)
}

// Once the reader picks a framework, the other frameworks' pages leave the sidebar; the page being
// read always stays. The global `data-fw-item` CSS hides them before first paint.
const frameworkOf = computed(() => new Map(
  Object.entries(frameworkPages).map(([id, page]) => [prefixLink(page, content.value.routeBase), id]),
))

function frameworkItem(item: SidebarItem) {
  return isWithin(item) ? undefined : frameworkOf.value.get(item.path)
}

function tocOf(item: SidebarItem) {
  return item.children.length ? undefined : tocs.value[item.path]
}

function holdsCurrent(block: SidebarBlock) {
  return block.items.some(isWithin)
}

function isOpen(block: SidebarBlock) {
  return !block.label || holdsCurrent(block) || !folded.value.includes(block.label)
}

function toggle(block: SidebarBlock) {
  if (!block.label || holdsCurrent(block)) return
  folding.value = true
  clearTimeout(foldTimer)
  foldTimer = setTimeout(() => {
    folding.value = false
  }, 340)
  folded.value = folded.value.includes(block.label)
    ? folded.value.filter(label => label !== block.label)
    : [...folded.value, block.label]
}

onMounted(() => {
  const scroller = nav.value?.closest<HTMLElement>('.d-scroll')
  const current = nav.value?.querySelector<HTMLElement>('[aria-current="page"]')
  if (scroller && current && current.offsetTop > scroller.clientHeight * 0.7) {
    scroller.scrollTop = current.offsetTop - scroller.clientHeight / 3
  }
})
</script>

<template>
  <nav ref="nav" aria-label="Documentation" class="flex flex-col gap-6 text-[14px]" :data-folding="folding || undefined">
    <div v-for="(block, index) in blocks" :key="block.label ?? index">
      <button
        v-if="block.label"
        type="button"
        class="group/label -ml-1 mb-1 flex items-center gap-1.5 rounded-(--d-r-sm) px-1 py-0.5 text-[12.5px] text-dimmed transition-colors duration-150 hover:text-muted disabled:cursor-default disabled:hover:text-dimmed"
        :aria-expanded="isOpen(block)"
        :disabled="holdsCurrent(block)"
        @click="toggle(block)"
      >
        {{ block.label }}
        <svg
          viewBox="0 0 10 10"
          class="size-2.5 opacity-0 transition-[transform,opacity] duration-200 ease-(--d-ease) group-hover/label:opacity-100 group-disabled/label:hidden"
          :class="isOpen(block) ? 'rotate-0' : '-rotate-90 opacity-100'"
          fill="none"
          aria-hidden="true"
        >
          <path d="M2.5 4 5 6.5 7.5 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>

      <div class="d-collapse -mx-4" :data-open="isOpen(block)" :inert="!isOpen(block)">
        <div class="px-4">
          <ul class="flex flex-col">
            <li v-for="item in block.items" :key="item.path" class="relative" :data-lit="isCurrent(item) || undefined" :data-fw-item="frameworkItem(item)">
              <NuxtLink
                :to="item.path"
                :aria-current="isCurrent(item) ? 'page' : undefined"
                class="-mx-2 block rounded-[6px] px-2 py-[5px] transition-colors duration-150"
                :class="isCurrent(item) ? 'bg-(--d-raised-strong) text-highlighted' : isWithin(item) ? 'text-highlighted' : 'text-muted hover:text-highlighted'"
              >
                {{ item.title }}
              </NuxtLink>

              <div v-if="item.children.length" class="d-fold" :data-open="isWithin(item)" :inert="!isWithin(item)">
                <div>
                  <ul class="d-rail">
                    <li
                      v-for="(child, i) in item.children"
                      :key="child.path"
                      :data-lit="isCurrent(child) || undefined"
                      :data-path="i < item.children.findIndex(isCurrent) || undefined"
                    >
                      <NuxtLink
                        :to="child.path"
                        :aria-current="isCurrent(child) ? 'page' : undefined"
                        class="-ml-2 block rounded-[6px] py-1 pr-2 pl-2 text-[13.5px]/5 transition-colors duration-150"
                        :class="isCurrent(child) ? 'bg-(--d-raised-strong) text-highlighted' : 'text-muted hover:text-highlighted'"
                      >
                        {{ child.title }}
                      </NuxtLink>

                      <div v-if="tocOf(child)?.length" class="d-fold xl:hidden" :data-open="isCurrent(child)" :inert="!isCurrent(child)">
                        <div>
                          <DocsToc rail :links="tocOf(child)" />
                        </div>
                      </div>
                    </li>
                  </ul>
                </div>
              </div>

              <div v-else-if="tocOf(item)?.length" class="d-fold xl:hidden" :data-open="isCurrent(item)" :inert="!isCurrent(item)">
                <div>
                  <DocsToc rail :links="tocOf(item)" />
                </div>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <p v-if="content.mode === 'version'" class="text-[13px]/5 text-dimmed">
      These are the docs for evlog 2.
      <NuxtLink to="/start/introduction" class="text-muted underline decoration-(--d-line-strong) underline-offset-4 hover:text-highlighted">
        Read the evlog 3 docs
      </NuxtLink>
    </p>
  </nav>
</template>
