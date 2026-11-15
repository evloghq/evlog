import { describe, expect, it } from 'vitest'
import { runOutput } from './workspace'

describe('runOutput', () => {
  it('prefers stderr, falls back to stdout, and never prints undefined', () => {
    expect(runOutput({ stdout: 'out\n', stderr: 'err\n' })).toBe('err')
    expect(runOutput({ stdout: 'out\n', stderr: '' })).toBe('out')
    expect(runOutput({ stdout: 'out\n', stderr: ' \n' })).toBe('out')
    expect(runOutput({})).toBe('')
  })
})
