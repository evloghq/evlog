import type { MemoryScopeContext } from 'eve/memory'
import type { MemoryDocumentBackend } from 'eve/memory/file'
import { defineMemory } from 'eve/memory'
import { fileMemory, inMemory } from 'eve/memory/file'
import { vercelBlob } from 'eve/memory/file/vercel'
import { isMaintainer } from './lib/trust'

/**
 * Storage for the memory document, named rather than probed.
 *
 * eve's default backend reads credentials from `EVE_MEMORY_BLOB_*` and then
 * falls back to the project-wide `BLOB_*` pair, which points at the public
 * screenshot store. The backend always reads with private access, a public
 * store rejects that, and the rejection escalates to an unrecoverable turn
 * failure instead of an empty slot, so every session dies. The read-write
 * token carries its own store id and never resolves through OIDC, which is
 * scoped per deployment environment; its absence means local development.
 */
export function memoryBackend(): MemoryDocumentBackend {
  const token = process.env.EVE_MEMORY_BLOB_READ_WRITE_TOKEN
  return token ? vercelBlob({ token }) : inMemory()
}

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
  provider: fileMemory({ backend: memoryBackend(), maxCharacters: 12_000 }),
  scope({ session }: MemoryScopeContext) {
    // `EVI_MEMORY_ENABLED=1` is the whole rollback: unset it and the slot
    // vanishes from every session, with the document untouched in storage.
    if (process.env.EVI_MEMORY_ENABLED !== '1') return null
    const auth = session.auth.current
    return isMaintainer(auth) ? ['evlog', 'maintainer'] : null
  },
})
