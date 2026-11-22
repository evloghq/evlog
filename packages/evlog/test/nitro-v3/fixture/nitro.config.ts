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
    resolve(__dirname, 'evlog-plugin.ts'),
  ],
  alias: {
    'evlog': resolve(evlogRoot, 'index.ts'),
  },
  // What the evlog module inlines: the fixture loads the plugin without the module.
  replace: {
    __EVLOG_CONFIG__: JSON.stringify({ exclude: ['/internal/**'] }),
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
