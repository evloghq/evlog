import { defineParentSandbox } from 'eve/sandbox'
import { describe, expect, it } from 'vitest'
import reviewSandbox from './review-sandbox'

describe('review-sandbox', () => {
  it('declares the parent sandbox so sweep specialists share the sweep checkout', () => {
    const markers = Object.getOwnPropertySymbols(reviewSandbox)
    for (const marker of Object.getOwnPropertySymbols(defineParentSandbox())) {
      expect(markers).toContain(marker)
    }
  })
})
