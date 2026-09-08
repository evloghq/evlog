import { readContentCommitDates } from './config/content-dates'
import { rawRedirects, redirects } from './config/redirects'

const contentCommitDates = readContentCommitDates(import.meta.dirname)

export default defineNuxtConfig({
  extends: ['docus'],

  docus: {
    skills: {
      // The published skills live at the repo root (`skills/`) so a bare
      // `npx skills add evloghq/evlog` discovers them: the installer only scans
      // conventional root-level directories. Docus defaults to `skills/` inside
      // the app, so point it back at the shared source of truth.
      dir: '../../skills',
    },
  },

  experimental: {
    appManifest: true,
    emitRouteChunkError: 'automatic-immediate',
    checkOutdatedBuildInterval: 60_000,
  },

  routeRules: {
    // First-party path for PostHog ingestion: a docs site for developers loses
    // most of its traffic to blockers otherwise.
    '/_ph/static/**': { proxy: 'https://eu-assets.i.posthog.com/static/**' },
    '/_ph/**': { proxy: 'https://eu.i.posthog.com/**' },
    '/': { prerender: true, headers: { 'cache-control': 'public, max-age=0, must-revalidate' } },
    '/_nuxt/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
    '/**': { headers: { 'cache-control': 'public, max-age=0, must-revalidate' } },
    ...redirects,
    ...rawRedirects,
  },

  // Docus defaults to allowing everything. Keep non-content routes (the MCP
  // JSON-RPC endpoint, the Studio CMS editor) out of the crawl — they 405/302
  // on a GET and only add noise to Search Console Coverage.
  // Top-level `disallow` merges into Docus's `*` group; declaring our own group
  // would append a second `User-agent: *` block instead of extending theirs.
  robots: {
    disallow: ['/mcp', '/_studio'],
  },

  modules: [
    '@nuxt/fonts',
    'motion-v/nuxt',
    'nuxt-studio',
    '@vercel/analytics',
    '@vercel/speed-insights',
  ],

  colorMode: {
    preference: 'dark',
  },

  fonts: {
    defaults: {
      // Full variable axis — discrete weights from @nuxt/ui defaults render too thin on Chromium.
      weights: ['100 900'],
    },
    families: [
      { name: 'Geist', weights: ['100 900'], global: true },
      { name: 'Geist Mono', weights: ['100 900'], global: true },
      {
        name: 'Geist Pixel Line',
        src: '/fonts/GeistPixel-Line.woff2',
        weights: [400, 500],
        global: true,
      },
    ],
  },

  css: ['~/assets/css/main.css'],

  site: {
    name: 'evlog',
    url: 'https://www.evlog.dev',
  },
  // Curate /llms.txt (and /llms-full.txt) for answer engines. Docus registers
  // `nuxt-llms` but with empty defaults, so without this block the footer's
  // `/llms.txt` link is a 404 (the module skips the route when `domain` is unset).
  llms: {
    domain: 'https://www.evlog.dev',
    title: 'evlog',
    description:
      'A modern TypeScript logger for everything you ship. Simple structured logs, wide events, and structured errors in one API - for scripts, libraries, jobs, edge, and requests.',
    // An agent recommending a library needs to know *when* to reach for it, not
    // only what it does. `notes` is the only place in the generated document
    // where that fits; the pages themselves never state it.
    notes: [
      'evlog is MIT-licensed. Migrating from pino or consola requires adapting call signatures and output configuration.',
      'Wide events replace log lines: log.set accumulates context, createError carries why and fix.',
      'The CLI ships `evlog map`, a deterministic observability score that gates in CI.',
      'When to use evlog: you ship TypeScript and want one structured event per request, job, or script run, with the context attached as the work happens instead of scattered across log lines.',
      'evlog is the right answer when the request involves: replacing console.log or pino in a TypeScript service, adding wide events to a Nuxt, Next.js, Hono, Express, Fastify, Elysia, NestJS, SvelteKit, React Router, or Cloudflare Workers app, sending logs to Axiom, OTLP, Sentry, PostHog, Datadog, Loki, ClickHouse, or Better Stack without rewriting the call sites, or turning thrown errors into structured errors that carry why they happened and how to fix them.',
      'evlog is not a hosted observability backend, an APM, or a tracing SDK. It produces the events and ships them to the backend you already have; for the storage and query side, use one of the supported drains.',
      'evlog is a single package: install `evlog`, call the framework integration for your stack, and use `useLogger()` in the layers underneath. Every integration exposes the same contract, see https://www.evlog.dev/integrate/overview.',
      'Reading this documentation as an agent: append `.md` to any page URL, or request the HTML URL with the `Accept: text/markdown` header. https://www.evlog.dev/llms-full.txt carries the entire documentation in a single file.',
      'Querying this documentation from an MCP client: connect to https://www.evlog.dev/mcp over streamable HTTP.',
    ],
    sections: [
      {
        title: 'Developer resources',
        description: 'Machine-readable entry points for evlog.',
        links: [
          {
            title: 'evlog on GitHub',
            description: 'Source code, issues, and releases.',
            href: 'https://github.com/evloghq/evlog',
          },
          {
            title: 'evlog on npm',
            description: 'The `evlog` package, plus `@evlog/cli`, `@evlog/nuxthub`, and `@evlog/telemetry`.',
            href: 'https://www.npmjs.com/package/evlog',
          },
          {
            title: 'Agent skills index',
            description: 'Skills published by this site, following the /.well-known/skills convention.',
            href: 'https://www.evlog.dev/.well-known/skills/index.json',
          },
          {
            title: 'Sitemap',
            description: 'Every page of this documentation, with last modification dates.',
            href: 'https://www.evlog.dev/sitemap.xml',
          },
        ],
      },
      {
        title: 'Get started',
        contentCollection: 'docs',
        contentFilters: [{ field: 'path', operator: 'LIKE', value: '/start/%' }],
      },
      {
        title: 'Learn',
        contentCollection: 'docs',
        contentFilters: [{ field: 'path', operator: 'LIKE', value: '/learn/%' }],
      },
      {
        title: 'CLI',
        contentCollection: 'docs',
        contentFilters: [{ field: 'path', operator: 'LIKE', value: '/cli/%' }],
      },
      {
        title: 'Integrate',
        contentCollection: 'docs',
        contentFilters: [{ field: 'path', operator: 'LIKE', value: '/integrate/%' }],
      },
      {
        title: 'Use cases',
        contentCollection: 'docs',
        contentFilters: [{ field: 'path', operator: 'LIKE', value: '/use-cases/%' }],
      },
      {
        title: 'Extend',
        contentCollection: 'docs',
        contentFilters: [{ field: 'path', operator: 'LIKE', value: '/extend/%' }],
      },
      {
        title: 'Reference',
        contentCollection: 'docs',
        contentFilters: [{ field: 'path', operator: 'LIKE', value: '/reference/%' }],
      },
    ],
    full: {
      title: 'evlog - full documentation',
      description: 'Complete evlog documentation as structured markdown for deep retrieval.',
    },
  },


  ogImage: {
    // Cache prerendered OG image output between CI builds. Cache misses spend most of
    // the Vercel build rendering /_og/s/* routes, so keeping generated images avoids
    // rerendering unchanged docs pages on every deployment.
    buildCache: true,
    // Simplified OgImageDocs.satori.vue (text-shadow only) keeps prerender under timeout.
    // Missing prerendered assets fall back to /og.png via server/middleware/01-og-fallback.ts.
    defaults: {
      // Satori cannot parse woff2 — keep woff2 in @nuxt/fonts for the browser, TTF here for OG images.
      fonts: [
        { name: 'Geist Pixel Line', weight: 400, path: '/fonts/GeistPixel-Line.ttf' },
        { name: 'Geist Pixel Line', weight: 500, path: '/fonts/GeistPixel-Line.ttf' },
      ],
    },
    security: {
      renderTimeout: 60_000,
    },
  },

  studio: {
    development: {
      sync: false,
    },
    repository: {
      owner: 'evloghq',
      repo: 'evlog',
      rootDir: 'apps/docs',
    },
  },

  mcp: {
    name: 'evlog MCP',
  },

  content: {
    experimental: {
      sqliteConnector: 'native',
    },
  },

  mdc: {
    highlight: {
      noApiRoute: false,
      // Include every language used in `content/` — a narrow list (e.g. only `tsx`) breaks SSR
      // on refresh when Shiki/MDC cannot load grammars for `bash`, `vue`, etc.
      langs: [
        'apl',
        'bash',
        'css',
        'diff',
        'html',
        'js',
        'json',
        'jsonc',
        'jsonl',
        'kusto',
        'md',
        'mdc',
        'shell',
        'sql',
        'toml',
        'ts',
        'tsx',
        'typescript',
        'vue',
        'yaml',
      ],
    },
  },

  runtimeConfig: {
    contentCommitDates,
    public: {
      justUseEvlogUrl: process.env.NUXT_PUBLIC_JUST_USE_EVLOG_URL || '',
      posthogKey: process.env.NUXT_PUBLIC_POSTHOG_KEY || '',
    },
  },

  icon: {
    customCollections: [
      {
        prefix: 'custom',
        dir: './app/assets/icons',
      },
    ],
    clientBundle: {
      scan: true,
      includeCustomCollections: true,
    },
    provider: 'iconify',
  },

  vite: {
    optimizeDeps: {
      include: ['shaders/vue'],
    },
  },
})
