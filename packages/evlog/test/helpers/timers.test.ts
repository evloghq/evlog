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
    }, 'x'.repeat(8_192))
  })

  it('accepts a linear scan of a long string', () => {
    expectLinearTime((input) => {
      let n = 0
      for (let i = 0; i < input.length; i++) n += input.charCodeAt(i)
      return n
    }, 'a'.repeat(32_768))
  })

  it('accepts linear work whose single call is below one millisecond', () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    expectLinearTime((input) => {
      now += input.length / 100_000
    }, 'x'.repeat(8_192))
  })

  it('rejects work whose time grows with the square of input length', () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    expect(() => {
      expectLinearTime((input) => {
        now += (input.length * input.length) / 50_000
      }, 'x'.repeat(8_192), 'quadratic')
    }).toThrow(/quadratic/)
  })

  it('rejects quadratic work whose short run is below one millisecond', () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    expect(() => {
      expectLinearTime((input) => {
        now += (input.length * input.length) / 5_000_000
      }, 'x'.repeat(8_192), 'quadratic-small')
    }).toThrow(/quadratic-small/)
  })

  it('rejects work that is already slow on every input size', () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    expect(() => {
      expectLinearTime(() => {
        now += 3_000
      }, 'x'.repeat(8_192), 'hang')
    }).toThrow(/hang/)
  })
})
