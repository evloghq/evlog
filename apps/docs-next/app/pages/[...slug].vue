<script setup lang="ts">
import { useIntersectionObserver } from '@vueuse/core'
import { joinURL } from 'ufo'
import type { NavigationItem } from 'comark-content'
import {
  ProseAccordion,
  ProseAccordionItem,
  ProseBadge,
  ProseCard,
  ProseCardGroup,
  ProseCodeCollapse,
  ProseCollapsible,
  ProseEm,
  ProseField,
  ProseFieldGroup,
  ProseImg,
  ProseKbd,
  ProseSteps,
  ProseTabs,
  ProseTabsItem,
  DocsA,
  DocsBlockquote,
  DocsCallout,
  DocsCaution,
  DocsCode,
  DocsH2,
  DocsH3,
  DocsH4,
  DocsHr,
  DocsLi,
  DocsNote,
  DocsOl,
  DocsP,
  DocsPre,
  DocsStrong,
  DocsTable,
  DocsTbody,
  DocsTd,
  DocsTh,
  DocsThead,
  DocsTip,
  DocsTr,
  DocsUl,
  DocsWarning,
  DocsCodeGroup,
} from '#components'

definePageMeta({
  path: '/:slug(.+)',
})

// Typography is the docs' own. Nuxt UI keeps the interactive pieces (tabs, accordions, steps).
const components = {
  ProseA: DocsA,
  ProseBlockquote: DocsBlockquote,
  ProseCallout: DocsCallout,
  ProseCaution: DocsCaution,
  ProseCode: DocsCode,
  ProseH2: DocsH2,
  ProseH3: DocsH3,
  ProseH4: DocsH4,
  ProseHr: DocsHr,
  ProseLi: DocsLi,
  ProseNote: DocsNote,
  ProseOl: DocsOl,
  ProseP: DocsP,
  ProsePre: DocsPre,
  ProseStrong: DocsStrong,
  ProseTable: DocsTable,
  ProseTbody: DocsTbody,
  ProseTd: DocsTd,
  ProseTh: DocsTh,
  ProseThead: DocsThead,
  ProseTip: DocsTip,
  ProseTr: DocsTr,
  ProseUl: DocsUl,
  ProseWarning: DocsWarning,
  ProseAccordion,
  ProseAccordionItem,
  ProseBadge,
  ProseCard,
  ProseCardGroup,
  ProseCodeCollapse,
  ProseCodeGroup: DocsCodeGroup,
  ProseCollapsible,
  ProseEm,
  ProseField,
  ProseFieldGroup,
  ProseImg,
  ProseKbd,
  ProseSteps,
  ProseTabs,
  ProseTabsItem,
}

const navigation = inject<Ref<NavigationItem[]>>('navigation')
const content = useDocsContent()

const { data: page } = await useDocsPage()
if (!page.value) {
  // A directory without an index page redirects to its first page.
  const firstLeaf = findFirstLeaf(navigation?.value, prefixLink(content.value.path, content.value.routeBase))
  if (firstLeaf) {
    await navigateTo(firstLeaf, { redirectCode: 302 })
  } else {
    throw createError({ statusCode: 404, statusMessage: 'Page not found', fatal: true })
  }
}

const selfPath = computed(() => prefixLink(content.value.path, content.value.routeBase))
// A page's `::product-facts` is drawn by the header, not where it sits in the body.
const split = computed(() => takeFacts(page.value?.nodes ?? []))
const tree = computed(() => {
  const p = page.value
  return p ? { ...p, nodes: prefixTreeLinks(split.value.nodes, content.value.routeBase) } : p
})
const fm = computed<Record<string, any>>(() => page.value?.data ?? {})
const surround = computed(() => findSurroundLinks(navigation?.value, selfPath.value))

// Read from this page's own data, so the list never shows the next page's sections while it loads.
const toc = computed<TocLink[]>(() =>
  ((page.value?.meta as { toc?: { links?: TocLink[] } } | undefined)?.toc?.links ?? []).map(({ id, text }) => ({ id, text })))

const publishEvent = usePublishEvent()
watchEffect(() => publishEvent(page.value))

const sections = computed(() => toc.value.map(link => link.id))
useDocsScrollSpy(sections)
provide('docs-sections', sections)

const reading = useDocsReading()
const section = computed(() => toc.value.find(link => link.id === reading.value))

const { github } = useAppConfig()
const { current } = useDocsVersions()
const editUrl = computed(() => {
  const meta = page.value?.meta as { stem?: string, extension?: string } | undefined
  if (!github?.url || !meta?.stem) return undefined
  const branch = current.value?.branch ?? github.branch ?? 'main'
  const dir = current.value?.contentDir ?? github.contentDir ?? 'content'
  return `${github.url}/edit/${branch}/${dir}/${meta.stem}${meta.extension ?? '.md'}`
})

const site = useSiteConfig()
const published = computed(() => ['prod', 'version'].includes(content.value.mode))
const canonicalUrl = computed(() =>
  joinURL(site.url, content.value.mode === 'version' ? selfPath.value : content.value.path)
)
const rawPrefix = useRuntimeConfig().public.agentDiscovery?.rawPrefix || '/raw'

// Where the page sits: its parent page when it has one, otherwise its sidebar group.
const blocks = useDocsSidebar()
const place = computed(() => {
  for (const block of blocks.value) {
    for (const item of block.items) {
      if (item.children.some(child => child.path === selfPath.value)) return { label: item.title, to: item.path }
      if (item.path === selfPath.value) return { label: block.label ?? 'Get started' }
    }
  }
  return undefined
})

const pageFramework = computed(() => Object.entries(frameworkPages)
  .find(([, path]) => prefixLink(path, content.value.routeBase) === selfPath.value)?.[0])

// Read once, so the page being left does not replay its entrance while the next one loads.
const arrived = useDocsNavigated().value

// The top bar names the page only once its title has scrolled under the bar.
const title = useTemplateRef<HTMLElement>('title')
const titleGone = ref(false)
useIntersectionObserver(title, ([entry]) => {
  titleGone.value = Boolean(entry) && !entry!.isIntersecting && entry!.boundingClientRect.top < 56
}, { rootMargin: '-56px 0px 0px 0px' })
const copyPage = () => $fetch<string>(`${rawPrefix}${selfPath.value}.md`, { responseType: 'text' })

useRobotsRule(computed(() => (published.value ? 'index, follow' : 'noindex, nofollow')))
useSeoMeta({
  title: () => fm.value.seo?.title || fm.value.title,
  description: () => fm.value.seo?.description || fm.value.description,
  ogTitle: () => fm.value.seo?.title || fm.value.title,
  ogDescription: () => fm.value.seo?.description || fm.value.description,
  ogUrl: canonicalUrl,
})
useHead({ link: [{ rel: 'canonical', href: canonicalUrl }] })
</script>

<template>
  <div v-if="page" class="d-dock-scope">
    <!-- Meets the sidebar's logo row, so one hairline runs across the whole window. -->
    <div class="sticky top-0 z-20 hidden h-14 items-center justify-between gap-4 border-b border-(--d-line) bg-default/90 px-8 backdrop-blur-md lg:flex">
      <nav aria-label="Breadcrumb" class="flex min-w-0 items-center gap-2 text-[13px]">
        <NuxtLink
          v-if="place?.to"
          :to="place.to"
          class="text-dimmed transition-colors duration-150 hover:text-highlighted"
        >
          {{ place.label }}
        </NuxtLink>
        <span v-else class="text-dimmed">{{ place?.label }}</span>
        <span class="d-xfade d-dock flex min-w-0 items-center gap-2" :data-on="titleGone" :aria-hidden="!titleGone">
          <span aria-hidden="true" class="text-(--d-line-strong)">/</span>
          <span class="truncate text-default">{{ fm.title }}</span>
        </span>
        <!-- The path grows with the reader: the section they are in follows the page. -->
        <span class="d-xfade flex min-w-0 shrink-[99] items-center gap-2" :data-on="titleGone && Boolean(section)" aria-hidden="true">
          <span class="text-(--d-line-strong)">/</span>
          <span class="d-stack min-w-0">
            <Transition name="d-swap">
              <span :key="section?.id" class="min-w-0 truncate text-muted">{{ section?.text }}</span>
            </Transition>
          </span>
        </span>
      </nav>

      <div class="-mr-2 flex items-center gap-1 text-[12.5px]">
        <DocsCopyButton v-if="content.mode === 'prod'" label="Copy page" :source="copyPage" />
        <NuxtLink
          v-if="editUrl"
          :to="editUrl"
          target="_blank"
          class="inline-flex h-7 items-center rounded-(--d-r-md) px-2 text-dimmed transition-colors duration-150 hover:bg-(--d-raised-strong) hover:text-highlighted"
        >
          Edit
        </NuxtLink>
      </div>

      <span aria-hidden="true" class="docs-progress" />
    </div>

    <div class="mx-auto flex w-full max-w-[74rem] justify-center gap-14 px-5 sm:px-8 xl:justify-between">
      <article class="w-full max-w-[44rem] min-w-0 pt-10 pb-32 text-[15px]/[1.7] text-muted lg:pt-14" :class="arrived ? 'd-page-in' : ''">
        <!-- Below lg the top bar is gone, so the page says where it sits itself. -->
        <p v-if="place" class="mb-3 text-[13px] text-dimmed lg:hidden">
          <NuxtLink v-if="place.to" :to="place.to">
            {{ place.label }}
          </NuxtLink>
          <template v-else>
            {{ place.label }}
          </template>
        </p>
        <h1
          ref="title"
          class="d-dock-title text-[30px]/[1.15] font-[560] tracking-[-0.03em] text-balance text-highlighted sm:text-[34px]/[40px]"
          :style="{ marginLeft: `-${opticalHang(fm.title ?? '')}em` }"
        >
          {{ fm.title }}
        </h1>
        <p v-if="fm.description" class="mt-3.5 max-w-[38rem] text-[17px]/[27px] text-pretty text-default">
          {{ fm.description }}
        </p>
        <DocsPageEvent :path="selfPath" :facts="split.facts" />
        <DocsFrameworkHint v-if="pageFramework && content.mode !== 'version'" :framework="pageFramework" />

        <MarkdownDocument
          v-if="tree"
          :value="tree"
          :components
        />

        <footer class="mt-20">
          <nav aria-label="Pages" class="grid grid-cols-2 gap-3">
            <NuxtLink
              v-if="surround[0]"
              :to="surround[0].path"
              class="group/prev rounded-(--d-r-lg) border border-(--d-line) px-4 pt-3 pb-3.5 transition-colors duration-200 hover:border-(--d-line-strong) hover:bg-(--d-raised)"
            >
              <span class="block text-[12.5px] text-dimmed">Previous</span>
              <span class="mt-0.5 flex items-center gap-1.5 text-[14.5px] font-medium text-highlighted">
                <svg viewBox="0 0 12 12" class="size-3 text-dimmed transition-transform duration-300 ease-(--d-ease) group-hover/prev:-translate-x-0.5" fill="none" aria-hidden="true">
                  <path d="M7.5 2.5 4 6l3.5 3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                {{ surround[0].title }}
              </span>
            </NuxtLink>
            <span v-else />
            <NuxtLink
              v-if="surround[1]"
              :to="surround[1].path"
              class="group/next rounded-(--d-r-lg) border border-(--d-line) px-4 pt-3 pb-3.5 text-right transition-colors duration-200 hover:border-(--d-line-strong) hover:bg-(--d-raised)"
            >
              <span class="block text-[12.5px] text-dimmed">Next</span>
              <span class="mt-0.5 flex items-center justify-end gap-1.5 text-[14.5px] font-medium text-highlighted">
                {{ surround[1].title }}
                <svg viewBox="0 0 12 12" class="size-3 text-dimmed transition-transform duration-300 ease-(--d-ease) group-hover/next:translate-x-0.5" fill="none" aria-hidden="true">
                  <path d="M4.5 2.5 8 6 4.5 9.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </span>
            </NuxtLink>
          </nav>

          <NuxtLink
            v-if="content.mode === 'prod'"
            :to="`${rawPrefix}${selfPath}.md`"
            external
            target="_blank"
            class="mt-6 inline-block text-[13px] text-dimmed transition-colors hover:text-highlighted"
          >
            View as Markdown
          </NuxtLink>
        </footer>
      </article>

      <aside class="sticky top-14 hidden h-[calc(100svh-3.5rem)] w-[13.5rem] shrink-0 flex-col pt-14 xl:flex">
        <template v-if="toc.length">
          <p class="mb-3 text-[12px] font-medium text-dimmed">
            On this page
          </p>
          <div class="d-scroll -ml-2 min-h-0 flex-1 pb-10 pl-2">
            <DocsToc :links="toc" />
          </div>
        </template>
      </aside>
    </div>
  </div>
</template>
