import { describe, expect, it, vi } from 'vitest'
import { memoryBackend } from './memory'

const read = { key: 'evlog/maintainer', signal: new AbortController().signal }

describe('memoryBackend', () => {
  it('ignores the project-wide blob store', async () => {
    vi.stubEnv('EVE_MEMORY_BLOB_READ_WRITE_TOKEN', '')
    vi.stubEnv('BLOB_STORE_ID', 'store_public')
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_public_xxx')
    const backend = memoryBackend()

    expect(await backend.read(read)).toBeNull()
    const written = await backend.write({ ...read, content: 'kept', expectedVersion: null })

    expect(await backend.read(read)).toEqual(written)
  })

  it('uses the memory store when its token is configured', async () => {
    vi.stubEnv('EVE_MEMORY_BLOB_READ_WRITE_TOKEN', 'bogus')
    const backend = memoryBackend()

    await expect(backend.read(read)).rejects.toThrow('unable to extract store ID')
  })
})
