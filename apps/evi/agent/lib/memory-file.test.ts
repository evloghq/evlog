import { describe, expect, it } from 'vitest'
import {
  formatMemoryDocument,
  mergeMemoryDocuments,
  normalizeMemoryText,
  parseMemoryDocument,
} from './memory-file'

describe('normalizeMemoryText', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeMemoryText('  Hugo   prefers\n  French  ')).toBe('Hugo prefers French')
  })

  it('rejects empty text', () => {
    expect(() => normalizeMemoryText('   ')).toThrow(TypeError)
  })

  it('refuses entries over the 2,048 byte limit instead of truncating', () => {
    expect(() => normalizeMemoryText('é'.repeat(2_049))).toThrow(RangeError)
  })
})

describe('formatMemoryDocument / parseMemoryDocument', () => {
  it('round-trips entries and the allocating header', () => {
    const document = {
      lastAllocatedIndex: 2,
      entries: [
        { index: 1, text: 'Hugo prefers direct answers.' },
        { index: 2, text: 'The evlog repo is evloghq/evlog.' },
      ],
    }
    const formatted = formatMemoryDocument(document)
    expect(formatted).toContain('<!-- eve-memory-file-v1 lastAllocatedIndex=2 -->\n')
    expect(parseMemoryDocument(formatted)).toEqual(document)
  })

  it('formats an empty document as a bare header', () => {
    expect(formatMemoryDocument({ entries: [], lastAllocatedIndex: -1 }))
      .toBe('<!-- eve-memory-file-v1 lastAllocatedIndex=-1 -->\n')
  })

  it('rejects documents that are not in the provider format', () => {
    expect(() => parseMemoryDocument('just some notes\n')).toThrow(TypeError)
    expect(() => parseMemoryDocument('<!-- eve-memory-file-v1 lastAllocatedIndex=0 -->\n9: orphan index\n')).toThrow(TypeError)
  })
})

describe('mergeMemoryDocuments', () => {
  it('preserves existing indexes and appends new entries after lastAllocatedIndex', () => {
    const existing = {
      lastAllocatedIndex: 3,
      entries: [{ index: 2, text: 'Existing fact.' }],
    }
    const merged = mergeMemoryDocuments(existing, [
      { index: 0, text: 'Existing fact.' },
      { index: 0, text: 'New fact.' },
    ])
    // Index 3 was allocated and removed before, so the next entry continues
    // from lastAllocatedIndex, not from the highest surviving entry.
    expect(merged).toEqual({
      lastAllocatedIndex: 4,
      entries: [
        { index: 2, text: 'Existing fact.' },
        { index: 4, text: 'New fact.' },
      ],
    })
  })

  it('skips entries already present, whatever their incoming index', () => {
    const existing = {
      lastAllocatedIndex: 1,
      entries: [{ index: 1, text: 'Hugo prefers French.' }],
    }
    const merged = mergeMemoryDocuments(existing, [
      { index: 99, text: 'Hugo prefers French.' },
      { index: 99, text: 'Another fact.' },
    ])
    expect(merged.entries.map(entry => entry.text)).toEqual(['Hugo prefers French.', 'Another fact.'])
    expect(merged.lastAllocatedIndex).toBe(2)
  })
})
