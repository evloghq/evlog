import { afterEach, describe, expect, it, vi } from 'vitest'
import { expectLinearTime } from './timers'

describe('expectLinearTime', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('accepts work whose time grows with input length', () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    expectLinearTime((input) => {
      now += input.length / 1_000
    }, n => 'x'.repeat(1_024 * n))
  })

  it('accepts a linear scan of a long string', () => {
    expectLinearTime((input) => {
      let n = 0
      for (let i = 0; i < input.length; i++) n += input.charCodeAt(i)
      return n
    }, n => 'a'.repeat(4_096 * n))
  })

  it('times both sizes on inputs of the same shape', () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    expectLinearTime((input) => {
      now += input.endsWith('@') ? input.length / 1_000 : 0.001
    }, n => `${'x'.repeat(1_024 * n)}@`)
  })

  it('accepts linear work whose single call is below one millisecond', () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    expectLinearTime((input) => {
      now += input.length / 100_000
    }, n => 'x'.repeat(1_024 * n))
  })

  it('rejects work whose time grows with the square of input length', () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    expect(() => {
      expectLinearTime((input) => {
        now += (input.length * input.length) / 50_000
      }, n => 'x'.repeat(1_024 * n), 'quadratic')
    }).toThrow(/quadratic/)
  })

  it('rejects quadratic work whose short run is below one millisecond', () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    expect(() => {
      expectLinearTime((input) => {
        now += (input.length * input.length) / 5_000_000
      }, n => 'x'.repeat(1_024 * n), 'quadratic-small')
    }).toThrow(/quadratic-small/)
  })

  it('rejects work that is already slow on every input size', () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    expect(() => {
      expectLinearTime(() => {
        now += 3_000
      }, n => 'x'.repeat(1_024 * n), 'hang')
    }).toThrow(/hang/)
  })
})
