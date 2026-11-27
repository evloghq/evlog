<script setup lang="ts">
import { useResizeObserver } from '@vueuse/core'
import { holds, trail, type SidebarItem, type Trail } from '~/composables/useDocsSidebar'

const route = useRoute()
const router = useRouter()
const content = useDocsContent()
const blocks = useDocsSidebar()

const nav = useTemplateRef<HTMLElement>('nav')

function isCurrent(item: SidebarItem) {
  return route.path === item.path
}

function isWithin(item: SidebarItem) {
  return holds(item, route.path)
}

// Under Integrations, a framework's page is listed for the reader who chose that framework, wherever
// they are. Every framework's row is rendered and the global `data-fw-item` CSS shows the chosen one
// before first paint; the page being read is always shown.
const frameworkOf = computed(() => new Map(
  Object.entries(frameworkPages).map(([id, page]) => [prefixLink(page, content.value.routeBase), id]),
))

function listed(item: SidebarItem) {
  return flattenPages(listedChildren(item, route.path, child => frameworkOf.value.has(child.path)))
}

function frameworkItem(child: SidebarItem) {
  return isCurrent(child) ? undefined : frameworkOf.value.get(child.path)
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

// Read from the route, not `aria-current`: the router marks the link a moment after the sidebar has
// already opened the new page's list.
function currentLink() {
  return [...nav.value?.querySelectorAll<HTMLElement>('a[href]') ?? []].find(link => link.getAttribute('href') === route.path && link.getClientRects().length)
}

// The event's path is drawn from where its rows are, so the line meets every stop and elbow exactly.
const path = ref<Trail>()

function centre(link: Element, frame: DOMRect) {
  const box = link.getBoundingClientRect()
  return Math.round(box.top + box.height / 2 - frame.top) + 0.5
}

// A nested page counts while its row is visible: hidden by the framework choice, or clipped by its list
// opening or closing, it has no elbow yet.
function shown(link: Element) {
  if (!link.getClientRects().length) return false
  const box = link.getBoundingClientRect()
  return box.top + box.height / 2 < link.closest('ul')!.getBoundingClientRect().bottom
}

function drawPath() {
  const list = nav.value?.querySelector<HTMLElement>('.d-steps')
  if (!list) return (path.value = undefined)
  const frame = list.getBoundingClientRect()
  path.value = trail([...list.children].map(row => ({
    y: centre(row.querySelector(':scope > a')!, frame),
    current: row.querySelector(':scope > a')!.getAttribute('href') === route.path,
    children: [...row.querySelectorAll(':scope > ul > li > a')].filter(link => shown(link)).map(link => ({
      y: centre(link, frame),
      end: Math.round(link.getBoundingClientRect().left - frame.left),
      current: link.getAttribute('href') === route.path,
    })),
  })))
}

function place() {
  drawPath()
  const current = currentLink()
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

// A step's nested pages open and close by height. While they do, the rows below move every frame, so
// the highlight and the path are placed every frame instead of sliding on their own.
let following = 0
function follow(ms: number) {
  const until = performance.now() + ms
  const run = following === 0
  following = Math.max(following, until)
  if (!run) return
  marker.travels = false
  const frame = () => {
    if (!pending.value) place()
    if (performance.now() < following) requestAnimationFrame(frame)
    else following = 0
  }
  requestAnimationFrame(frame)
}

const reduced = import.meta.client ? window.matchMedia('(prefers-reduced-motion: reduce)') : undefined
const FOLD = 240

function fold(el: Element, opening: boolean, done: () => void) {
  const list = el as HTMLElement
  if (reduced?.matches) return done()
  const full = { height: `${opening ? list.scrollHeight : list.offsetHeight}px`, paddingTop: '', paddingBottom: '' }
  const shut = { height: '0px', paddingTop: '0px', paddingBottom: '0px' }
  Object.assign(list.style, opening ? shut : full, { overflow: 'hidden' })
  void list.offsetHeight
  const ease = `${FOLD}ms var(--d-ease)`
  Object.assign(list.style, { transition: `height ${ease}, padding ${ease}` }, opening ? full : shut)
  follow(FOLD + 40)
  const end = (event: TransitionEvent) => {
    if (event.target !== list || event.propertyName !== 'height') return
    list.removeEventListener('transitionend', end)
    Object.assign(list.style, { height: '', paddingTop: '', paddingBottom: '', overflow: '', transition: '' })
    done()
  }
  list.addEventListener('transitionend', end)
}

function open(el: Element, done: () => void) {
  fold(el, true, done)
}

function close(el: Element, done: () => void) {
  fold(el, false, done)
}

// The sidebar is longer than the screen: a page reached from search or a link shows its entry.
function reveal() {
  const scroller = nav.value?.closest<HTMLElement>('.d-scroll')
  const current = currentLink()
  if (scroller && current) scroller.scrollTop += revealDistance(scroller.getBoundingClientRect(), current.getBoundingClientRect())
}

watch(() => route.path, () => {
  pending.value = undefined
  nextTick(() => {
    place()
    reveal()
  })
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
  reveal()
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

    <div v-for="(block, index) in blocks" :key="block.label ?? index" :class="block.steps ? 'relative' : ''">
      <svg v-if="block.steps && path" class="d-trail" aria-hidden="true">
        <path :d="path.line" />
        <path v-if="path.lit" :key="route.path" class="d-trail-lit" :d="path.lit" pathLength="1" />
        <template v-for="(stop, i) in path.stops" :key="i">
          <circle v-if="stop.state === 'here'" class="d-trail-halo" cx="6.5" :cy="stop.y" r="8" />
          <circle :class="`d-trail-stop is-${stop.state}`" cx="6.5" :cy="stop.y" r="4.5" />
          <path :class="`d-trail-fill is-${stop.state}`" :d="stop.fill" />
        </template>
      </svg>
      <p v-if="block.label" :id="`docs-nav-${index}`" class="mb-2 text-[12px]/4 font-medium text-dimmed">
        {{ block.label }}
      </p>

      <ul :aria-labelledby="block.label ? `docs-nav-${index}` : undefined" :class="block.steps ? 'd-steps' : ''">
        <li
          v-for="item in block.items"
          :key="item.path"
        >
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
          <Transition :css="false" @enter="open" @leave="close">
            <ul v-if="listed(item).length" class="d-rail" :data-fw-list="listed(item).every(frameworkItem) || undefined">
              <li
                v-for="(child, i) in listed(item)"
                :key="child.path"
                :data-fw-item="frameworkItem(child)"
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
          </Transition>
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
