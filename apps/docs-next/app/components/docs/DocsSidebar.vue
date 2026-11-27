<script setup lang="ts">
import { useResizeObserver } from '@vueuse/core'
import type { SidebarItem } from '~/composables/useDocsSidebar'

const route = useRoute()
const router = useRouter()
const content = useDocsContent()
const blocks = useDocsSidebar()

const nav = useTemplateRef<HTMLElement>('nav')

function isCurrent(item: SidebarItem) {
  return route.path === item.path
}

function isWithin(item: SidebarItem) {
  return route.path === item.path || route.path.startsWith(`${item.path}/`)
}

function listed(item: SidebarItem) {
  return isWithin(item) ? listedChildren(item, route.path) : []
}

// A framework's page is listed for the reader who chose that framework; the page being read always
// stays. The global `data-fw-item` CSS decides before first paint.
const frameworkOf = computed(() => new Map(
  Object.entries(frameworkPages).map(([id, page]) => [prefixLink(page, content.value.routeBase), id]),
))

function frameworkItem(item: SidebarItem) {
  return isWithin(item) ? undefined : frameworkOf.value.get(item.path)
}

// One highlight sits behind the current page. Until it is placed, the current link draws its own, so
// the server's page already shows where the reader is.
const marker = reactive({ x: 0, y: 0, w: 0, h: 0, placed: false, travels: false })
// The entry just clicked reads as current at once, before its page has loaded.
const pending = ref<string>()
let travelTimer: ReturnType<typeof setTimeout> | undefined

function moveTo(link: HTMLElement) {
  const from = nav.value!.getBoundingClientRect()
  const to = link.getBoundingClientRect()
  Object.assign(marker, { x: to.left - from.left, y: to.top - from.top, w: to.width, h: to.height, placed: true })
}

function place() {
  const current = nav.value?.querySelector<HTMLElement>('[aria-current="page"]')
  if (current) moveTo(current)
  else marker.placed = false
}

// The highlight slides only when the reader clicks an entry with a pointer, and starts on the click.
// Any other change of page (search, a link in the text, back, the keyboard) places it at once.
function onClick(event: MouseEvent) {
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="/"]')
  if (!link || event.detail === 0 || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  pending.value = link.getAttribute('href') ?? undefined
  marker.travels = true
  clearTimeout(travelTimer)
  travelTimer = setTimeout(() => {
    marker.travels = false
  }, 400)
  moveTo(link)
}

watch(() => route.path, () => {
  pending.value = undefined
  nextTick(place)
}, { flush: 'post' })

// A navigation that does not happen leaves the marker on the entry that was clicked: put it back.
const stopAfterEach = router.afterEach((to, _from, failure) => {
  if (!failure || to.path !== pending.value) return
  pending.value = undefined
  place()
})
onBeforeUnmount(() => {
  stopAfterEach()
  clearTimeout(travelTimer)
})

// A nested page appearing or leaving moves the entries below it; the marker follows.
useResizeObserver(nav, () => {
  if (!pending.value) place()
})

onMounted(() => {
  place()
  const scroller = nav.value?.closest<HTMLElement>('.d-scroll')
  const current = nav.value?.querySelector<HTMLElement>('[aria-current="page"]')
  if (scroller && current && current.offsetTop > scroller.clientHeight * 0.7) {
    scroller.scrollTop = current.offsetTop - scroller.clientHeight / 3
  }
})

function lit(item: SidebarItem) {
  return pending.value ? pending.value === item.path : isCurrent(item)
}
</script>

<template>
  <nav
    ref="nav"
    aria-label="Documentation"
    class="relative isolate flex flex-col gap-6 text-[14px]/5"
    @click="onClick"
  >
    <span
      aria-hidden="true"
      class="pointer-events-none absolute top-0 left-0 -z-10 rounded-(--d-r-md) bg-(--d-raised-strong)"
      :class="[marker.placed ? 'opacity-100' : 'opacity-0', marker.travels ? 'transition-transform duration-[160ms] ease-(--d-ease) motion-reduce:transition-none' : '']"
      :style="{ transform: `translate(${marker.x}px, ${marker.y}px)`, width: `${marker.w}px`, height: `${marker.h}px` }"
    />

    <div v-for="(block, index) in blocks" :key="block.label ?? index">
      <p v-if="block.label" :id="`docs-nav-${index}`" class="mb-2 text-[12px]/4 font-medium text-dimmed">
        {{ block.label }}
      </p>

      <ul :aria-labelledby="block.label ? `docs-nav-${index}` : undefined">
        <li v-for="item in block.items" :key="item.path" :data-fw-item="frameworkItem(item)">
          <NuxtLink
            :to="item.path"
            :aria-current="isCurrent(item) ? 'page' : undefined"
            class="-mx-2.5 block rounded-(--d-r-md) px-2.5 py-1"
            :class="[
              lit(item) || (item.children.length && isWithin(item)) ? 'text-highlighted' : 'text-muted hover:text-highlighted',
              isCurrent(item) && !marker.placed ? 'bg-(--d-raised-strong)' : '',
            ]"
          >
            {{ item.title }}
          </NuxtLink>

          <!-- The tree evlog prints its events with: the way to the current page is lit. -->
          <ul v-if="listed(item).length" class="d-rail">
            <li
              v-for="(child, i) in listed(item)"
              :key="child.path"
              :data-lit="isCurrent(child) || undefined"
              :data-path="i < listed(item).findIndex(isCurrent) || undefined"
            >
              <NuxtLink
                :to="child.path"
                :aria-current="isCurrent(child) ? 'page' : undefined"
                class="-mr-2.5 -ml-2 block rounded-(--d-r-md) py-[3px] pr-2.5 pl-2 text-[13px]/5"
                :class="[
                  lit(child) ? 'text-highlighted' : 'text-muted hover:text-highlighted',
                  isCurrent(child) && !marker.placed ? 'bg-(--d-raised-strong)' : '',
                ]"
              >
                {{ child.title }}
              </NuxtLink>
            </li>
          </ul>
        </li>
      </ul>
    </div>

    <p v-if="content.mode === 'version'" class="text-[13px]/5 text-dimmed">
      These are the docs for evlog 2.
      <NuxtLink to="/start/introduction" class="text-muted underline decoration-(--d-line-strong) underline-offset-4 hover:text-highlighted">
        Read the evlog 3 docs
      </NuxtLink>
    </p>
  </nav>
</template>
