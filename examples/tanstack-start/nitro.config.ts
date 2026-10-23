import type { NitroConfig } from 'nitro/types'
import evlog from 'evlog/nitro'

/* `evlog/nitro` may resolve a different `nitro` version than this example's
 * `nitro-nightly`. Runtime behavior matches; align the module slot for tsc. */
type NitroModuleSlot = NonNullable<NitroConfig['modules']>[number]

export default {
  experimental: {
    asyncContext: true,
  },
  modules: [
    evlog({
      env: { service: 'tanstack-start-example' },
    }) as unknown as NitroModuleSlot,
  ],
} satisfies NitroConfig
