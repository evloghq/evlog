import { resolve } from 'pathe'
import { defineNitroConfig } from 'nitropack/config'

export default defineNitroConfig({
  compatibilityDate: '2026-06-11',
  experimental: { asyncContext: true },
  alias: {
    evlog: resolve(__dirname, '../../../src/index.ts'),
  },
})
