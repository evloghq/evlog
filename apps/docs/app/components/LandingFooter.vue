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
  <footer class="landing-footer relative isolate overflow-hidden bg-default" aria-labelledby="landing-footer-title">
    <h2 id="landing-footer-title" class="sr-only">
      Site links
    </h2>

    <!-- Hairline in the brand blue, fading out at both edges -->
    <div aria-hidden="true" class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
    <!-- Faint grid, masked so it fades towards the bottom -->
    <div aria-hidden="true" class="footer-grid absolute inset-0 -z-10" />

    <UContainer class="pt-16 lg:pt-20">
      <div class="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between pb-12 lg:pb-14">
        <div class="max-w-md">
          <p class="font-pixel text-3xl text-highlighted">
            evlog<span class="text-primary">.</span>
          </p>
          <p class="mt-3 text-sm leading-relaxed text-muted">
            A TypeScript logger for structured logs, wide events and errors that explain what went wrong. Open source, MIT licensed.
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <span class="inline-flex items-center gap-2 rounded-full border border-default bg-elevated/40 px-3 py-1.5 font-mono text-xs text-toned">
            <span class="text-dimmed select-none" aria-hidden="true">$</span>npm install evlog
          </span>
          <UButton
            to="https://github.com/evloghq/evlog"
            target="_blank"
            icon="i-simple-icons-github"
            color="neutral"
            variant="outline"
            size="sm"
            class="rounded-full font-mono text-xs min-h-9"
            label="Star on GitHub"
          />
        </div>
      </div>

      <!-- Desktop and tablet: every group open -->
      <nav aria-label="Footer" class="hidden sm:grid sm:grid-cols-3 lg:grid-cols-5 gap-x-8 gap-y-10 border-t border-default pt-10">
        <div v-for="column in footerColumns" :key="column.label">
          <p class="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            {{ column.label }}
          </p>
          <ul class="mt-4 space-y-2.5">
            <li v-for="link in column.links" :key="link.label">
              <NuxtLink
                :to="link.to"
                :target="link.external ? '_blank' : undefined"
                :rel="link.external ? 'noopener noreferrer' : undefined"
                class="footer-link text-sm text-muted hover:text-highlighted"
              >
                {{ link.label }}<UIcon v-if="link.external" name="i-lucide-arrow-up-right" class="ml-0.5 size-3 align-[-1px] text-dimmed" aria-hidden="true" />
              </NuxtLink>
            </li>
          </ul>
        </div>
      </nav>

      <!-- Mobile: one collapsible group per column -->
      <nav aria-label="Footer" class="sm:hidden border-t border-default">
        <details v-for="column in footerColumns" :key="column.label" class="group border-b border-default">
          <summary class="flex min-h-12 cursor-pointer list-none items-center justify-between font-mono text-xs uppercase tracking-[0.14em] text-toned [&::-webkit-details-marker]:hidden">
            {{ column.label }}
            <UIcon name="i-lucide-plus" class="size-4 text-dimmed transition-transform duration-200 group-open:rotate-45" aria-hidden="true" />
          </summary>
          <ul class="pb-2 -mt-1">
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

      <div class="mt-6 sm:mt-12 lg:mt-16 flex items-center justify-between gap-4 sm:border-t border-default py-4 sm:py-6">
        <p class="flex items-center gap-2 font-mono text-xs text-muted">
          <span class="relative flex size-1.5" aria-hidden="true">
            <span class="absolute inline-flex size-full rounded-full bg-primary/50 motion-safe:animate-ping" />
            <span class="relative inline-flex size-1.5 rounded-full bg-primary" />
          </span>
          <span>&copy; {{ year }} evlog &middot; Made by
            <a href="https://hrcd.fr/" target="_blank" rel="noopener noreferrer" class="footer-link text-toned hover:text-highlighted">HugoRCD</a></span>
        </p>
        <div class="flex items-center gap-1 -mr-3">
          <UButton
            to="https://x.com/hugorcd"
            target="_blank"
            icon="i-simple-icons-x"
            color="neutral"
            variant="ghost"
            class="size-11 justify-center text-muted hover:text-highlighted"
            aria-label="evlog author on X"
          />
          <UButton
            to="https://github.com/evloghq/evlog"
            target="_blank"
            icon="i-simple-icons-github"
            color="neutral"
            variant="ghost"
            class="size-11 justify-center text-muted hover:text-highlighted"
            aria-label="evlog on GitHub"
          />
        </div>
      </div>
    </UContainer>

    <!-- Typographic sign-off: the tagline above an oversized, faint wordmark -->
    <div aria-hidden="true" class="pointer-events-none select-none pt-4 sm:pt-6">
      <p class="text-center font-mono text-[11px] sm:text-xs tracking-wide text-muted px-6 text-balance">
        Digging through logs is not observability. It's hope.
      </p>
      <p class="footer-wordmark mt-2 font-mono font-semibold text-center whitespace-nowrap">
        evlog
      </p>
    </div>
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

.footer-grid {
  background-image:
    linear-gradient(to right, rgb(255 255 255 / 0.035) 1px, transparent 1px),
    linear-gradient(to bottom, rgb(255 255 255 / 0.035) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: radial-gradient(ellipse 80% 60% at 50% 0%, black 30%, transparent 75%);
}

.footer-wordmark {
  font-size: clamp(8rem, 30vw, 22rem);
  line-height: 0.78;
  letter-spacing: -0.06em;
  margin-bottom: -0.12em;
  background: linear-gradient(180deg, rgb(255 255 255 / 0.10) 0%, rgb(0 85 255 / 0.06) 55%, transparent 95%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
</style>
