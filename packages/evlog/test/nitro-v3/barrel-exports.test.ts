import { describe, expect, it } from 'vitest'
import {
  EvlogError,
  createError,
  createEvlogError,
  evlogErrorHandler,
  parseError,
  useLogger,
} from '../../src/nitro-v3/index'

describe('evlog/nitro barrel', () => {
  it('exports structured error helpers alongside Nitro integration', () => {
    expect(typeof createError).toBe('function')
    expect(createEvlogError).toBe(createError)
    expect(typeof parseError).toBe('function')
    expect(EvlogError).toBeDefined()
    expect(typeof useLogger).toBe('function')
    expect(typeof evlogErrorHandler).toBe('function')
  })
})
