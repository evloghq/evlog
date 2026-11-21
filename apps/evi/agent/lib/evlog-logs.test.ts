import { describe, expect, it } from 'vitest'
import { evlogLogs } from './evlog-logs'

describe('evlogLogs', () => {
  it('names the connector the logs tool reads Vercel runtime logs through', () => {
    // Without it the deployed tool refuses every read: @evlog/eve has no default.
    expect(evlogLogs.vercel?.connector).toBe('vercel/evlog')
  })
})
