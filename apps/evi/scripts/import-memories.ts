/**
 * One-off migration: carries Evi's Postgres-backed memories into the eve
 * file-memory document in the private Vercel Blob store.
 *
 * Run from `apps/evi`, after the file-memory slot is deployed and provisioned
 * (`eve add memory/file` sets the `EVE_MEMORY_*` variables):
 *
 *   pnpm dlx tsx scripts/import-memories.ts           # dry run: writes memories-import.md
 *   pnpm dlx tsx scripts/import-memories.ts --write   # merges into the Blob store
 *
 * The Blob store only holds a document once something has been saved into it,
 * so before `--write` succeeds, send the agent one throwaway save ("remember
 * that the memory import ran"), or the script reports that no document exists.
 * Remove the throwaway entry afterwards, with `memory__remove_memory`.
 *
 * When the import is confirmed, drop the `postgres` devDependency, this
 * script, and the now-unused tables:
 *   DROP TABLE memories; DROP TABLE identities; DROP TABLE people;
 */
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { list } from '@vercel/blob'
import { normalizeMemoryText, type MemoryEntry, mergeMemoryDocuments, formatMemoryDocument, parseMemoryDocument } from '../agent/lib/memory-file'

if (existsSync(new URL('../.env.local', import.meta.url))) {
  process.loadEnvFile(new URL('../.env.local', import.meta.url))
}

const WRITE = process.argv.includes('--write')
const EXPORT_PATH = new URL('../memories-import.md', import.meta.url)
const BLOB_PREFIX = 'eve/memory/file'
const SIGNAL = AbortSignal.timeout(30_000)

function databaseUrl(): string {
  for (const name of ['DATABASE_URL', 'POSTGRES_URL', 'POSTGRESQL_URL']) {
    if (process.env[name]) return process.env[name] as string
  }
  throw new Error('No Postgres URL: set DATABASE_URL (or POSTGRES_URL), e.g. via `vercel env pull`.')
}

interface OldRow {
  title: string | null
  text: string
  surface: string
  invalidatedAt: Date | null
  validTo: Date | null
}

async function readOldMemories(): Promise<MemoryEntry[]> {
  const { default: postgres } = await import('postgres')
  const sql = postgres(databaseUrl(), { max: 1 })
  try {
    const rows = await sql<OldRow[]>`
      select title, text, source, invalidated_at as "invalidatedAt", valid_to as "validTo"
      from memories
      order by updated_at asc
    `
    const seen = new Set<string>()
    const entries: MemoryEntry[] = []
    for (const row of rows) {
      // Believed now: mirrors the old store's liveness rule.
      if (row.invalidatedAt !== null || (row.validTo !== null && row.validTo.getTime() <= Date.now())) continue
      const labeled = row.title ? `${row.title}: ${row.text}` : row.text
      let normalized: string
      try {
        normalized = normalizeMemoryText(labeled)
      } catch {
        console.warn(`skipping an unrenderable memory: ${JSON.stringify(row.text.slice(0, 60))}`)
        continue
      }
      if (seen.has(normalized)) continue
      seen.add(normalized)
      entries.push({ index: entries.length, text: normalized })
    }
    return entries
  } finally {
    await sql.end()
  }
}

function blobToken(): string | undefined {
  for (const name of ['EVE_MEMORY_BLOB_READ_WRITE_TOKEN', 'BLOB_READ_WRITE_TOKEN']) {
    if (process.env[name]) return process.env[name]
  }
  return undefined
}

/** The scope key is the segment eve derives; discover it from the store layout instead of recomputing it. */
async function memoryDocumentKeys(): Promise<string[]> {
  const keys: string[] = []
  let cursor: string | undefined
  for (;;) {
    const page = await list({ prefix: `${BLOB_PREFIX}/`, cursor, token: blobToken() })
    for (const blob of page.blobs) {
      if (!blob.pathname.endsWith('/MEMORY.md')) continue
      keys.push(blob.pathname.slice(BLOB_PREFIX.length + 1, -'/MEMORY.md'.length))
    }
    if (!page.hasMore || page.cursor === cursor) break
    cursor = page.cursor
  }
  return keys
}

async function main(): Promise<void> {
  const incoming = await readOldMemories()
  console.log(`read ${incoming.length} live memor${incoming.length === 1 ? 'y' : 'ies'} from Postgres`)

  if (!WRITE) {
    await writeFile(EXPORT_PATH, formatMemoryDocument({ entries: incoming, lastAllocatedIndex: incoming.length - 1 }))
    console.log(`dry run: document written to ${EXPORT_PATH.pathname}. Rerun with --write to merge it into the Blob store.`)
    return
  }

  const token = blobToken()
  if (!token) {
    throw new Error('No Blob credentials: run `eve add memory/file` (or `eve integration setup file-memory`) so EVE_MEMORY_BLOB_* is set, then pull env and rerun.')
  }
  const keys = await memoryDocumentKeys()
  if (keys.length === 0) {
    throw new Error('The Blob store has no memory document yet. Send the agent one throwaway save first, then rerun with --write.')
  }
  if (keys.length > 1) {
    console.warn(`expected one scope key, found ${keys.length}: merging into each`)
  }

  const { vercelBlob } = await import('eve/memory/file/vercel')
  const backend = vercelBlob({ token })
  for (const key of keys) {
    const current = await backend.read({ key, signal: SIGNAL })
    if (current === null) throw new Error(`Document at ${key} disappeared between list and read; rerun.`)
    const existing = parseMemoryDocument(current.content)
    const merged = mergeMemoryDocuments(existing, incoming)
    if (merged.entries.length === existing.entries.length) {
      console.log(`${key}: nothing new to import`)
      continue
    }
    const result = await backend.write({ key, content: formatMemoryDocument(merged), expectedVersion: current.version, signal: SIGNAL })
    console.log(`${key}: imported ${merged.entries.length - existing.entries.length} memories (version ${result.version})`)
  }
}

await main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
