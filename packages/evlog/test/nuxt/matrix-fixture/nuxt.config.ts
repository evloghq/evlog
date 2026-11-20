export default defineNuxtConfig({
  ssr: false,
  devtools: { enabled: false },
  telemetry: false,
  compatibilityDate: '2026-06-11',
  nitro: { experimental: { asyncContext: true } },
})
