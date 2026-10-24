import { describe, expect, it } from 'vitest'
import reviewSandbox from './review-sandbox'

// The markers eve's compiler reads from a sandbox definition (see
// `normalize-sandbox`): a selector must default-export `defineSandbox()`, and a
// parent definition is the one subagent sandboxes inherit from.
const SELECTOR = Symbol.for('eve.sandbox-selector')
const PARENT = Symbol.for('eve.sandbox-parent-definition')

describe('review sandbox', () => {
  it('is a sandbox selector', () => {
    expect(Reflect.get(reviewSandbox, SELECTOR)).toBe(true)
  })

  it('is the parent definition that the review subagents inherit', () => {
    expect(Reflect.get(reviewSandbox, PARENT)).toBe(true)
  })
})
