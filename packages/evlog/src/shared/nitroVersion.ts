import type { Nuxt } from '@nuxt/schema'
import * as kit from '@nuxt/kit'

/**
 * Nitro major version, safe for `@nuxt/kit` versions that predate
 * `getNitroVersion` (added in 4.6.0). A static named import of that export
 * fails to load the module on older kit, so it is read through the namespace.
 * Nuxt 4.4 and 4.5 run Nitro 2, so `2` is the correct fallback.
 *
 * @internal
 */
export function getNitroVersionSafe(nuxt: Nuxt): number {
  return kit.getNitroVersion?.(nuxt) ?? 2
}
