import { initLogger, type WideEvent } from 'evlog'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { jobLogger } from './job'

const drain = vi.fn<(ctx: { event: WideEvent }) => void>()

beforeEach(() => {
  drain.mockClear()
  initLogger({ silent: true, drain })
})

describe('jobLogger', () => {
  it('names the job and carries the given context into the emitted event', () => {
    const log = jobLogger('schedule.send', { schedule: 'nightly' })

    log.set({ accepted: true })
    log.emit()

    expect(drain).toHaveBeenCalledTimes(1)
    expect(drain.mock.calls[0]![0].event).toMatchObject({
      job: 'schedule.send',
      schedule: 'nightly',
      accepted: true,
    })
  })

  it('emits a job event with only the job name when no context is given', () => {
    const log = jobLogger('github.escalate')

    log.emit()

    const [[{ event }]] = drain.mock.calls as [[{ event: WideEvent }]]
    expect(event).toMatchObject({ job: 'github.escalate' })
    expect(event).not.toHaveProperty('schedule')
  })

  it('keeps the context of each logger separate', () => {
    const first = jobLogger('schedule.send', { schedule: 'nightly' })
    const second = jobLogger('schedule.send', { schedule: 'weekly' })

    first.emit()
    second.emit()

    expect(drain.mock.calls.map(([ctx]) => ctx.event.schedule)).toEqual(['nightly', 'weekly'])
  })
})
