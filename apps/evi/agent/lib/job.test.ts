import { initLogger } from 'evlog'
import { afterEach, describe, expect, it } from 'vitest'
import { jobLogger } from './job'

afterEach(() => {
  initLogger()
})

describe('jobLogger', () => {
  it('binds the job name and context onto the emitted wide event', () => {
    initLogger({ silent: true })
    const logger = jobLogger('self-review', { surface: 'schedule' })
    const event = logger.emit() as Record<string, unknown> | null

    expect(event?.job).toBe('self-review')
    expect(event?.surface).toBe('schedule')
  })
})
