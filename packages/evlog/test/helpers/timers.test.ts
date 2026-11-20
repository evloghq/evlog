import { afterEach, describe, expect, it, vi } from 'vitest'
import { expectLinearTime } from './timers'

/** Make `process.threadCpuUsage()` report `ms()` milliseconds of CPU time. */
function mockCpuClock(ms: () => number) {
  vi.spyOn(process, 'threadCpuUsage').mockImplementation(() => ({ user: ms() * 1_000, system: 0 }))
}

describe('expectLinearTime', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('accepts work whose time grows with input length', () => {
    let now = 0
    mockCpuClock(() => now)
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
    mockCpuClock(() => now)
    expectLinearTime((input) => {
      now += input.endsWith('@') ? input.length / 1_000 : 0.001
    }, n => `${'x'.repeat(1_024 * n)}@`)
  })

  it('accepts linear work whose single call is below one millisecond', () => {
    let now = 0
    mockCpuClock(() => now)
    expectLinearTime((input) => {
      now += input.length / 100_000
    }, n => 'x'.repeat(1_024 * n))
  })

  it('ignores wall time spent waiting for a core', () => {
    let cpu = 0
    let wall = 0
    mockCpuClock(() => cpu)
    vi.spyOn(performance, 'now').mockImplementation(() => wall)
    expectLinearTime((input) => {
      cpu += input.length / 1_000
      // On a busy machine a long call spans more scheduler slices, so other processes preempt it more.
      wall += (input.length / 1_000) * (input.length > 1_024 ? 4 : 1)
    }, n => 'x'.repeat(1_024 * n))
  })

  it('accepts linear work that costs a few times more per character above a size', () => {
    let cpu = 0
    mockCpuClock(() => cpu)
    expectLinearTime((input) => {
      // Node 22 with a large heap limit redacts strings past about 16k characters up to ~3.5x slower per character.
      cpu += (input.length / 1_000) * (input.length > 1_024 ? 3.5 : 1)
    }, n => 'x'.repeat(1_024 * n))
  })

  it('measures again when one measurement of linear work misses the ratio', () => {
    let now = 0
    let longTimed = false
    let firstAttempt = true
    mockCpuClock(() => now)
    expectLinearTime((input) => {
      const isLong = input.length > 1_024
      if (!isLong && longTimed) firstAttempt = false
      if (isLong) longTimed = true
      now += (input.length / 1_000) * (isLong && firstAttempt ? 5 : 1)
    }, n => 'x'.repeat(1_024 * n))
  })

  it('ignores CPU time other threads use while the long input runs', () => {
    let thread = 0
    let processCpu = 0
    mockCpuClock(() => thread)
    vi.spyOn(process, 'cpuUsage').mockImplementation(() => ({ user: processCpu * 1_000, system: 0 }))
    expectLinearTime((input) => {
      thread += input.length / 1_000
      // V8's GC and compiler threads can run alongside the long call only.
      processCpu += (input.length / 1_000) * (input.length > 1_024 ? 4 : 1)
    }, n => 'x'.repeat(1_024 * n))
  })

  it('rejects work whose time grows with the square of input length', () => {
    let now = 0
    mockCpuClock(() => now)
    expect(() => {
      expectLinearTime((input) => {
        now += (input.length * input.length) / 50_000
      }, n => 'x'.repeat(1_024 * n), 'quadratic')
    }).toThrow(/quadratic/)
  })

  it('times on process CPU time where Node has no threadCpuUsage', () => {
    const { threadCpuUsage } = process
    // @ts-expect-error removed to run as Node before 22.19
    delete process.threadCpuUsage
    try {
      let now = 0
      vi.spyOn(process, 'cpuUsage').mockImplementation(() => ({ user: now * 1_000, system: 0 }))
      expect(() => {
        expectLinearTime((input) => {
          now += (input.length * input.length) / 50_000
        }, n => 'x'.repeat(1_024 * n), 'quadratic')
      }).toThrow(/quadratic/)
    } finally {
      process.threadCpuUsage = threadCpuUsage
    }
  })

  it('rejects quadratic work whose short run is below one millisecond', () => {
    let now = 0
    mockCpuClock(() => now)
    expect(() => {
      expectLinearTime((input) => {
        now += (input.length * input.length) / 5_000_000
      }, n => 'x'.repeat(1_024 * n), 'quadratic-small')
    }).toThrow(/quadratic-small/)
  })

  it('rejects work that is already slow on every input size', () => {
    let now = 0
    mockCpuClock(() => now)
    expect(() => {
      expectLinearTime(() => {
        now += 3_000
      }, n => 'x'.repeat(1_024 * n), 'hang')
    }).toThrow(/hang/)
  })
})
