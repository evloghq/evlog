<script setup lang="ts">
interface FooterLink {
  label: string
  to: string
  external?: boolean
}

interface FooterColumn {
  label: string
  links: FooterLink[]
}

// Every internal route below has a page under `content/`; keep them in sync when pages move.
const footerColumns: FooterColumn[] = [
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

const year = new Date().getFullYear()
</script>

<template>
  <footer class="bg-default border-t border-default" aria-labelledby="landing-footer-title">
    <h2 id="landing-footer-title" class="sr-only">
      Site links
    </h2>
    <UContainer class="py-12 lg:py-16">
      <!-- Desktop and tablet: every group open -->
      <nav aria-label="Footer" class="hidden sm:grid sm:grid-cols-3 lg:grid-cols-5 gap-x-8 gap-y-10">
        <div v-for="column in footerColumns" :key="column.label">
          <p class="text-xs font-mono uppercase tracking-wider text-highlighted">
            {{ column.label }}
          </p>
          <ul class="mt-4 space-y-3">
            <li v-for="link in column.links" :key="link.label">
              <NuxtLink
                :to="link.to"
                :target="link.external ? '_blank' : undefined"
                :rel="link.external ? 'noopener noreferrer' : undefined"
                class="footer-link text-sm text-muted hover:text-highlighted"
              >
                {{ link.label }}
              </NuxtLink>
            </li>
          </ul>
        </div>
      </nav>

      <!-- Mobile: one collapsible group per column -->
      <nav aria-label="Footer" class="sm:hidden divide-y divide-default border-y border-default">
        <details v-for="column in footerColumns" :key="column.label" class="group">
          <summary class="flex min-h-11 cursor-pointer list-none items-center justify-between py-3 text-xs font-mono uppercase tracking-wider text-highlighted [&::-webkit-details-marker]:hidden">
            {{ column.label }}
            <UIcon name="i-lucide-chevron-down" class="size-4 text-muted transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <ul class="pb-3">
            <li v-for="link in column.links" :key="link.label">
              <NuxtLink
                :to="link.to"
                :target="link.external ? '_blank' : undefined"
                :rel="link.external ? 'noopener noreferrer' : undefined"
                class="footer-link flex min-h-11 items-center text-sm text-muted hover:text-highlighted"
              >
                {{ link.label }}
              </NuxtLink>
            </li>
          </ul>
        </details>
      </nav>

      <div class="mt-4 sm:mt-12 pt-4 sm:pt-6 sm:border-t border-default flex items-center justify-between gap-4">
        <p class="text-xs font-mono text-muted">
          &copy; {{ year }} - Made by
          <a href="https://hrcd.fr/" target="_blank" rel="noopener noreferrer" class="footer-link text-muted hover:text-highlighted underline-offset-4 hover:underline">HugoRCD</a>
        </p>
        <div class="flex items-center gap-1">
          <UButton
            to="https://x.com/hugorcd"
            target="_blank"
            icon="i-simple-icons-x"
            color="neutral"
            variant="ghost"
            size="lg"
            class="size-11 justify-center"
            aria-label="evlog author on X"
          />
          <UButton
            to="https://github.com/evloghq/evlog"
            target="_blank"
            icon="i-simple-icons-github"
            color="neutral"
            variant="ghost"
            size="lg"
            class="size-11 justify-center"
            aria-label="evlog on GitHub"
          />
        </div>
      </div>
    </UContainer>
  </footer>
</template>

<style scoped>
.footer-link {
  transition: color 0.15s ease;
}

.footer-link:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 2px;
  border-radius: 2px;
}
</style>
