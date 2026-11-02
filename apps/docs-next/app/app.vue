<script setup lang="ts">
import type { NavigationItem } from 'comark-content'

const content = useDocsContent()
const route = useRoute()

const { data: navigation } = await useAsyncData('navigation', () => content.value.client.navigation(), {
  watch: [() => content.value.routeBase],
})

// Client-only: an SSR value gets baked into the page's ISR entry and would pin search to a stale commit.
const { data: sha } = useAsyncData(
  () => `content-head:${content.value.apiBase}`,
  () => $fetch<{ sha: string | null }>(`${content.value.apiBase}/head`).then(({ sha }) => sha),
  { server: false, watch: [() => content.value.apiBase] }
)

const navTree = computed<NavigationItem[]>(() => prefixNavigation(navigation.value ?? [], content.value.routeBase))

provide('navigation', navTree)
provide('sha', sha)

const isLanding = computed(() => route.name === 'index' || route.name === 'landing-version')

useHead({
  htmlAttrs: { lang: 'en' },
  link: [{ rel: 'icon', href: '/favicon.ico' }],
})

useSeoMeta({
  titleTemplate: '%s · evlog',
  ogSiteName: 'evlog',
  twitterCard: 'summary_large_image',
})
</script>

<template>
  <UApp>
    <NuxtLoadingIndicator :height="1" color="var(--ui-text-highlighted)" />

    <template v-if="isLanding">
      <LandingHeader />
      <NuxtPage />
    </template>

    <DocsShell v-else>
      <NuxtPage />
    </DocsShell>

    <ClientOnly>
      <AppSearch :navigation="navTree" />
    </ClientOnly>
  </UApp>
</template>
