// v3 is this app's own content, served at `/`. A version with a `branch` and a `contentDir` is mounted
// at `/<id>` and read from that directory of the repository at that branch. Each mounted version also
// has its data endpoints under `server/api/content/<id>/`.
const versions = [
  { id: 'v3', label: 'v3', badge: 'beta', home: '/start/introduction' },
  { id: 'v2', label: 'v2', branch: 'main', contentDir: 'apps/docs/content' },
]
const mounted = versions.filter(version => version.branch).map(version => `/${version.id}`)

export default defineNuxtConfig({
  modules: [
    // First: it seeds `site`, `mcp` and `agentDiscovery` from git and the package before the modules below read them.
    './modules/config',
    '@nuxt/ui',
    '@comark/vue',
    '@nuxtjs/robots',
    '@nuxtjs/sitemap',
    'nuxt-seo-utils',
    'nuxt-schema-org',
    '@nuxtjs/mcp-toolkit',
    'nuxt-llms',
    'nuxt-agent-discovery',
    // Search runs in a worker: its functions are auto-imported from `app/workers/`.
    'nuxt-workers',
    'motion-v/nuxt',
  ],

  css: ['~/assets/css/main.css'],

  // Content is read by the content instance, not by Nuxt.
  ignore: ['content/**'],

  compatibilityDate: '2026-10-01',

  // Markdown references components by tag (`::framework-tabs`, `::landing-hero`), and the renderer
  // resolves a tag it was not handed from the app's global components.
  components: [
    { path: '~/components/content', global: true, pathPrefix: false },
    { path: '~/components', global: true },
  ],

  ui: { content: true, prose: true },

  colorMode: {
    preference: 'dark',
  },

  // Geist is resolved from the `--font-*` theme variables, which gives each family a fallback with
  // matching metrics. Only the Latin upright file is declared, so it can be preloaded.
  fonts: {
    families: [
      { name: 'Geist', weights: ['100 900'], styles: ['normal'], subsets: ['latin'], preload: true },
      { name: 'Geist Mono', weights: ['100 900'], styles: ['normal'], subsets: ['latin'], preload: true },
      {
        name: 'Geist Pixel Line',
        src: '/fonts/GeistPixel-Line.woff2',
        weights: [400, 500],
        global: true,
      },
    ],
  },

  site: {
    name: 'evlog',
    url: 'https://www.evlog.dev',
  },

  llms: {
    // Built from the content navigation at request time (modules/config/runtime/server/plugins/llms.ts).
    prerender: false,
    domain: 'https://www.evlog.dev',
    title: 'evlog',
    description: 'A TypeScript logger for wide events and structured errors. One event per request, job, or script run, sent to the backend you already have.',
  },

  mcp: {
    name: 'evlog MCP',
  },

  // Markdown for agents: content negotiation on every page, `/raw/**`, the `llms.txt` bridge, `sitemap.md`,
  // the api-catalog, the MCP server card and Agent Skills.
  agentDiscovery: {
    source: './server/utils/agent-source.ts',
    skills: {
      // The published skills live at the repo root so a bare `npx skills add evloghq/evlog` finds them.
      dir: '../../skills',
    },
    excludePrefixes: { extend: mounted.map(base => `${base}/`) },
  },

  runtimeConfig: {
    public: {
      docsVersions: versions,
    },
  },

  // A mounted version is an older release: out of every index.
  routeRules: Object.fromEntries(mounted.flatMap(base => [
    [base, { robots: 'noindex, nofollow' }],
    [`${base}/**`, { robots: 'noindex, nofollow' }],
  ])),

  sitemap: {
    // Content is the source of truth: the app sources would only add the landing.
    excludeAppSources: true,
    sources: ['/api/__sitemap__/urls'],
    exclude: mounted.flatMap(base => [base, `${base}/**`]),
  },

  $production: {
    // A mounted version follows its branch, so its pages are regenerated every five minutes.
    routeRules: Object.fromEntries(mounted.map(base => [`${base}/**`, { isr: 300 }])),
  },

  nitro: {
    externals: { inline: ['comark/'] },
    // MCP tool handlers reach the request through `useEvent()`.
    experimental: { asyncContext: true },
  },

  experimental: {
    payloadExtraction: 'client',
  },

  icon: {
    provider: 'server',
    fallbackToApi: 'client-only',
    serverBundle: { collections: ['lucide', 'simple-icons', 'logos', 'vscode-icons'] },
    customCollections: [
      {
        prefix: 'custom',
        dir: './app/assets/icons',
      },
    ],
  },

  vite: {
    // The search worker is an ES module.
    worker: { format: 'es' },
    optimizeDeps: {
      include: ['shaders/vue'],
      // The workspace lockfile resolves @tiptap/vue-3 3.22 against @tiptap/core 3.32, which no longer
      // exports what it imports, and one failed dependency stalls every optimized one. Nothing here
      // renders Nuxt UI's editor, so its packages stay out of the optimizer.
      // Pre-bundling would break the wasm and worker files sqlite loads relative to its module URL.
      exclude: ['@sqlite.org/sqlite-wasm', '@tiptap/vue-3', '@tiptap/core', '@tiptap/pm', '@tiptap/starter-kit', '@tiptap/markdown', '@tiptap/suggestion'],
    },
  },
})
