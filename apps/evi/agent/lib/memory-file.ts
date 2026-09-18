/**
 * The document format behind eve's `fileMemory()` provider, mirrored here so
 * the migration script in `scripts/import-memories.ts` can read, merge, and
 * write documents without touching eve internals. Keep in step with the
 * provider: the header allocates entry indexes, entries are `<index>: <text>`
 * lines sorted by index, and both sides cap sizes instead of truncating.
 */

/** Matches eve's per-entry limit: 2,048 UTF-8 bytes after normalization. */
export const MAX_ENTRY_BYTES = 2_048
/** Matches eve's per-document limit. */
export const MAX_DOCUMENT_BYTES = 65_536

const HEADER_PREFIX = '<!-- eve-memory-file-v1 lastAllocatedIndex='
const HEADER_PATTERN = /^<!-- eve-memory-file-v1 lastAllocatedIndex=(-1|0|[1-9]\d*) -->\n/

export interface MemoryEntry {
  index: number
  text: string
}

export interface MemoryDocument {
  entries: MemoryEntry[]
  lastAllocatedIndex: number
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

/** Trim, collapse whitespace, and refuse empties and oversized entries. */
export function normalizeMemoryText(text: string): string {
  const normalized = text.trim().replaceAll(/\s+/g, ' ')
  if (normalized.length === 0) throw new TypeError('Memory text cannot be empty.')
  if (utf8Bytes(normalized) > MAX_ENTRY_BYTES) {
    throw new RangeError(`Memory text exceeds the ${MAX_ENTRY_BYTES} UTF-8 byte limit after normalization.`)
  }
  return normalized
}

/** `<index>: <text>` lines under the allocating header, entries sorted by index. */
export function formatMemoryDocument(document: MemoryDocument): string {
  const header = `${HEADER_PREFIX}${document.lastAllocatedIndex} -->\n`
  if (document.entries.length === 0) return header
  const body = [...document.entries]
    .sort((a, b) => a.index - b.index)
    .map(entry => `${entry.index}: ${entry.text}`)
    .join('\n')
  return `${header}${body}\n`
}

/** The inverse of `formatMemoryDocument`, strict enough to catch drift. */
export function parseMemoryDocument(content: string): MemoryDocument {
  const header = HEADER_PATTERN.exec(content)
  if (header === null || !content.endsWith('\n')) {
    throw new TypeError('Not a valid eve file-memory document.')
  }
  const lastAllocatedIndex = Number(header[1])
  const lines = content.slice(header[0].length).slice(0, -1)
  const entries: MemoryEntry[] = []
  const seen = new Set<number>()
  for (const line of lines.length === 0 ? [] : lines.split('\n')) {
    const match = /^(\d+): (.+)$/.exec(line)
    const index = match === null ? Number.NaN : Number(match[1])
    const text = match?.[2]
    if (match === null || text === undefined
      || !Number.isSafeInteger(index) || index > lastAllocatedIndex
      || seen.has(index) || normalizeMemoryText(text) !== text) {
      throw new TypeError('Not a valid eve file-memory document.')
    }
    seen.add(index)
    entries.push({ index, text })
  }
  return { entries, lastAllocatedIndex }
}

/**
 * Union of the two sets, deduped by normalized text. Existing indexes are
 * preserved (the model may hold recalled indexes for `remove_memory`);
 * incoming entries continue from `lastAllocatedIndex`.
 */
export function mergeMemoryDocuments(existing: MemoryDocument, incoming: readonly MemoryEntry[]): MemoryDocument {
  const known = new Set(existing.entries.map(entry => entry.text))
  const entries = [...existing.entries]
  let lastAllocatedIndex = existing.lastAllocatedIndex
  for (const entry of incoming) {
    if (known.has(entry.text)) continue
    if (lastAllocatedIndex >= Number.MAX_SAFE_INTEGER) throw new RangeError('Memory has no available index.')
    lastAllocatedIndex += 1
    known.add(entry.text)
    entries.push({ index: lastAllocatedIndex, text: entry.text })
  }
  return { entries, lastAllocatedIndex }
}
