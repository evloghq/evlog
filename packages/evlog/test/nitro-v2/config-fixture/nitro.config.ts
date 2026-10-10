import { resolve } from 'pathe'
import { defineNitroConfig } from 'nitropack/config'

const evlogRoot = resolve(__dirname, '../../../src')

export default defineNitroConfig({
  compatibilityDate: '2026-06-11',
  alias: {
    'evlog': resolve(evlogRoot, 'index.ts'),
  },
})
