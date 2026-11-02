<script setup lang="ts">
// The landing belongs to the site, not to a version: `/v2` renders the same page as `/`, read from the
// version served at the root, so its links always lead to the current docs.
const { data: page } = await useAsyncData('landing', () => prodContent.get('/'))
if (!page.value) {
  throw createError({ statusCode: 404, statusMessage: 'Landing page not found', fatal: true })
}

const fm = computed<Record<string, any>>(() => page.value?.data ?? {})

useHead({
  titleTemplate: '',
  link: [{ rel: 'preload', href: '/fonts/GeistPixel-Line.woff2', as: 'font', type: 'font/woff2', crossorigin: '' },],
})

useSeoMeta({
  title: () => fm.value.seo?.title || fm.value.title,
  description: () => fm.value.seo?.description || fm.value.description,
  ogTitle: () => fm.value.seo?.title || fm.value.title,
  ogDescription: () => fm.value.seo?.description || fm.value.description,
  ogImage: '/og.png',
  ogImageWidth: 1200,
  ogImageHeight: 630,
  twitterSite: '@hugorcd',
  twitterCreator: '@hugorcd',
})
</script>

<template>
  <main>
    <MarkdownDocument
      v-if="page"
      :value="page"
    />
  </main>
</template>
