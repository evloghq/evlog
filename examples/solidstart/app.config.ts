import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@solidjs/start/config'

// Resolve evlog's Nitro plugin and error handler paths.
// SolidStart uses Vinxi, which loads server plugins from `server.plugins`
// rather than processing Nitro modules at dev time.
const evlogDir = dirname(fileURLToPath(import.meta.resolve('evlog/nitro/v2')))

// The plugin reads config from this env var at startup
process.env.__EVLOG_CONFIG = JSON.stringify({
  env: { service: 'solidstart-example' },
  include: ['/api/**'],
})

export default defineConfig({
  server: {
    plugins: [resolve(evlogDir, 'plugin')],
    errorHandler: resolve(evlogDir, 'errorHandler'),
  },
})
