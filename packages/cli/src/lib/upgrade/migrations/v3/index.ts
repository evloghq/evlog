import type { Migration } from '../../types'
import browserEntryRemoved from './browser-entry-removed'
import credentialAliasesRemoved from './credential-aliases-removed'
import nitroEntryPoints from './nitro-entry-points'
import posthogEventsDrainRemoved from './posthog-events-drain-removed'

/** evlog 2 → 3. */
export default {
  to: 3,
  codemods: [nitroEntryPoints, browserEntryRemoved, credentialAliasesRemoved, posthogEventsDrainRemoved],
} satisfies Migration
