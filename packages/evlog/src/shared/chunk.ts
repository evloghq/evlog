/**
 * Group serialized entries into batches that stay within a provider's
 * per-request caps. `maxBytes` bounds the UTF-8 size of a batch's entries
 * joined by one-byte separators. An entry larger than `maxBytes` gets a batch
 * of its own, so the provider decides what to do with it.
 */
export function chunkSerialized(entries: string[], maxEntries: number, maxBytes: number): string[][] {
  const chunks: string[][] = []
  let current: string[] = []
  let currentBytes = 0
  for (const entry of entries) {
    const entryBytes = utf8ByteLength(entry)
    if (current.length > 0 && (current.length === maxEntries || currentBytes + 1 + entryBytes > maxBytes)) {
      chunks.push(current)
      current = []
      currentBytes = 0
    }
    currentBytes += current.length > 0 ? entryBytes + 1 : entryBytes
    current.push(entry)
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

/** UTF-8 byte length of `JSON.stringify` output, which never holds a lone surrogate. */
export function utf8ByteLength(value: string): number {
  let bytes = value.length
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 0x80) continue
    bytes += code < 0x800 ? 1 : 2
    if (code >= 0xD800 && code <= 0xDBFF) index++
  }
  return bytes
}
