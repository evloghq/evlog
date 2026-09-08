<script setup lang="ts">
const { data: page, error } = await useAsyncData('landing-page', () =>
  queryCollection('landing').path('/landing').first(),
)

if (error.value) {
  throw createError({ statusCode: 500, message: error.value.message })
}

if (!page.value) {
  throw createError({ statusCode: 404, statusMessage: 'Landing content not found' })
}

const tree = computed(() => {
  const body = toRaw(page.value?.body)
  if (!body || typeof body !== 'object' || !('value' in body)) return null
  return { nodes: body.value, frontmatter: {}, meta: {} }
})

const { public: pub } = useRuntimeConfig()
const docsUrl = pub.docsUrl || 'https://www.evlog.dev'
const siteUrl = pub.siteUrl || 'https://www.justfuckinguseevlog.com'

const pageData = page.value

function pickString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

useHead({
  htmlAttrs: { lang: 'en' },
  link: [
    { rel: 'manifest', href: '/site.webmanifest' },
    { rel: 'canonical', href: `${siteUrl}/` },
  ],
  script: [
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        'name': 'evlog',
        'description': pickString(pageData.description),
        'applicationCategory': 'DeveloperApplication',
        'operatingSystem': 'Any',
        'offers': { '@type': 'Offer', 'price': '0', 'priceCurrency': 'USD' },
        'url': siteUrl,
        'author': { '@type': 'Person', 'name': 'Hugo Richard', 'url': 'https://x.com/hugorcd' },
        'license': 'https://opensource.org/licenses/MIT',
      }),
    },
  ],
})

useSeoMeta({
  title: pickString(pageData.title),
  description: pickString(pageData.description),
  ogType: 'website',
  ogUrl: `${siteUrl}/`,
  ogTitle: pickString(pageData.ogTitle) || pickString(pageData.title),
  ogDescription: pickString(pageData.ogDescription) || pickString(pageData.description),
  ogImage: `${siteUrl}/og.jpg`,
  ogImageWidth: 1200,
  ogImageHeight: 630,
  twitterCard: 'summary_large_image',
  twitterSite: '@hugorcd',
  twitterImage: `${siteUrl}/og.jpg`,
})
</script>

<template>
  <div class="relative min-h-dvh text-default">
    <div class="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-white/3 rounded-full blur-3xl" aria-hidden="true" />
    <div class="relative z-10">
      <main class="mx-auto max-w-2xl px-6 pb-24 pt-14 md:px-8 md:pt-20 md:pb-32">
        <LandingComark v-if="tree" :value="tree" />
      </main>

      <footer class="border-t border-default px-6 py-10 md:px-8">
        <div class="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-y-4 text-xs text-muted">
          <span class="font-pixel text-[10px] tracking-widest uppercase">evlog · MIT</span>
          <div class="flex items-center gap-6">
            <NuxtLink
              :to="docsUrl"
              class="hover:text-highlighted transition-colors"
              target="_blank"
              rel="noopener noreferrer"
            >
              Docs
            </NuxtLink>
            <NuxtLink
              to="https://github.com/evloghq/evlog"
              class="hover:text-highlighted transition-colors"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </NuxtLink>
            <NuxtLink
              to="https://x.com/hugorcd"
              class="hover:text-highlighted transition-colors"
              target="_blank"
              rel="noopener noreferrer"
            >
              @hugorcd
            </NuxtLink>
          </div>
        </div>
      </footer>
    </div>
  </div>
</template>
