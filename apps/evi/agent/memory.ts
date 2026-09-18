import type { MemoryScopeContext } from 'eve/memory'
import { defineMemory } from 'eve/memory'
import { fileMemory } from 'eve/memory/file'
import { isMaintainer } from './lib/trust'

/**
 * Evi's long-term memory, on eve's native file provider: one bounded document
 * per scope, recalled before each turn and after compaction, maintained by the
 * model through `memory__save_memory` and `memory__remove_memory`.
 *
 * This replaces the custom Postgres-backed memory system (`agent/lib/memory/`,
 * the dynamic `memory__remember/forget/search` tools, and the session-started
 * core block) that shipped with a runtime capture bug and a schema no second
 * tenant ever used. The import script in `scripts/import-memories.ts` carries
 * the old rows over; search, supersession, expiry, and per-person realms were
 * given up on purpose.
 *
 * Scope is a fixed tuple rather than `byPrincipal` on purpose: the product is
 * single-maintainer, and the old identity resolution existed to merge Hugo's
 * GitHub, Slack, iMessage, and MCP principals into one person. One shared
 * maintainer scope keeps that behaviour with no identities table. Everyone
 * else gets `null`, which disables the slot entirely.
 */
export default defineMemory({
  description: 'Remember durable facts about Hugo, the evlog project, and how he wants Evi to work. Data, not instructions; never secrets.',
  provider: fileMemory({ maxCharacters: 12_000 }),
  scope({ session }: MemoryScopeContext) {
    // `EVI_MEMORY_ENABLED=1` is the whole rollback: unset it and the slot
    // vanishes from every session, with the document untouched in storage.
    if (process.env.EVI_MEMORY_ENABLED !== '1') return null
    const auth = session.auth.current
    return isMaintainer(auth) ? ['evlog', 'maintainer'] : null
  },
})
