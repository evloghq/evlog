import { describe, expect, it } from 'vitest'
import { errorFingerprint } from '../src/fingerprint'

describe('errorFingerprint', () => {
  it('gives messages that differ only by ids, numbers and times one key', () => {
    const a = errorFingerprint({ error: { name: 'Error', message: 'upstream timeout after 3012ms for req 8c1f2e4a-1b2c-4d3e-9f00-112233445566 at 2026-11-20T10:00:01.123Z' } })
    const b = errorFingerprint({ error: { name: 'Error', message: 'upstream timeout after 87ms for req 0a0b0c0d-1111-4222-8333-444455556666 at 2026-11-21T22:13:59Z' } })
    expect(a).toBe(b)
    expect(errorFingerprint({ error: { name: 'StripeError', message: 'No such charge: ch_3PqXa2LkdIwHu7ix for jane@example.com' } }))
      .toBe(errorFingerprint({ error: { name: 'StripeError', message: 'No such charge: ch_9ZzQ81pLmNbVcX0a for bob@shop.io' } }))
    expect(errorFingerprint({ error: { name: 'Error', message: 'object 5f3a9c0e1b2d not found' } }))
      .toBe(errorFingerprint({ error: { name: 'Error', message: 'object 77aa00bb11cc not found' } }))
  })

  it('keeps different errors apart, and words that look like hex', () => {
    const timeout = errorFingerprint({ error: { name: 'Error', message: 'upstream timeout' } })
    expect(errorFingerprint({ error: { name: 'TypeError', message: 'upstream timeout' } })).not.toBe(timeout)
    expect(errorFingerprint({ error: { name: 'Error', message: 'upstream refused' } })).not.toBe(timeout)
    expect(errorFingerprint({ error: { name: 'Error', message: 'cafebabe deadbeef' } })).toBe(JSON.stringify(['Error', 'cafebabe deadbeef']))
  })

  it('skips caching for events without an error', () => {
    expect(errorFingerprint({ status: 500 })).toBeUndefined()
  })
})
