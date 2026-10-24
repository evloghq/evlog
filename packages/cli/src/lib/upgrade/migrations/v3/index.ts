import type { Migration } from '../../types'
import browserToHttp from './browser-to-http'
import nitroSubpaths from './nitro-subpaths'

/** evlog 2 → 3. */
export default {
  to: 3,
  codemods: [nitroSubpaths, browserToHttp],
} satisfies Migration
