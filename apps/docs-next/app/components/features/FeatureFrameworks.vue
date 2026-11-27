<script setup lang="ts">
import { Motion } from 'motion-v'

const props = defineProps<{
  link?: string
  linkLabel?: string
}>()

// eslint-disable-next-line @typescript-eslint/naming-convention
const NuxtLink = resolveComponent('NuxtLink')
const activeTab = ref(0)

const frameworkRows = [
  [
    { name: 'Nuxt', icon: 'i-simple-icons-nuxtdotjs', tab: 0 },
    { name: 'Next.js', icon: 'i-simple-icons-nextdotjs', tab: 1 },
    { name: 'SvelteKit', icon: 'i-simple-icons-svelte', tab: 2 },
    { name: 'Nitro', icon: 'i-custom-nitro', tab: 3 },
    { name: 'TanStack Start', icon: 'i-custom-tanstack', tab: 4 },
    { name: 'React Router', icon: 'i-custom-reactrouter', tab: 5 },
    { name: 'NestJS', icon: 'i-simple-icons-nestjs', tab: 6 },
  ],
  [
    { name: 'Express', icon: 'i-simple-icons-express', tab: 7 },
    { name: 'Hono', icon: 'i-simple-icons-hono', tab: 8 },
    { name: 'Fastify', icon: 'i-simple-icons-fastify', tab: 9 },
    { name: 'Elysia', icon: 'i-custom-elysia', tab: 10 },
    { name: 'oRPC', icon: 'i-lucide-network', tab: 13 },
    { name: 'Effect', icon: 'i-simple-icons-effect', tab: 14 },
    { name: 'Cloudflare', icon: 'i-simple-icons-cloudflare', tab: 11 },
    { name: 'Script', icon: 'i-lucide-terminal', tab: 12 },
    { name: 'Vite', icon: 'i-custom-vite', link: '/reference/vite-plugin' },
  ],
]
</script>

<template>
  <section class="py-24 md:py-32" data-section="features-feature-frameworks">
    <Motion
      :initial="false"
      :while-in-view="{ opacity: 1, y: 0 }"
      :transition="{ duration: 0.5 }"
      :in-view-options="{ once: true }"
      class="mb-10 text-center"
    >
      <div>
        <p v-if="$slots.headline" class="section-label justify-center">
          <slot name="headline" mdc-unwrap="p" />
        </p>
        <div class="relative">
          <h2 class="section-title">
            <slot name="title" mdc-unwrap="p" /><span class="text-primary">.</span>
          </h2>
          <div aria-hidden="true" class="title-glow section-title">
            <slot name="title" mdc-unwrap="p" /><span class="text-primary">.</span>
          </div>
        </div>
        <p v-if="$slots.description" class="mt-4 text-sm text-muted max-w-md mx-auto">
          <slot name="description" mdc-unwrap="p" />
        </p>
        <NuxtLink v-if="props.link" :to="props.link" class="mt-4 inline-flex items-center gap-1.5 font-mono text-xs text-muted hover:text-primary transition-colors">
          {{ props.linkLabel || 'Learn more' }}
          <UIcon name="i-lucide-arrow-right" class="size-3" />
        </NuxtLink>
      </div>
    </Motion>

    <Motion
      :initial="false"
      :while-in-view="{ opacity: 1, y: 0 }"
      :transition="{ duration: 0.4, delay: 0.1 }"
      :in-view-options="{ once: true }"
      class="mb-8 flex flex-col items-center gap-1 mx-auto"
    >
      <div
        v-for="(row, rowIndex) in frameworkRows"
        :key="rowIndex"
        class="flex flex-wrap items-end justify-center gap-2 md:gap-3"
      >
        <component
          :is="fw.link ? NuxtLink : 'button'"
          v-for="fw in row"
          :key="fw.name"
          :to="fw.link"
          class="group flex flex-col items-center gap-2 px-4 py-3 border outline-none transition-all duration-300"
          :class="fw.tab !== undefined && activeTab === fw.tab
            ? 'border-primary/30 bg-primary/5'
            : 'border-transparent hover:border-muted'"
          @click="fw.tab !== undefined ? activeTab = fw.tab : undefined"
        >
          <UIcon
            :name="fw.icon"
            class="size-8 sm:size-10 transition-colors duration-300"
            :class="fw.tab !== undefined && activeTab === fw.tab ? 'text-white' : 'text-muted group-hover:text-highlighted'"
          />
          <span
            class="font-mono text-xs whitespace-nowrap transition-colors duration-300"
            :class="fw.tab !== undefined && activeTab === fw.tab ? 'text-highlighted' : 'text-muted group-hover:text-highlighted'"
          >
            {{ fw.name }}
          </span>
        </component>
      </div>
    </Motion>

    <Motion
      :initial="false"
      :while-in-view="{ opacity: 1, y: 0 }"
      :transition="{ duration: 0.5, delay: 0.2 }"
      :in-view-options="{ once: true }"
      class="mx-auto max-w-3xl"
    >
      <div v-if="activeTab === 0" class="landing-code">
        <slot name="nuxt" />
      </div>
      <div v-if="activeTab === 1" class="landing-code">
        <slot name="nextjs" />
      </div>
      <div v-if="activeTab === 2" class="landing-code">
        <slot name="sveltekit" />
      </div>
      <div v-if="activeTab === 3" class="landing-code">
        <slot name="nitro" />
      </div>
      <div v-if="activeTab === 4" class="landing-code">
        <slot name="tanstack-start" />
      </div>
      <div v-if="activeTab === 5" class="landing-code">
        <slot name="react-router" />
      </div>
      <div v-if="activeTab === 6" class="landing-code">
        <slot name="nestjs" />
      </div>
      <div v-if="activeTab === 7" class="landing-code">
        <slot name="express" />
      </div>
      <div v-if="activeTab === 8" class="landing-code">
        <slot name="hono" />
      </div>
      <div v-if="activeTab === 9" class="landing-code">
        <slot name="fastify" />
      </div>
      <div v-if="activeTab === 10" class="landing-code">
        <slot name="elysia" />
      </div>
      <div v-if="activeTab === 11" class="landing-code">
        <slot name="cloudflare" />
      </div>
      <div v-if="activeTab === 12" class="landing-code">
        <slot name="bun" />
      </div>
      <div v-if="activeTab === 13" class="landing-code">
        <slot name="orpc" />
      </div>
      <div v-if="activeTab === 14" class="landing-code">
        <slot name="effect" />
      </div>
    </Motion>
  </section>
</template>
