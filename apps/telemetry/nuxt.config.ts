export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@nuxt/fonts', 'nuxt-auth-utils', '@nuxthub/core', 'nuxt-charts', '@nuxtjs/mcp-toolkit', 'evlog/nuxt'],

  devtools: { enabled: true },

  css: ['~/assets/css/main.css'],

  compatibilityDate: 'latest',

  // Structured logging for this app's own API requests (dogfooding evlog).
  // `useLogger`/`log` are auto-imported in server/**. Structured errors go
  // through the catalog in `server/utils/errors.ts` (`telemetryErrors`),
  // which sidesteps the h3-vs-evlog `createError` auto-import ambiguity.
  evlog: {
    env: { service: 'evlog-telemetry' },
    include: ['/api/**'],
    // The live-refresh probe is the dashboard's heartbeat and carries no
    // information worth keeping. Logging it would drown the events that matter.
    exclude: ['/api/telemetry/cursor'],
  },

  // Exposes the dashboard's stats/runs data to AI assistants over MCP — see
  // server/mcp/. Auth mirrors the dashboard's own password gate (server/mcp/index.ts).
  mcp: {
    name: 'evlog Telemetry',
    description: 'Read-only access to evlog telemetry: aggregate stats, the raw runs list, and full run detail.',
  },

  nitro: {
    experimental: { asyncContext: true }, // required for useEvent() in server/mcp/index.ts's middleware
  },

  // Custom Nucleo collection (`i-nucleo-<name>`) — SVGs exported from the
  // local Nucleo.app library by `scripts/export-nucleo-icons.mjs`. Glass
  // icons keep their multi-color gradients; outline glyphs use currentColor.
  icon: {
    customCollections: [
      {
        prefix: 'nucleo',
        dir: './app/assets/icons/nucleo',
      }
    ],
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

  // Postgres via Drizzle. Zero-config locally (PGlite, stored in .data/) —
  // set DATABASE_URL (or POSTGRES_URL / POSTGRESQL_URL) in production to
  // switch to a real Postgres store over the postgres-js driver.
  hub: {
    db: {
      dialect: 'postgresql',
      casing: 'snake_case',
    },
  },
})
