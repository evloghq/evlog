// v3 is this app's own content, served at `/`. A version with a `branch` and a `contentDir` is mounted
// at `/<id>` and read from that directory of the repository at that branch. Each mounted version also
// has its data endpoints under `server/api/content/<id>/`.
const versions = [
  { id: 'v3', label: 'v3', badge: 'beta', home: '/start/introduction' },
  { id: 'v2', label: 'v2', branch: 'main', contentDir: 'apps/docs/content' },
]
const mounted = versions.filter(version => version.branch).map(version => `/${version.id}`)

export default defineNuxtConfig({
  extends: ['comark-docs'],

  modules: ['motion-v/nuxt'],

  compatibilityDate: '2026-10-01',

  // Markdown references components by tag (`::framework-tabs`, `::landing-hero`), and the renderer
  // resolves a tag it was not handed from the app's global components.
  components: [
    { path: '~/components/content', global: true, pathPrefix: false },
    { path: '~/components', global: true },
  ],

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
    domain: 'https://www.evlog.dev',
    title: 'evlog',
    description: 'A TypeScript logger for wide events and structured errors. One event per request, job, or script run, sent to the backend you already have.',
  },

  mcp: {
    name: 'evlog MCP',
  },

  agentDiscovery: {
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

  // A mounted version is an older release: served like the layer's branch previews, out of every index.
  routeRules: Object.fromEntries(mounted.flatMap(base => [
    [base, { robots: 'noindex, nofollow' }],
    [`${base}/**`, { robots: 'noindex, nofollow' }],
  ])),

  sitemap: {
    exclude: mounted.flatMap(base => [base, `${base}/**`]),
  },

  $production: {
    // The TTL the layer gives `/tree/**`: a mounted version follows its branch the same way.
    routeRules: Object.fromEntries(mounted.map(base => [`${base}/**`, { isr: 300 }])),
  },

  icon: {
    customCollections: [
      {
        prefix: 'custom',
        dir: './app/assets/icons',
      },
    ],
  },

  vite: {
    // The layer is linked from a sibling checkout with its own node_modules. Without this, its files
    // resolve a second Vue, Nuxt and Nuxt UI, and the page never hydrates.
    resolve: {
      dedupe: ['vue', 'vue-router', 'nuxt', '@nuxt/ui', 'reka-ui', '@vueuse/core', '@unhead/vue'],
    },
    optimizeDeps: {
      include: ['shaders/vue'],
      // The workspace lockfile resolves @tiptap/vue-3 3.22 against @tiptap/core 3.32, which no longer
      // exports what it imports, and one failed dependency stalls every optimized one. Nothing here
      // renders Nuxt UI's editor, so its packages stay out of the optimizer.
      exclude: ['@tiptap/vue-3', '@tiptap/core', '@tiptap/pm', '@tiptap/starter-kit', '@tiptap/markdown', '@tiptap/suggestion'],
    },
  },
})
