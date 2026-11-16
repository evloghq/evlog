import type { Nuxt } from '@nuxt/schema'
import { describe, expect, it, vi } from 'vitest'

// The helper reads `getNitroVersion` through a namespace import and falls back
// to 2 when the export is undefined, so it never statically imports an export
// that older @nuxt/kit versions lack.
vi.mock('@nuxt/kit', () => ({ getNitroVersion: undefined }))

const { getNitroVersionSafe } = await import('../../src/shared/nitroVersion')

describe('getNitroVersionSafe', () => {
  it('returns 2 when getNitroVersion is unavailable', () => {
    expect(getNitroVersionSafe({} as unknown as Nuxt)).toBe(2)
  })
})
