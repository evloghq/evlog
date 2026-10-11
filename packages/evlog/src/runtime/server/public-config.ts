import { defineNitroPlugin, useRuntimeConfig } from 'nitropack/runtime'
import { readEvlogFileConfig } from '../../shared/fileConfig'

const BROWSER_KEYS = ['enabled', 'pretty', 'minLevel'] as const

/**
 * Hands the browser settings of `evlog.config.ts` to the client plugin. The
 * file is only evaluated by the server, so each request copies them into
 * `runtimeConfig.public.evlog`, skipping the keys that `nuxt.config.ts` or a
 * `NUXT_PUBLIC_EVLOG_*` variable already set. Nitro serves a key left unset
 * as `''`.
 */
export default defineNitroPlugin((nitroApp) => {
  const file = readEvlogFileConfig()
  if (!file) return
  const fromFile = BROWSER_KEYS.filter(key => file[key] !== undefined)
  if (fromFile.length === 0) return

  nitroApp.hooks.hook('request', (event) => {
    const browser = useRuntimeConfig(event).public?.evlog as Record<string, unknown> | undefined
    if (!browser) return
    for (const key of fromFile) {
      if (browser[key] === '' || browser[key] === undefined) browser[key] = file[key]
    }
  })
})
