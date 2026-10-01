<script setup lang="ts">
import type { FooterColumn } from '@nuxt/ui'

const route = useRoute()
const isLanding = computed(() => route.path === '/')
const { public: pub } = useRuntimeConfig()
const justUseEvlogUrl = computed(() =>
  typeof pub.justUseEvlogUrl === 'string' ? pub.justUseEvlogUrl.trim() : '',
)

const columns = computed<FooterColumn[]>(() => [
  {
    label: 'Resources',
    children: [
      {
        label: 'Documentation',
        to: '/start/introduction'
      },
      ...(justUseEvlogUrl.value
        ? [
          {
            label: 'Just fucking use evlog',
            to: justUseEvlogUrl.value,
            target: '_blank' as const,
          }
        ]
        : []),
      {
        label: 'Releases',
        to: 'https://github.com/evloghq/evlog/releases',
        target: '_blank'
      },
      {
        label: 'LLMs.txt',
        to: '/llms.txt',
        target: '_blank'
      }
    ]
  },
  {
    label: 'Community',
    children: [
      {
        label: 'GitHub',
        to: 'https://github.com/evloghq/evlog',
        target: '_blank'
      },
      {
        label: 'Contributing',
        to: 'https://github.com/evloghq/evlog/blob/main/CONTRIBUTING.md',
        target: '_blank'
      }
    ]
  }
])
</script>

<template>
  <UFooter v-if="!isLanding" :ui="{ top: 'border-b border-default', root: 'z-10 border-t border-default' }">
    <template #top>
      <UContainer>
        <UFooterColumns :columns />
      </UContainer>
    </template>

    <template #left>
      <div class="text-xs font-mono italic tracking-tight">
        <span class="text-muted">&copy; {{ new Date().getFullYear() }} - Made by </span>
        <ULink to="https://hrcd.fr/" target="_blank" class="hover:underline">
          HugoRCD
        </ULink>
      </div>
    </template>

    <template #right>
      <UButton
        color="neutral"
        variant="ghost"
        to="https://x.com/hugorcd"
        target="_blank"
        icon="i-simple-icons-x"
        size="sm"
        aria-label="X"
      />
      <UButton
        color="neutral"
        variant="ghost"
        to="https://github.com/evloghq/evlog"
        target="_blank"
        icon="i-simple-icons-github"
        size="sm"
        aria-label="GitHub"
      />
    </template>
  </UFooter>
</template>
