import { defineConfig } from 'nitro'
import { resolve } from 'pathe'

export default defineConfig({
  serverDir: './',
  alias: {
    evlog: resolve(__dirname, '../../../src/index.ts'),
  },
  experimental: { asyncContext: true },
  builder: 'rollup',
  watchOptions: { ignored: ['**/*'], ignoreInitial: true, usePolling: false },
  rollupConfig: { watch: { exclude: ['**/*'], chokidar: { ignoreInitial: true, usePolling: false } } },
})
