import type { SlackChannel } from 'eve/channels/slack'
import type { ScheduleRunHandler } from 'eve/schedules'
import { jobLogger } from './job'
import { scheduleTarget } from './slack'

/**
 * Run handler delivering a task to the maintainer's Slack channel. Each run
 * opens its own thread under an anchor card, so runs never share a session
 * and a reply in the thread continues that run alone.
 */
export function maintainerRun(channel: SlackChannel, label: string, task: string): ScheduleRunHandler {
  return ({ to, waitUntil, appAuth }) => {
    const target = scheduleTarget(label)
    const log = jobLogger('schedule.send', { schedule: label })
    waitUntil(
      to(channel, target)
        .send(task, { auth: appAuth })
        .then(
          // A send resolves once the session accepts it, not once the turn
          // runs, so the cron invocation records the handoff either way.
          (delivery) => {
            log.set({ accepted: true, session: delivery.sessionId })
            log.emit()
          },
          (error) => {
            log.error(error as Error, { accepted: false })
            log.emit()
            throw error
          },
        ),
    )
  }
}
