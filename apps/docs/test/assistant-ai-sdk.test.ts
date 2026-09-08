import { isStepCount } from 'ai'
import { describe, expect, it } from 'vitest'

describe('ai SDK resolution', () => {
  it('exports isStepCount so the docus assistant can load', () => {
    expect(typeof isStepCount).toBe('function')
  })
})
