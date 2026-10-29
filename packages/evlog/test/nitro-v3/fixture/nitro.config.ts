import {
  defineConfig
} from 'nitro'
import { resolve } from 'pathe'

const evlogRoot = resolve(__dirname, '../../../src')

export default defineConfig({
  serverDir: './',
  errorHandler: resolve(evlogRoot, 'nitro-v3/errorHandler.ts'),
  plugins: [
    resolve(__dirname, 'delayed-error-hook.ts'),
    resolve(evlogRoot, 'nitro-v3/plugin.ts'),
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
      }
    }
  }
})
