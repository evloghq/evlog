<script setup lang="ts">
import { useResizeObserver } from '@vueuse/core'
import type { SidebarBlock, SidebarItem } from '~/composables/useDocsSidebar'

const route = useRoute()
const content = useDocsContent()
const blocks = useDocsSidebar()

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

// One highlight sits behind the current page and slides to the next one. Until it is placed, the
// current link draws its own, so the server's page already shows where the reader is.
const marker = reactive({ x: 0, y: 0, w: 0, h: 0, placed: false, travels: false })

function place() {
  const el = nav.value
  const current = el?.querySelector<HTMLElement>('[aria-current="page"]')
  if (!el || !current) {
    marker.placed = false
    return
  }
  const from = el.getBoundingClientRect()
  const to = current.getBoundingClientRect()
  marker.x = to.left - from.left
  marker.y = to.top - from.top
  marker.w = to.width
  marker.h = to.height
  marker.placed = true
}

// A fainter highlight follows the pointer from entry to entry, so the list answers before a click.
const hover = reactive({ x: 0, y: 0, w: 0, h: 0, on: false, travels: false })

function onOver(event: PointerEvent) {
  if (event.pointerType !== 'mouse') return
  const el = nav.value
  const link = (event.target as HTMLElement).closest<HTMLElement>('a')
  if (!el || !link || link.getAttribute('aria-current') === 'page') {
    hover.on = false
    return
  }
  const from = el.getBoundingClientRect()
  const to = link.getBoundingClientRect()
  // Appearing is not travelling: it fades in under the pointer.
  if (!hover.on) hover.travels = false
  Object.assign(hover, { x: to.left - from.left, y: to.top - from.top, w: to.width, h: to.height, on: true })
  requestAnimationFrame(() => {
    hover.travels = true
  })
}

watch(() => route.path, () => nextTick(place), { flush: 'post' })
// Folding groups and sections move the entries below them; the marker follows.
useResizeObserver(nav, place)

onMounted(() => {
  place()
  requestAnimationFrame(() => {
    marker.travels = true
  })
  const scroller = nav.value?.closest<HTMLElement>('.d-scroll')
  const current = nav.value?.querySelector<HTMLElement>('[aria-current="page"]')
  if (scroller && current && current.offsetTop > scroller.clientHeight * 0.7) {
    scroller.scrollTop = current.offsetTop - scroller.clientHeight / 3
  }
})
</script>

<template>
  <nav
    ref="nav"
    aria-label="Documentation"
    class="relative isolate flex flex-col gap-6 text-[14px]"
    :data-folding="folding || undefined"
    @pointerover="onOver"
    @pointerleave="hover.on = false"
  >
    <span
      aria-hidden="true"
      class="pointer-events-none absolute top-0 left-0 -z-10 rounded-(--d-r-md) bg-(--d-raised)"
      :class="[hover.on ? 'opacity-100' : 'opacity-0', hover.travels ? 'transition-[transform,width,height,opacity] duration-200 ease-(--d-ease) motion-reduce:transition-none' : 'transition-opacity duration-150']"
      :style="{ transform: `translate(${hover.x}px, ${hover.y}px)`, width: `${hover.w}px`, height: `${hover.h}px` }"
    />
    <span
      aria-hidden="true"
      class="pointer-events-none absolute top-0 left-0 -z-10 rounded-(--d-r-md) bg-(--d-raised-strong)"
      :class="[marker.placed ? 'opacity-100' : 'opacity-0', marker.travels ? 'transition-[transform,width,height,opacity] duration-[300ms] ease-(--d-ease) motion-reduce:transition-none' : '']"
      :style="{ transform: `translate(${marker.x}px, ${marker.y}px)`, width: `${marker.w}px`, height: `${marker.h}px` }"
    />

    <div v-for="(block, index) in blocks" :key="block.label ?? index">
      <button
        v-if="block.label"
        type="button"
        class="group/label mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-dimmed transition-colors duration-150 hover:text-muted disabled:cursor-default disabled:hover:text-dimmed"
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
          <ul class="flex flex-col gap-px">
            <li v-for="item in block.items" :key="item.path" :data-fw-item="frameworkItem(item)">
              <NuxtLink
                :to="item.path"
                :aria-current="isCurrent(item) ? 'page' : undefined"
                class="-mx-2.5 block rounded-(--d-r-md) px-2.5 py-[5px] transition-colors duration-150"
                :class="[
                  isCurrent(item) || (item.children.length && isWithin(item)) ? 'text-highlighted' : 'text-muted hover:text-highlighted',
                  isCurrent(item) && !marker.placed ? 'bg-(--d-raised-strong)' : '',
                ]"
              >
                {{ item.title }}
              </NuxtLink>

              <div v-if="item.children.length" class="d-fold" :data-open="isWithin(item)" :inert="!isWithin(item)">
                <div>
                  <!-- The tree evlog prints its events with: the way to the current page is lit. -->
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
                        class="-mr-2.5 -ml-2 block rounded-(--d-r-md) py-1 pr-2.5 pl-2 text-[13.5px]/5 transition-colors duration-150"
                        :class="[
                          isCurrent(child) ? 'text-highlighted' : 'text-muted hover:text-highlighted',
                          isCurrent(child) && !marker.placed ? 'bg-(--d-raised-strong)' : '',
                        ]"
                      >
                        {{ child.title }}
                      </NuxtLink>
                    </li>
                  </ul>
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
