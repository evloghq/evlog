import { describe, expect, it } from 'vitest'
import { chunkSerialized, utf8ByteLength } from '../../src/shared/chunk'

describe('chunkSerialized', () => {
  it('returns no chunks for no entries', () => {
    expect(chunkSerialized([], 10, 100)).toEqual([])
  })

  it('caps the number of entries per chunk', () => {
    expect(chunkSerialized(['a', 'b', 'c', 'd', 'e'], 2, Infinity)).toEqual([['a', 'b'], ['c', 'd'], ['e']])
  })

  it('caps the joined byte size per chunk, counting one separator byte between entries', () => {
    // '"aaa"' is 5 bytes: two of them joined take 11 bytes, three take 17.
    const entries = ['"aaa"', '"aaa"', '"aaa"', '"aaa"']
    expect(chunkSerialized(entries, Infinity, 11).map(chunk => chunk.length)).toEqual([2, 2])
    expect(chunkSerialized(entries, Infinity, 10).map(chunk => chunk.length)).toEqual([1, 1, 1, 1])
    expect(chunkSerialized(entries, Infinity, 17).map(chunk => chunk.length)).toEqual([3, 1])
  })

  it('measures UTF-8 bytes, not string length', () => {
    // '"éé"' is 4 UTF-16 units and 6 UTF-8 bytes: two of them joined take 13 bytes.
    expect(chunkSerialized(['"éé"', '"éé"'], Infinity, 12)).toHaveLength(2)
    expect(chunkSerialized(['"éé"', '"éé"'], Infinity, 13)).toHaveLength(1)
  })

  it('sends an entry larger than the byte cap in a chunk of its own', () => {
    const big = `"${'x'.repeat(50)}"`
    expect(chunkSerialized(['"a"', big, '"b"'], Infinity, 10)).toEqual([['"a"'], [big], ['"b"']])
  })

  it('keeps entry order across chunks', () => {
    const entries = Array.from({ length: 25 }, (_, index) => String(index))
    expect(chunkSerialized(entries, 7, Infinity).flat()).toEqual(entries)
  })
})

describe('utf8ByteLength', () => {
  it.each([
    ['ascii', JSON.stringify({ path: '/api/users', status: 200 })],
    ['two-byte characters', JSON.stringify('café ñandú')],
    ['three-byte characters', JSON.stringify('日本語のログ')],
    ['surrogate pairs', JSON.stringify('deploy 🚀 done 👍🏽')],
    ['lone surrogates escaped by JSON.stringify', JSON.stringify('\uD800 and \uDC00')],
  ])('matches TextEncoder for %s', (_, value) => {
    expect(utf8ByteLength(value)).toBe(new TextEncoder().encode(value).byteLength)
  })
})
