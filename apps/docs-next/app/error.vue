<script setup lang="ts">
import type { NavigationItem } from 'comark-content'
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()

const notFound = computed(() => props.error.status === 404)

useHead({ htmlAttrs: { lang: 'en' } })
useSeoMeta({ title: () => (notFound.value ? 'Page not found' : 'Something went wrong') })

const content = useDocsContent()
const { data: navigation } = await useAsyncData('navigation', () => content.value.client.navigation(), {
  watch: [() => content.value.routeBase],
})
provide('navigation', computed<NavigationItem[]>(() => prefixNavigation(navigation.value ?? [], content.value.routeBase)))
</script>

<template>
  <UApp>
    <DocsShell>
      <div class="mx-auto max-w-[44rem] px-6 pt-28 pb-24">
        <p class="font-mono text-[13px] text-dimmed">
          {{ error.status }}
        </p>
        <h1 class="mt-3 text-[28px]/[1.2] font-semibold tracking-[-0.02em] text-highlighted">
          {{ notFound ? 'This page does not exist' : 'Something went wrong' }}
        </h1>
        <p class="mt-4 text-[15px]/7 text-muted">
          {{ notFound ? 'It may have moved in the v3 docs. The sidebar and search cover every page.' : error.message }}
        </p>
        <NuxtLink to="/start/introduction" class="mt-8 inline-block text-[14px] text-highlighted underline decoration-(--d-line-strong) underline-offset-4 hover:decoration-current">
          Go to the introduction
        </NuxtLink>
      </div>
    </DocsShell>
  </UApp>
</template>
