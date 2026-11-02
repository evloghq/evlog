export default defineNuxtConfig({
  extends: ['comark-docs'],

  modules: ['motion-v/nuxt'],

  compatibilityDate: '2026-10-01',

  comarkDocs: {
    css: ['~/assets/css/main.css'],
    // v3 is served at `/` from this app's own branch. v2 stays on `main`, in the Docus app's content
    // directory, until 3.0 ships and `main` becomes v3; then v2 moves to a `v2` branch.
    versions: [
      { id: 'v3', label: 'v3', badge: 'beta' },
      { id: 'v2', label: 'v2', branch: 'main', contentDir: 'apps/docs/content' },
    ],
  },

  // Markdown references components by tag (`::framework-tabs`, `::landing-hero`), and the renderer
  // resolves a tag it was not handed from the app's global components.
  components: [
    { path: '~/components/content', global: true, pathPrefix: false },
    { path: '~/components', global: true },
  ],

  colorMode: {
    preference: 'dark',
  },

  fonts: {
    defaults: {
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
    },
  },
})
