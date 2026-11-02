<script setup lang="ts">
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
const tree = computed(() => {
  const p = page.value
  return p ? { ...p, nodes: prefixTreeLinks(p.nodes, content.value.routeBase) } : p
})
const fm = computed<Record<string, any>>(() => page.value?.data ?? {})
const surround = computed(() => findSurroundLinks(navigation?.value, selfPath.value))

// The sidebar lists the current page's sections under its entry.
const toc = useState<TocLink[]>('docs-toc', () => [])
const publishToc = usePublishToc()
watchEffect(() => publishToc(page.value))

useDocsScrollSpy(() => toc.value.map(link => link.id))

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
  <article v-if="page" class="mx-auto max-w-[41rem] text-[15px]/[1.7] text-muted">
    <div class="mb-5 flex h-7 items-center justify-between gap-4 text-[13px]">
      <NuxtLink
        v-if="place?.to"
        :to="place.to"
        class="text-dimmed transition-colors duration-150 hover:text-default"
      >
        {{ place.label }}
      </NuxtLink>
      <span v-else class="text-dimmed">{{ place?.label }}</span>

      <DocsCopyButton v-if="content.mode === 'prod'" label="Copy page" :source="copyPage" class="-mr-2" />
    </div>

    <h1 class="text-[32px]/[1.15] font-medium tracking-[-0.025em] text-balance text-highlighted">
      {{ fm.title }}
    </h1>
    <p v-if="fm.description" class="mt-4 mb-6 text-[17px]/[1.6] text-pretty text-default">
      {{ fm.description }}
    </p>
    <DocsFrameworkHint v-if="pageFramework && content.mode !== 'version'" :framework="pageFramework" />

    <MarkdownDocument
      v-if="tree"
      :value="tree"
      :components
    />

    <footer class="mt-24 text-[14px]">
      <nav aria-label="Pages" class="grid grid-cols-2 gap-3">
        <NuxtLink
          v-if="surround[0]"
          :to="surround[0].path"
          class="group/prev rounded-(--d-r-lg) border border-(--d-line) px-4 py-3.5 transition-[background-color,border-color,transform] duration-150 hover:border-(--d-line-strong) hover:bg-(--d-raised) active:scale-[0.99]"
        >
          <span class="block text-[13px] text-dimmed">Previous</span>
          <span class="inline-block text-highlighted transition-transform duration-200 ease-(--d-ease) group-hover/prev:-translate-x-0.5">{{ surround[0].title }}</span>
        </NuxtLink>
        <span v-else />
        <NuxtLink
          v-if="surround[1]"
          :to="surround[1].path"
          class="group/next rounded-(--d-r-lg) border border-(--d-line) px-4 py-3.5 text-right transition-[background-color,border-color,transform] duration-150 hover:border-(--d-line-strong) hover:bg-(--d-raised) active:scale-[0.99]"
        >
          <span class="block text-[13px] text-dimmed">Next</span>
          <span class="inline-block text-highlighted transition-transform duration-200 ease-(--d-ease) group-hover/next:translate-x-0.5">{{ surround[1].title }}</span>
        </NuxtLink>
      </nav>

      <div class="mt-8 flex gap-5 px-1 text-[13px] text-dimmed">
        <NuxtLink v-if="editUrl" :to="editUrl" target="_blank" class="transition-colors hover:text-highlighted">
          Edit on GitHub
        </NuxtLink>
        <NuxtLink v-if="content.mode === 'prod'" :to="`${rawPrefix}${selfPath}.md`" external target="_blank" class="transition-colors hover:text-highlighted">
          Markdown
        </NuxtLink>
      </div>
    </footer>
  </article>
</template>
