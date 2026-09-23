import { afterEach, describe, expect, it, vi } from 'vitest'
import { withDeadline } from './deadline'

describe('withDeadline', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves the operation value', async () => {
    await expect(withDeadline(async () => 'value', 1000)).resolves.toBe('value')
  })

  it('rejects and aborts the operation signal on timeout', async () => {
    let signal: AbortSignal | undefined
    await expect(withDeadline((operationSignal) => {
      signal = operationSignal
      return new Promise(() => {})
    }, 20)).rejects.toThrow('Sandbox operation exceeded 20ms')
    expect(signal?.aborted).toBe(true)
  })

  it('clears the timer so a completed operation never rejects later', async () => {
    vi.useFakeTimers()
    const settled = withDeadline(async () => 'done', 1000)
    await expect(settled).resolves.toBe('done')
    await vi.advanceTimersByTimeAsync(2000)
    await expect(settled).resolves.toBe('done')
  })
})
