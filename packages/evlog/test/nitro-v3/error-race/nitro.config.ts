import { defineConfig } from 'nitro'
import { resolve } from 'pathe'

const evlogRoot = resolve(__dirname, '../../../src')

// The slow error hook must register before evlog's plugin so that Hookable runs it first.
export default defineConfig({
  serverDir: './',
  errorHandler: resolve(evlogRoot, 'nitro-v3/errorHandler.ts'),
  plugins: [
    resolve(__dirname, 'plugins/slow-error-hook.ts'),
    resolve(evlogRoot, 'nitro-v3/plugin.ts'),
    resolve(__dirname, 'plugins/capture-drain.ts'),
  ],
  alias: {
    'evlog': resolve(evlogRoot, 'index.ts'),
  },
  builder: 'rollup',
  watchOptions: {
    ignored: ['**/*'],
    ignoreInitial: true,
    usePolling: false,
  },
  rollupConfig: {
    watch: {
      exclude: ['**/*'],
      chokidar: {
        ignoreInitial: true,
        usePolling: false,
      },
    },
  },
})
