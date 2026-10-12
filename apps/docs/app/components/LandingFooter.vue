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

// Live HH:MM:SS for the log-line timestamps; empty during SSR to avoid a hydration mismatch.
const time = ref('')
let clock: ReturnType<typeof setInterval> | undefined
function tick() {
  time.value = new Date().toTimeString().slice(0, 8)
}
onMounted(() => {
  tick()
  clock = setInterval(tick, 1000)
})
onBeforeUnmount(() => clearInterval(clock))

function linkAttrs(link: FooterLink) {
  return link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {}
}
</script>

<template>
  <!-- The footer reads as one evlog log event: a request line, its link groups as a tree, and a closing line. -->
  <footer class="footer bg-default font-mono text-[12.5px] leading-5 text-toned" aria-labelledby="landing-footer-title">
    <h2 id="landing-footer-title" class="sr-only">
      Site links
    </h2>
    <UContainer class="pt-7 pb-9 sm:pt-9 sm:pb-11">
      <p class="log-line" aria-hidden="true">
        <span class="text-muted">{{ time || '--:--:--' }}</span>
        <span class="text-primary tracking-wide">INFO</span>
        <span><span class="text-highlighted">GET</span> /footer <span class="text-highlighted">200</span> <span class="text-muted">in 0.4ms</span></span>
      </p>

      <nav aria-label="Footer" class="groups">
        <div
          v-for="(column, i) in footerColumns"
          :key="column.label"
          class="group"
          :class="{ 'is-last': i === footerColumns.length - 1 }"
        >
          <span class="caret" aria-hidden="true">›</span>
          <p class="key">
            {{ column.label.toLowerCase() }}
          </p>
          <ul class="items">
            <li v-for="link in column.links" :key="link.label" class="item">
              <NuxtLink :to="link.to" v-bind="linkAttrs(link)" class="link">
                {{ link.label }}<template v-if="link.external">
                  <span class="ext" aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span>
                </template>
              </NuxtLink>
            </li>
          </ul>
        </div>
      </nav>

      <div class="log-line meta-line mt-5">
        <span class="text-muted" aria-hidden="true">{{ time || '--:--:--' }}</span>
        <span class="text-muted tracking-wide" aria-hidden="true">DEBUG</span>
        <p class="meta text-muted">
          <span class="tap">&copy; {{ year }} evlog</span>
          <a href="https://hrcd.fr/" target="_blank" rel="noopener noreferrer" class="link">HugoRCD</a>
          <a href="https://x.com/hugorcd" target="_blank" rel="noopener noreferrer" class="link" aria-label="HugoRCD on X">x.com</a>
          <a href="https://github.com/evloghq/evlog" target="_blank" rel="noopener noreferrer" class="link" aria-label="evlog on GitHub">github<span class="cursor" aria-hidden="true" /></a>
        </p>
      </div>
    </UContainer>
  </footer>
</template>

<style scoped>
.footer {
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.055);
  --rail: rgb(255 255 255 / 0.14);
}

/* timestamp · level · message, aligned on the character grid */
.log-line {
  display: grid;
  grid-template-columns: 10ch 7ch minmax(0, 1fr);
  align-items: baseline;
}
.meta { grid-column: 1 / -1; margin-top: 10px; display: flex; flex-wrap: wrap; column-gap: 2ch; }

.link {
  color: var(--ui-text-toned);
  border-radius: 2px;
  text-decoration: underline 1px transparent;
  text-underline-offset: 4px;
  transition: color 0.15s, text-decoration-color 0.15s;
}
.link:hover,
.link:focus-visible {
  color: var(--ui-text-highlighted);
  text-decoration-color: rgb(255 255 255 / 0.5);
}
.link:focus-visible { outline: 1px solid var(--ui-primary); outline-offset: 2px; }
.ext { margin-left: 0.25ch; font-size: 10px; color: var(--ui-text-muted); }
.key { color: var(--ui-text-muted); transition: color 0.15s; }
.group:hover .key,
.group:focus-within .key { color: var(--ui-text-toned); }

.cursor {
  display: inline-block;
  width: 1ch;
  height: 1.1em;
  margin-left: 1ch;
  vertical-align: -2px;
  background: var(--ui-text-toned);
  animation: blink 1.1s steps(1) infinite;
}
@keyframes blink { 50% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .cursor { animation: none; }
  .link, .key, .caret, .group::after { transition: none; }
}

/* One tree: a 1px rail with an elbow into each group's key; the last group ends like └ */
.group { position: relative; }
.group::before { content: ''; position: absolute; left: 0.5ch; top: 0; bottom: 0; width: 1px; background: var(--rail); }
.group.is-last::before { bottom: auto; }
.group::after { content: ''; position: absolute; left: 0.5ch; width: 1.6ch; height: 1px; background: var(--rail); transition: background 0.15s; }
.items { display: flex; flex-wrap: wrap; }
.caret { display: none; }

/* Mobile: keys above wrapping values, 44px tap rows */
@media (max-width: 639px) {
  .groups { margin-top: 8px; }
  .group { padding: 0 0 6px 3ch; }
  .group.is-last::before { height: 16px; }
  .group::after { top: 16px; }
  .key { line-height: 32px; }
  .items { column-gap: 2.5ch; }
  .item { padding-block: 2px; }
  .link, .tap { display: inline-flex; align-items: center; min-height: 44px; margin-block: -8px; }
}

/* Tablet and desktop: key and values on one line, aligned under the message column */
@media (min-width: 640px) {
  .log-line { grid-template-columns: 10ch 8ch minmax(0, 1fr); }
  .meta { grid-column: auto; margin-top: 0; }
  .groups { margin-left: 15ch; }
  .group { display: grid; grid-template-columns: 15ch minmax(0, 1fr); padding-left: 3ch; }
  .group.is-last::before { height: 10.5px; }
  .group::after { top: 10px; }
  .items { column-gap: 2ch; }
  .caret {
    display: block;
    position: absolute;
    left: -2.5ch;
    color: var(--ui-text-highlighted);
    opacity: 0;
    transform: translateX(-3px);
    transition: opacity 0.15s, transform 0.15s;
  }
  .group:hover .caret,
  .group:focus-within .caret { opacity: 1; transform: none; }
  .group:hover::after,
  .group:focus-within::after { background: rgb(255 255 255 / 0.55); }
}
</style>
