<script setup lang="ts">
import { Motion } from 'motion-v'

const { public: pub } = useRuntimeConfig()
const justUseEvlogUrl = computed(() =>
  typeof pub.justUseEvlogUrl === 'string' ? pub.justUseEvlogUrl.trim() : '',
)

const shipByTime = ref('')

let clockInterval: ReturnType<typeof setInterval> | undefined

function updateShipByTime() {
  const now = new Date()
  now.setMinutes(now.getMinutes() + 10)
  const h = String(now.getHours()).padStart(2, '0')
  const m = String(now.getMinutes()).padStart(2, '0')
  shipByTime.value = `${h}:${m}`
}

// Every internal route here has a page under `content/`; keep them in sync when pages move.
const footerColumns = [
  {
    label: 'Docs',
    links: [
      { label: 'Introduction', to: '/start/introduction' },
      { label: 'Quick start', to: '/start/quick-start' },
      { label: 'Configuration', to: '/reference/configuration' },
      { label: 'CLI', to: '/cli/overview' },
      { label: 'Performance', to: '/reference/performance' },
      { label: 'Log cost', to: '/reference/cost' },
    ],
  },
  {
    label: 'Guides',
    links: [
      { label: 'Structured logging in Node.js', to: '/use-cases/structured-logging-nodejs' },
      { label: 'Wide events', to: '/learn/wide-events' },
      { label: 'Structured errors', to: '/learn/structured-errors' },
      { label: 'Sampling', to: '/learn/sampling' },
      { label: 'Client logging', to: '/use-cases/client-logging' },
      { label: 'Enrichers', to: '/use-cases/enrichers' },
    ],
  },
  {
    label: 'Integrations',
    links: [
      { label: 'Nuxt', to: '/integrate/frameworks/nuxt' },
      { label: 'Next.js', to: '/integrate/frameworks/nextjs' },
      { label: 'TanStack Start', to: '/integrate/frameworks/tanstack-start' },
      { label: 'Hono', to: '/integrate/frameworks/hono' },
      { label: 'Express', to: '/integrate/frameworks/express' },
      { label: 'Drains & adapters', to: '/integrate/adapters/overview' },
    ],
  },
  {
    label: 'Compare',
    links: [
      { label: 'vs Pino', to: '/compare/pino' },
      { label: 'vs Winston', to: '/compare/winston' },
      { label: 'vs LogTape', to: '/compare/logtape' },
      { label: 'vs Consola', to: '/compare/consola' },
      { label: 'OpenTelemetry', to: '/compare/opentelemetry' },
      { label: 'All loggers', to: '/reference/vs-other-loggers' },
    ],
  },
  {
    label: 'Resources',
    links: [
      { label: 'GitHub', to: 'https://github.com/evloghq/evlog', external: true },
      { label: 'Releases', to: 'https://github.com/evloghq/evlog/releases', external: true },
      { label: 'npm', to: 'https://www.npmjs.com/package/evlog', external: true },
      { label: 'llms.txt', to: '/llms.txt', external: true },
      { label: 'Sitemap', to: '/sitemap.xml', external: true },
    ],
  },
]

onMounted(() => {
  updateShipByTime()
  clockInterval = setInterval(updateShipByTime, 1_000)
})

onBeforeUnmount(() => {
  if (clockInterval) clearInterval(clockInterval)
})
</script>

<template>
  <section class="relative overflow-hidden flex flex-col" data-section="landing-cta">
    <div
      class="absolute inset-x-0 top-0 h-24 z-[1] pointer-events-none"
      style="background: linear-gradient(180deg, #09090b 0%, transparent 100%)"
    />

    <div
      class="absolute inset-0"
      style="background: linear-gradient(180deg, #09090b 0%, #000711 6%, #001133 14%, #002266 22%, #0044CC 32%, #0055FF 42%, #0077FF 52%, #0099FF 62%, #44BBFF 72%, #88D4FF 80%, #BBE6FF 88%, #E0F3FF 94%, #FFFFFF 100%)"
    />

    <div class="relative z-10 pt-24 md:pt-32 text-center max-w-2xl mx-auto px-6">
      <Motion
        :initial="false"
        :while-in-view="{ opacity: 1, y: 0 }"
        :transition="{ duration: 0.5 }"
        :in-view-options="{ once: true }"
      >
        <div>
          <div class="relative mb-6">
            <h2 class="section-title text-center text-shadow-lg text-shadow-black">
              Better logging<br>by
              <ClientOnly>
                <span class="tabular-nums">{{ shipByTime }}</span>
                <template #fallback>
                  <span>tonight</span>
                </template>
              </ClientOnly>
              <span class="cta-dot">.</span>
            </h2>
          </div>
          <p class="text-base leading-relaxed text-highlighted mb-10">
            <slot name="description" mdc-unwrap="p" />
          </p>

          <div class="flex flex-wrap items-center justify-center gap-4">
            <UButton
              to="/start/installation"
              size="lg"
              class="bg-white hover:bg-white/90 text-black border-0"
            >
              Get Started
              <template #trailing>
                <UIcon name="i-lucide-arrow-right" class="size-4" />
              </template>
            </UButton>
            <UButton
              v-if="justUseEvlogUrl"
              :to="justUseEvlogUrl"
              target="_blank"
              size="lg"
              class="bg-white/10 border border-white/40 text-white hover:bg-white/20 backdrop-blur-sm"
            >
              <template #leading>
                <UIcon name="i-lucide-megaphone" class="size-4" />
              </template>
              Just fucking use evlog
            </UButton>
            <UButton
              to="https://github.com/evloghq/evlog"
              target="_blank"
              size="lg"
              class="bg-white/10 border border-white/40 text-white hover:bg-white/20 backdrop-blur-sm"
            >
              <template #leading>
                <UIcon name="i-simple-icons-github" class="size-4" />
              </template>
              View on GitHub
            </UButton>
          </div>
        </div>
      </Motion>
    </div>

    <footer class="relative z-10 mt-auto pt-32 md:pt-44 pb-6" aria-labelledby="landing-footer-title">
      <h2 id="landing-footer-title" class="sr-only">
        Site links
      </h2>
      <div class="max-w-5xl mx-auto px-6">
        <nav aria-label="Footer" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-6 gap-y-8 pb-8 border-b border-black/10">
          <div v-for="column in footerColumns" :key="column.label">
            <p class="text-xs font-mono uppercase tracking-wider text-black/60">
              {{ column.label }}
            </p>
            <ul class="mt-3 space-y-2">
              <li v-for="link in column.links" :key="link.label">
                <NuxtLink
                  :to="link.to"
                  :target="link.external ? '_blank' : undefined"
                  :rel="link.external ? 'noopener noreferrer' : undefined"
                  class="text-sm font-mono tracking-tight text-black/70 hover:text-black focus-visible:text-black focus-visible:underline outline-none transition-colors"
                >
                  {{ link.label }}
                </NuxtLink>
              </li>
            </ul>
          </div>
        </nav>
        <div class="pt-4 flex items-center justify-between">
          <div class="text-xs font-mono italic tracking-tight text-black/60">
            &copy; {{ new Date().getFullYear() }} - Made by
            <a href="https://hrcd.fr/" target="_blank" rel="noopener noreferrer" class="hover:underline text-black/60">HugoRCD</a>
          </div>
          <div class="flex items-center gap-3">
            <a href="https://x.com/hugorcd" target="_blank" rel="noopener noreferrer" aria-label="X" class="text-black/60 hover:text-black transition-colors">
              <UIcon name="i-simple-icons-x" class="size-4" />
            </a>
            <a href="https://github.com/evloghq/evlog" target="_blank" rel="noopener noreferrer" aria-label="GitHub" class="text-black/60 hover:text-black transition-colors">
              <UIcon name="i-simple-icons-github" class="size-4" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.cta-dot {
  animation: pulse-dot 1s steps(1) infinite;
}

@keyframes pulse-dot {
  0%, 45% { opacity: 1; }
  50%, 95% { opacity: 0; }
  100% { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .cta-dot {
    animation: none;
  }
}
</style>
